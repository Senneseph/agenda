// agenda — iCalendar (RFC 5545) + RRULE recurrence layer.
// Interchange with real calendar services: Google Calendar, Apple Calendar /
// CalDAV, Outlook — all speak iCalendar, so Agenda does too. No invented
// standards: dates are local ISO, recurrence is RFC 5545 RRULE.

import { addDays, dateToStr, strToDate, hhmm } from './ui.js';

// ---------- RRULE ----------

export function parseRrule(str) {
  if (!str) return null;
  const out = { freq: 'DAILY', interval: 1, byday: [], count: null, until: null };
  for (const part of String(str).split(';')) {
    const [k, v] = part.split('=');
    if (!v) continue;
    switch (k.toUpperCase()) {
      case 'FREQ': out.freq = v.toUpperCase(); break;
      case 'INTERVAL': out.interval = Math.max(1, parseInt(v, 10) || 1); break;
      case 'COUNT': out.count = parseInt(v, 10); break;
      case 'UNTIL': out.until = v; break;
      case 'BYDAY':
        out.byday = String(v).split(',').filter(Boolean).map((d) => {
          const m = d.match(/^(\d+)?(MO|TU|WE|TH|FR|SA|SU)$/i);
          return m ? { ord: m[1] ? parseInt(m[1], 10) : null, day: m[2].toUpperCase() } : null;
        }).filter(Boolean);
        break;
    }
  }
  return out;
}

export function serializeRrule(r) {
  if (!r || !r.freq) return null;
  const parts = [`FREQ=${r.freq}`];
  if (r.interval && r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.byday?.length) parts.push(`BYDAY=${r.byday.map((b) => (b.ord ? b.ord + b.day : b.day)).join(',')}`);
  if (r.count) parts.push(`COUNT=${r.count}`);
  if (r.until) parts.push(`UNTIL=${r.until}`);
  return parts.join(';');
}

const DAY_NUM = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 0 };
const NUM_DAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function bydayMatches(date, byday) {
  const wd = NUM_DAY[date.getDay()];
  if (!byday?.length) return true;
  return byday.some((b) => {
    if (b.day !== wd) return false;
    if (b.ord == null) return true;
    const nth = Math.ceil(date.getDate() / 7);
    const last = date.getDate() > date.getDate() - date.getDay() + (date.getDaysInMonth ? date.getDaysInMonth() : 0);
    void last;
    const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    const isLast = date.getDate() > daysInMonth - 7;
    return b.ord > 0 ? nth === b.ord : (b.ord === -1 ? isLast : false);
  });
}

/**
 * Expand one event's occurrences overlapping [rangeStart, rangeEnd).
 * Honors exdates; overrides (detached instances) replace occurrences.
 * Returns instances sorted by start.
 */
