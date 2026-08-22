// agenda — Integrations. Real calendar standards only: CalDAV (RFC 4791),
// Google Calendar (Calendar API v3 via OAuth client id), and iCalendar
// (RFC 5545) import/export. No invented protocols.

import { el, icon, openModal, confirmDlg, field, textInput, toast } from '../ui.js';
import { CalDavClient } from '../caldav.js';
import { serializeIcs, parseIcs } from '../ical.js';
import { todayStr, addDays } from '../ui.js';

export function renderIntegrations(root, ctx) {
  const { api } = ctx;
  const body = el('div', { class: 'intg-body' });

  function render() {
    const list = api.listIntegrations();
    body.replaceChildren(
      el('div', { class: 'intg-section' },
        el('h3', {}, 'Calendar services'),
        el('p', { class: 'muted' }, 'Sync with the big ones — Google Calendar, Apple iCloud, Fastmail, Outlook.com, Nextcloud, any CalDAV server. Agenda speaks iCalendar, so nothing here is proprietary.'),
        list.length
          ? list.map(intgRow)
          : el('div', { class: 'empty-state small' }, el('p', {}, 'No integrations yet. Add one below, or just use ICS import/export.')),
        el('div', { class: 'intg-add' },
          el('button', { class: 'btn btn-ghost', onclick: () => caldavModal() }, '＋ CalDAV'),
          el('button', { class: 'btn btn-ghost', onclick: () => googleModal() }, '＋ Google Calendar'),
        ),
      ),
      el('div', { class: 'intg-section' },
        el('h3', {}, 'iCalendar (ICS)'),
        el('p', { class: 'muted' }, 'Import or export .ics files — the interchange format every calendar app understands.'),
        el('div', { class: 'intg-actions' },
          el('label', { class: 'btn btn-ghost', style: 'cursor:pointer' },
            '📥 Import .ics',
            el('input', { type: 'file', accept: '.ics,text/calendar', style: 'display:none', onchange: (e) => importFile(e) }),
          ),
          el('button', { class: 'btn btn-ghost', onclick: () => exportIcs() }, '📤 Export .ics'),
        ),
      ),
      el('div', { class: 'intg-section' },
        el('h3', {}, 'Storage & data'),
        el('p', { class: 'muted' }, 'All data lives in your browser (localStorage). A future hosted backend can take over via the same Agenda API.'),
        el('div', { class: 'intg-actions' },
          el('button', { class: 'btn btn-danger', onclick: async () => {
            if (await confirmDlg('Reset ALL Agenda data (tasks, events, projects, integrations)?', { danger: true, okLabel: 'Reset everything' })) {
              api.reset(); toast('Agenda reset', { kind: 'info' }); ctx.bus.emit('ui:refresh'); render();
            }
          } }, 'Reset all data'),
        ),
      ),
    );
  }

  function intgRow(it) {
    const meta = {
      caldav: { label: 'CalDAV', url: it.config?.url ?? '' },
      google: { label: 'Google Calendar', url: it.config?.calendarId ?? 'primary' },
      ics: { label: 'ICS feed', url: it.config?.url ?? '' },
    }[it.type];
    const row = el('div', { class: 'intg-row' },
      el('span', { class: 'intg-type' }, meta.label),
      el('div', { class: 'intg-info' },
        el('div', { class: 'intg-name' }, it.name),
        el('div', { class: 'intg-meta muted' },
          meta.url, ' · ', it.enabled ? 'enabled' : 'disabled',
          it.lastSync ? ` · last sync ${new Date(it.lastSync).toLocaleString()}` : '',
          it.lastError ? ` · ⚠ ${it.lastError}` : '',
        ),
      ),
      el('div', { class: 'intg-ops' },
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => sync(it) }, 'Sync'),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { api.updateIntegration(it.id, { enabled: !it.enabled }); toast(it.enabled ? 'Disabled' : 'Enabled', { kind: 'info' }); render(); } }, it.enabled ? 'Disable' : 'Enable'),
        el('button', { class: 'btn btn-ghost btn-sm danger', onclick: async () => {
          if (await confirmDlg(`Remove “${it.name}”? Synced events stay local.`, { danger: true, okLabel: 'Remove' })) {
            api.removeIntegration(it.id); toast('Integration removed', { kind: 'info' }); render();
          }
        } }, 'Remove'),
      ),
    );
    return row;
  }

  function caldavModal() {
    const inputs = {};
    const body = el('div', { class: 'modal-form' },
      field('Name', inputs.name = textInput('My CalDAV calendar', { placeholder: 'e.g. iCloud — Work' })),
      field('Server URL', inputs.url = textInput('', { placeholder: 'https://caldav.icloud.com/' })),
      field('Username', inputs.user = textInput('', { placeholder: 'email or user id' })),
      field('Password / app password', inputs.pass = textInput('', { type: 'password', placeholder: 'app-specific password' })),
      field('Calendar path (optional)', inputs.path = textInput('', { placeholder: 'leave empty to auto-discover' })),
    );
    const { close } = openModal({
      title: 'Add CalDAV calendar',
      width: 460,
      body,
      footer: el('div', { class: 'modal-actions' },
        el('button', { class: 'btn', onclick: close }, 'Cancel'),
        el('button', { class: 'btn btn-primary', onclick: async (e) => {
          const btn = e.target;
          btn.disabled = true; btn.textContent = 'Connecting…';
          try {
            const it = api.addIntegration({
              type: 'caldav', name: inputs.name.value.trim() || 'CalDAV',
              config: { url: inputs.url.value.trim(), username: inputs.user.value.trim(), password: inputs.pass.value, calendarPath: inputs.path.value.trim() || null },
            });
            await sync(it, { quiet: true });
            toast('CalDAV calendar added' + (it.lastError ? ` (${it.lastError})` : ''), { kind: it.lastError ? 'warn' : 'success', icon: 'check' });
            close(); render();
          } catch (err) {
            toast('Connection failed: ' + (err.message ?? err), { kind: 'warn' });
          } finally { btn.disabled = false; btn.textContent = 'Add calendar'; }
        } }, 'Add calendar'),
      ),
    });
  }

  function googleModal() {
    const inputs = {};
    const body = el('div', { class: 'modal-form' },
      field('Name', inputs.name = textInput('Google Calendar', { placeholder: 'e.g. Google — primary' })),
      field('Google OAuth Client ID', inputs.clientId = textInput('', { placeholder: 'xxxx.apps.googleusercontent.com' })),
      field('Calendar ID (optional)', inputs.calId = textInput('', { placeholder: 'primary' })),
      el('p', { class: 'muted' }, 'Create a client id at console.cloud.google.com (Web application, origin = where Agenda runs, redirect = same origin). Agenda opens Google’s consent screen, stores the token locally, and talks Calendar API v3.'),
    );
    const { close } = openModal({
      title: 'Add Google Calendar',
      width: 460,
      body,
      footer: el('div', { class: 'modal-actions' },
        el('button', { class: 'btn', onclick: close }, 'Cancel'),
        el('button', { class: 'btn btn-primary', onclick: async () => {
          const it = api.addIntegration({
            type: 'google', name: inputs.name.value.trim() || 'Google Calendar',
            config: { clientId: inputs.clientId.value.trim(), calendarId: inputs.calId.value.trim() || 'primary' },
          });
          const res = await sync(it, { quiet: true });
          toast(res?.errors?.length ? `Google: ${res.errors[0]}` : 'Google Calendar added', { kind: res?.errors?.length ? 'warn' : 'success', icon: 'check' });
          close(); render();
        } }, 'Add & authorize'),
      ),
    });
  }

  // ------------------------------------------------------------ sync

  async function sync(it, { quiet = false } = {}) {
    if (!it.enabled && !quiet) { toast('Integration is disabled', { kind: 'warn' }); return; }
    toast(`Syncing ${it.name}…`, { kind: 'info', icon: 'repeat' });
    const res = await runSync(it);
    if (!quiet) render();
    return res;
  }

  async function runSync(it) {
    try {
      if (it.type === 'caldav') return await syncCalDav(it);
      if (it.type === 'google') return await syncGoogle(it);
      return { pulled: 0, pushed: 0, errors: ['ICS feeds need manual import — use the ICS buttons.'] };
    } catch (e) {
      api.markSync(it.id, { errors: [String(e.message ?? e)] });
      return { pulled: 0, pushed: 0, errors: [String(e.message ?? e)] };
    }
  }

  async function syncCalDav(it) {
    const client = new CalDavClient(it.config);
    let calendarUrl = it.config.calendarPath;
    if (!calendarUrl) {
      const home = await client.discoverHome();
      const calendars = await client.listCalendars(home);
      if (!calendars.length) throw new Error('no calendars found at ' + home);
      calendarUrl = calendars[0].href;
      api.updateIntegration(it.id, { config: { calendarPath: calendarUrl } });
    }
    const windowStart = todayStr();
    const windowEnd = addDays(windowStart, 400);
    const remote = await client.fetchEvents(calendarUrl, `${windowStart}T00:00:00`, `${windowEnd}T00:00:00`);
    const local = api.listEvents().filter((e) => e.integrationId === it.id);

    // pull: upsert by externalId
    let pulled = 0;
    for (const r of remote) {
      const externalId = r.event.externalId ?? r.event.id ?? r.href;
      const existing = local.find((e) => e.externalId === externalId);
      if (existing && existing.syncKey === r.etag) continue;
      const patch = {
        title: r.event.title, description: r.event.description ?? '', location: r.event.location ?? '',
        start: r.event.start, end: r.event.end, allDay: r.event.allDay,
        rrule: r.event.rrule ?? null, exdates: r.event.exdates ?? [],
        color: '#5b8cff', source: 'caldav', externalId, syncKey: r.etag, integrationId: it.id,
      };
      if (existing) api.updateEvent(existing.id, patch);
      else api.createEvent({ ...patch, reminders: [] });
      pulled++;
    }

    // push: local caldav events not seen remotely
    let pushed = 0;
    for (const e of local.filter((e) => !remote.some((r) => (r.event.externalId ?? r.event.id ?? r.href) === e.externalId))) {
      await client.pushEvent(calendarUrl, { ...e, id: e.externalId ?? e.id });
      pushed++;
    }

    const res = api.markSync(it.id, { pulled, pushed });
    toast(`Synced ${it.name}: +${pulled} pulled, ${pushed} pushed`, { kind: 'success', icon: 'check' });
    ctx.bus.emit('ui:refresh');
    return res;
  }

  async function syncGoogle(it) {
    const { clientId, calendarId = 'primary' } = it.config;
    if (!clientId) throw new Error('Google needs a client id — add it in the integration settings');
    // Load Google Identity Services lazily
    if (!window.google?.accounts?.oauth2) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.onload = res; s.onerror = () => rej(new Error('could not load Google Identity Services'));
        document.head.append(s);
      });
    }
    const token = await new Promise((res, rej) => {
      window.google.accounts.oauth2.initTokenClient({
        client_id: clientId, scope: 'https://www.googleapis.com/auth/calendar',
        callback: (r) => (r.access_token ? res(r.access_token) : rej(new Error(r.error_description ?? 'auth failed'))),
      }).requestAccessToken();
    });
    const headers = { Authorization: `Bearer ${token}` };
    const start = new Date(); const end = new Date(start.getTime() + 400 * 86400000);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${start.toISOString()}&timeMax=${end.toISOString()}&singleEvents=false&maxResults=2500`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Google Calendar → HTTP ${res.status}`);
    const data = await res.json();

    let pulled = 0;
    for (const g of data.items ?? []) {
      if (g.status === 'cancelled') { api.deleteEvent(g.id); continue; }
      const startIso = g.start?.dateTime ?? `${g.start?.date}T00:00:00`;
      const endIso = g.end?.dateTime ?? `${g.end?.date ?? g.start?.date}T23:59:00`;
      const existing = api.listEvents().find((e) => e.externalId === g.id);
      const patch = {
        title: g.summary ?? '(untitled)', description: g.description ?? '', location: g.location ?? '',
        start: startIso, end: endIso, allDay: !!g.start?.date,
        rrule: g.recurrence?.[0] ?? null, color: '#f6ad55', source: 'google',
        externalId: g.id, syncKey: String(g.updated ?? ''), integrationId: it.id,
      };
      if (existing) api.updateEvent(existing.id, patch);
      else api.createEvent({ ...patch, reminders: [], exdates: [] });
      pulled++;
    }
    const result = api.markSync(it.id, { pulled });
    toast(`Google sync: ${pulled} events`, { kind: 'success', icon: 'check' });
    ctx.bus.emit('ui:refresh');
    return result;
  }

  // ------------------------------------------------------------- ICS

  function exportIcs() {
    const events = api.exportIcs();
    const ics = serializeIcs(events);
    const blob = new Blob([ics], { type: 'text/calendar' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `agenda-${todayStr()}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`Exported ${events.length} events`, { kind: 'success', icon: 'check' });
  }

  function importFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const events = parseIcs(String(reader.result));
        let n = 0;
        for (const ev of events) {
          if (!ev.title || !ev.start || !ev.end) continue;
          api.createEvent({ title: ev.title, description: ev.description ?? '', location: ev.location ?? '', start: ev.start, end: ev.end, allDay: ev.allDay, rrule: ev.rrule ?? null, exdates: ev.exdates ?? [], reminders: ev.reminders ?? [], color: '#4fd1a5', source: 'ics' });
          n++;
        }
        toast(`Imported ${n} events from ${file.name}`, { kind: 'success', icon: 'check' });
        ctx.bus.emit('ui:refresh'); render();
      } catch (err) { toast('Import failed: ' + (err.message ?? err), { kind: 'warn' }); }
    };
    reader.readAsText(file);
  }

  root.replaceChildren(body);
  render();
  return { refresh: render };
}
