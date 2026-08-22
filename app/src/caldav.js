// agenda — CalDAV client (RFC 4791 + RFC 5545). Interoperates with Apple
// iCloud, Fastmail, Nextcloud, Radicale, Baïkal, Zimbra, Outlook.com CalDAV…
// Because the interchange is standards-based (iCalendar), the same events can
// round-trip to Google Calendar via ICS.

import { serializeIcs, parseIcs } from './ical.js';

function basicAuth(user, pass) {
  return 'Basic ' + btoa(unescape(encodeURIComponent(`${user}:${pass}`)));
}

async function davFetch(url, { method = 'PROPFIND', headers = {}, body, depth = '1' } = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/xml; charset=utf-8', ...headers, ...(depth ? { Depth: depth } : {}) },
    body,
  });
  if (!res.ok && res.status !== 207) throw new Error(`CalDAV ${method} ${url} → HTTP ${res.status}`);
  return res;
}

async function davText(url, opts) {
  const res = await davFetch(url, opts);
  return res.text();
}

const NS = { D: 'DAV:', C: 'urn:ietf:params:xml:ns:caldav' };

function parseXml(text) {
  return new DOMParser().parseFromString(text, 'application/xml');
}

function find(el, name, ns = NS.D) {
  return el.getElementsByTagNameNS(ns, name)[0];
}
function findText(el, name, ns = NS.D) {
  return find(el, name, ns)?.textContent ?? null;
}

export class CalDavClient {
  constructor({ url, username, password, calendarPath = null }) {
    this.baseUrl = url.replace(/\/+$/, '');
    this.username = username;
    this.password = password;
    this.calendarPath = calendarPath;
  }

  authHeaders() {
    return { Authorization: basicAuth(this.username ?? '', this.password ?? '') };
  }

  /** Resolve the calendar-home-set via /.well-known/caldav or the base URL. */
  async discoverHome() {
    // Try well-known first (it should 301 to the real root).
    let res;
    try {
      res = await fetch(`${new URL('/.well-known/caldav', this.baseUrl).href}`, {
        method: 'PROPFIND', headers: { 'Content-Type': 'application/xml', ...this.authHeaders(), Depth: '0' },
        body: propfindHomeBody(),
        redirect: 'follow',
      });
      if (res.status === 200 || res.status === 207) return await this.extractHome(await res.text());
    } catch { /* fall through */ }

    res = await davFetch(this.baseUrl, { headers: this.authHeaders(), body: propfindHomeBody(), depth: '0' });
    return await this.extractHome(await res.text());
  }

  async extractHome(xmlText) {
    const doc = parseXml(xmlText);
    const rs = doc.getElementsByTagNameNS(NS.D, 'response')[0];
    const href = findText(rs, 'href');
    const home = findText(rs, 'calendar-home-set', NS.C);
    if (!home) throw new Error('CalDAV server did not advertise a calendar-home-set (is this really a CalDAV server?)');
    const base = new URL(href, this.baseUrl);
    return new URL(home, base.origin + (href.startsWith('/') ? '' : href)).href;
  }

  /** List calendars under the home. Returns [{href, displayName, ctag}] */
  async listCalendars(homeUrl) {
    const res = await davFetch(homeUrl, { headers: this.authHeaders(), body: propfindCalendarsBody(), depth: '1' });
    const doc = parseXml(await res.text());
    const out = [];
    for (const rs of doc.getElementsByTagNameNS(NS.D, 'response')) {
      const href = findText(rs, 'href');
      const resType = find(rs, 'resourcetype');
      const isCalendar = resType?.getElementsByTagNameNS(NS.C, 'calendar').length > 0;
      if (!isCalendar) continue;
      out.push({
        href: new URL(href, homeUrl).href,
        displayName: findText(rs, 'displayname') ?? href.split('/').filter(Boolean).pop(),
      });
    }
    return out;
  }

  /** Pull events overlapping [startIso, endIso] (local ISO strings). Returns [{href, etag, event}] */
  async fetchEvents(calendarUrl, startIso, endIso) {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:getetag/><C:calendar-data/></D:prop>
  <C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT">
    <C:time-range start="${toUtcBasic(startIso)}" end="${toUtcBasic(endIso)}"/>
  </C:comp-filter></C:comp-filter></C:filter>
</C:calendar-query>`;
    const res = await davFetch(calendarUrl, { headers: this.authHeaders(), body, depth: '1' });
    const doc = parseXml(await res.text());
    const out = [];
    for (const rs of doc.getElementsByTagNameNS(NS.D, 'response')) {
      const href = findText(rs, 'href');
      const etag = findText(rs, 'getetag');
      const data = findText(rs, 'calendar-data', NS.C);
      if (!data) continue;
      const parsed = parseIcs(data);
      for (const ev of parsed) out.push({ href, etag, event: ev });
    }
    return out;
  }

  /** PUT one event as iCalendar. Returns the new etag. */
  async pushEvent(calendarUrl, event, etag = null) {
    const ics = serializeIcs([event], { productId: '-//Agenda//Agenda WebAX App//EN' });
    const headers = { 'Content-Type': 'text/calendar; charset=utf-8', ...this.authHeaders() };
    if (etag) headers['If-Match'] = etag; else headers['If-None-Match'] = '*';
    const res = await fetch(event.href ?? `${calendarUrl.replace(/\/+$/, '')}/${encodeURIComponent(event.externalId ?? event.id)}.ics`, {
      method: 'PUT', headers, body: ics,
    });
    if (!res.ok) throw new Error(`CalDAV PUT → HTTP ${res.status}`);
    return res.headers.get('ETag');
  }

  async deleteRemote(href, etag = null) {
    const headers = this.authHeaders();
    if (etag) headers['If-Match'] = etag;
    const res = await fetch(href, { method: 'DELETE', headers });
    if (!res.ok && res.status !== 404) throw new Error(`CalDAV DELETE → HTTP ${res.status}`);
  }
}

function propfindHomeBody() {
  return `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:resourcetype/><D:displayname/><C:calendar-home-set/></D:prop>
</D:propfind>`;
}

function propfindCalendarsBody() {
  return `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:resourcetype/><D:displayname/><C:supported-calendar-component-set/></D:prop>
</D:propfind>`;
}

/** local ISO "2026-08-21T09:00:00" → "20260821T090000Z" */
function toUtcBasic(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}