export function expandEvent(ev, rangeStart, rangeEnd) {
  const out = [];
  const rrule = parseRrule(ev.rrule);
  const durMs = new Date(ev.end) - new Date(ev.start);
  const exSet = new Set((ev.exdates ?? []).map((e) => new Date(e).getTime()));
  const overrideByOrig = new Map();
  for (const o of ev.overrides ?? []) overrideByOrig.set(new Date(o.originalStart).getTime(), o);

  const push = (candDate, isException, o, explicitStart, explicitEnd) => {
    const startIso = explicitStart ?? `${dateToStr(candDate)}T${hhmm(new Date(ev.start))}:00`;
    const endIso = explicitEnd ?? new Date(new Date(startIso).getTime() + durMs);
    const endStr = typeof endIso === 'string' ? endIso : `${dateToStr(endIso)}T${hhmm(endIso)}:00`;
    const s = new Date(startIso).getTime(), e = new Date(endStr).getTime();
    const rs = new Date(rangeStart).getTime(), re = new Date(rangeEnd).getTime();
    if (e <= rs || s >= re) return;
    out.push({
      eventId: ev.id, instanceStart: startIso, start: startIso, end: endStr,
      allDay: !!ev.allDay, title: (o?.title ?? ev.title), description: (o?.description ?? ev.description) ?? '',
      location: (o?.location ?? ev.location) ?? '', color: ev.color ?? '',
      source: ev.source ?? 'local', isException,
    });
  };

  if (!rrule) {
    const startMs = new Date(ev.start).getTime();
    const rs = new Date(rangeStart).getTime(), re = new Date(rangeEnd).getTime();
    if (!(new Date(ev.end).getTime() <= rs || startMs >= re)) {
      out.push({
        eventId: ev.id, instanceStart: ev.start, start: ev.start, end: ev.end,
        allDay: !!ev.allDay, title: ev.title, description: ev.description ?? '',
        location: ev.location ?? '', color: ev.color ?? '', source: ev.source ?? 'local', isException: false,
      });
    }
    return out;
  }

  const { freq, interval, byday, count, until } = rrule;
  const evStart = new Date(ev.start);
  const evDay = evStart.getDay(); // 0=Sun
  const evDate = evStart.getDate();
  const cap = new Date(rangeEnd).getTime() + (freq === 'DAILY' ? 1 : freq === 'WEEKLY' ? 8 : 35) * 86400000;
  const untilMs = until ? new Date(until).getTime() : Infinity;
  const monthIndex = (d) => d.getFullYear() * 12 + d.getMonth();

  const candidates = [];
  let guard = 0;

  if (freq === 'DAILY') {
    for (let d = new Date(evStart); d.getTime() <= cap && guard++ < 5000; d.setDate(d.getDate() + interval)) {
      candidates.push(new Date(d));
    }
  } else if (freq === 'WEEKLY') {
    if (byday.length) {
      // iterate days; accept BYDAY matches whose week falls on the interval
      for (let d = new Date(evStart); d.getTime() <= cap && guard++ < 40000; d.setDate(d.getDate() + 1)) {
        if (!bydayMatches(d, byday)) continue;
        const weekOffset = Math.floor((d - evStart) / (7 * 86400000));
        if (weekOffset % interval === 0) candidates.push(new Date(d));
      }
    } else {
      for (let d = new Date(evStart); d.getTime() <= cap && guard++ < 5000; d.setDate(d.getDate() + 7 * interval)) {
        candidates.push(new Date(d));
      }
    }
  } else if (freq === 'MONTHLY') {
    if (byday.some((b) => b.ord)) {
      // nth weekday of the month (e.g. 2TU = second Tuesday)
      for (let d = new Date(evStart); guard++ < 5000; d.setMonth(d.getMonth() + interval)) {
        if (d.getTime() > cap) break;
        const y = d.getFullYear(), m = d.getMonth();
        const daysInMonth = new Date(y, m + 1, 0).getDate();
        const firstDow = new Date(y, m, 1).getDay();
        for (const b of byday) {
          const target = DAY_NUM[b.day];
          let date;
          if (b.ord === -1) {
            const last = new Date(y, m + 1, 0);
            const lastDow = last.getDay();
            date = daysInMonth - ((lastDow - target + 7) % 7);
          } else {
            date = 1 + ((target - firstDow + 7) % 7) + (b.ord - 1) * 7;
          }
          if (date >= 1 && date <= daysInMonth) candidates.push(new Date(y, m, date));
        }
      }
    } else if (byday.length) {
      for (let d = new Date(evStart); d.getTime() <= cap && guard++ < 40000; d.setDate(d.getDate() + 1)) {
        const monthOffset = monthIndex(d) - monthIndex(evStart);
        if (monthOffset >= 0 && monthOffset % interval === 0 && bydayMatches(d, byday)) candidates.push(new Date(d));
      }
    } else {
      for (let d = new Date(evStart); d.getTime() <= cap && guard++ < 5000; d.setMonth(d.getMonth() + interval)) {
        // clamp to a valid date in the target month (e.g. 31st → last day)
        const clamped = new Date(d.getFullYear(), d.getMonth(), Math.min(evDate, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
        candidates.push(clamped);
      }
    }
  }

  let emitted = 0;
  for (const cand of candidates) {
    if (count && emitted >= count) break;
    if (cand.getTime() > untilMs) break;
    emitted++;
    const origKey = new Date(`${dateToStr(cand)}T${hhmm(new Date(ev.start))}:00`).getTime();
    const o = overrideByOrig.get(origKey);
    if (o) {
      if (!o.cancelled) push(new Date(o.start), true, o, o.start, o.end);
    } else if (!exSet.has(origKey)) {
      push(cand, false, null);
    }
  }

  return out.sort((a, b) => a.start.localeCompare(b.start));
}

// ---------- ICS serialization ----------

function foldLine(line, len = 75) {
  if (line.length <= len) return line;
  const out = [];
  let rest = line;
  while (rest.length > len) {
    out.push(rest.slice(0, len));
    rest = rest.slice(len);
  }
  out.push(rest);
  return out.join('\r\n ');
}

function esc(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function unesc(v) {
  return String(v).replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function icsDateTime(iso) { // local ISO → UTC "YYYYMMDDTHHMMSSZ"
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

export function serializeIcs(events, { productId = '-//Agenda//Agenda WebAX App//EN' } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${productId}`, 'CALSCALE:GREGORIAN'];
  for (const ev of events) {
    lines.push('BEGIN:VEVENT', `UID:${ev.id}@agenda`, `DTSTAMP:${icsDateTime(new Date().toISOString())}`);
    if (ev.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dateToStr(new Date(ev.start)).replace(/-/g, '')}`);
      const endD = new Date(new Date(ev.start).getTime() + (new Date(ev.end) - new Date(ev.start)));
      lines.push(`DTEND;VALUE=DATE:${dateToStr(endD).replace(/-/g, '')}`);
    } else {
      lines.push(`DTSTART:${icsDateTime(ev.start)}`, `DTEND:${icsDateTime(ev.end)}`);
    }
    lines.push(`SUMMARY:${esc(ev.title)}`);
    if (ev.description) lines.push(`DESCRIPTION:${esc(ev.description)}`);
    if (ev.location) lines.push(`LOCATION:${esc(ev.location)}`);
    if (ev.rrule) lines.push(`RRULE:${ev.rrule}`);
    for (const ex of ev.exdates ?? []) lines.push(`EXDATE:${icsDateTime(ex)}`);
    for (const r of ev.reminders ?? []) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:-PT${r.minutes}M`, `DESCRIPTION:${esc(ev.title)}`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map((l) => foldLine(l)).join('\r\n') + '\r\n';
}

// ---------- ICS parsing ----------

export function parseIcs(text) {
  // unfold lines
  const unfolded = String(text).replace(/\r\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let cur = null;
  let inAlarm = false;

  const setProp = (ev, name, value) => {
    if (name === 'UID') ev.id = ev.id ?? value;
    else if (name === 'SUMMARY') ev.title = unesc(value);
    else if (name === 'DESCRIPTION') ev.description = unesc(value);
    else if (name === 'LOCATION') ev.location = unesc(value);
    else if (name === 'RRULE') ev.rrule = value;
    else if (name === 'EXDATE') { ev.exdates = ev.exdates ?? []; for (const d of value.split(',')) ev.exdates.push(parseIcsDate(d)); }
    else if (name === 'DTSTART') { ev.start = parseIcsDate(value); ev.allDay = value.includes('VALUE=DATE') || /^\d{8}$/.test(value); if (ev.allDay) ev.end = addDays(dateToStr(new Date(ev.start)), 1) + 'T00:00:00'; }
    else if (name === 'DTEND') { ev.end = parseIcsDate(value); }
    else if (name === 'TRIGGER') {
      const m = value.match(/-PT(\d+(?:\.\d+)?)([MH])/i);
      if (m) { ev.reminders = ev.reminders ?? []; ev.reminders.push({ minutes: Math.round(Number(m[1]) * (m[2].toUpperCase() === 'H' ? 60 : 1)) }); }
    }
  };

  for (const raw of unfolded) {
    const line = raw.trim();
    if (!line) continue;
    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const keyRaw = line.slice(0, sep);
    const value = line.slice(sep + 1);
    const [name, ...params] = keyRaw.split(';');
    const upper = name.toUpperCase();

    if (upper === 'BEGIN') {
      if (value === 'VEVENT') { cur = { id: 'ics-' + Math.random().toString(36).slice(2, 9), title: '', start: null, end: null, allDay: false, reminders: [], exdates: [], source: 'ics' }; }
      if (value === 'VALARM') inAlarm = true;
      continue;
    }
    if (upper === 'END') {
      if (value === 'VEVENT' && cur) {
        if (cur.title && cur.start && cur.end) events.push(cur);
        cur = null;
      }
      if (value === 'VALARM') inAlarm = false;
      continue;
    }
    if (cur && !inAlarm) setProp(cur, upper, value, params);
  }
  return events;
}

function parseIcsDate(v) {
  const p = v.split(';').pop();
  if (/^\d{8}$/.test(p)) { // date-only → local midnight
    return `${p.slice(0, 4)}-${p.slice(4, 6)}-${p.slice(6, 8)}T00:00:00`;
  }
  if (/Z$/.test(p)) { // UTC
    const s = p.slice(0, 15);
    const d = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`);
    return `${dateToStr(d)}T${hhmm(d)}:00`;
  }
  // local (floating)
  return `${p.slice(0, 4)}-${p.slice(4, 6)}-${p.slice(6, 8)}T${p.slice(9, 11)}:${p.slice(11, 13)}:00`;
}

export { addDays, strToDate, dateToStr };
