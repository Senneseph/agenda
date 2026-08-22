// agenda — the Agenda API (specs/agenda-api.json implemented locally).
// This module IS the backend of the in-browser build: every method maps 1:1
// onto an OpenAPI operation, persists to injected storage, and enforces the
// workflow specs (specs/workflow.json) via jcule's workflow engine.
//
// The contract is backend-agnostic: a real server can replace this module
// without touching any view (views talk to `api` and the `bus` only).

import { createEventBus, createWorkflow } from '../../../jcule/dist/index.js';
import { expandEvent } from './ical.js';

const DB_KEY = 'agenda.db.v1';
const COLUMNS = ['backlog', 'ready', 'inprogress', 'review', 'done'];
const COLUMN_LABEL = { backlog: 'Backlog', ready: 'Ready', inprogress: 'In progress', review: 'Review', done: 'Done' };

function uid() {
  return (globalThis.crypto?.randomUUID?.() ?? 'x' + Math.random().toString(36).slice(2) + Date.now().toString(36));
}
function nowIso() { return new Date().toISOString(); }
function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function hhmm(d) { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function localIso(d) { return `${dateStr(d)}T${hhmm(d)}:00`; }

function seedDb() {
  const now = new Date();
  const today = dateStr(now);
  const tomorrow = dateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const t2 = dateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2));
  const projectWork = { id: uid(), name: 'Work', description: 'The day job', color: '#5b8cff', archived: false, createdAt: nowIso() };
  const projectHome = { id: uid(), name: 'Personal', description: 'Family, friends, life admin', color: '#4fd1a5', archived: false, createdAt: nowIso() };
  const cardRelease = { id: uid(), projectId: projectWork.id, title: 'Ship Q3 release', description: 'Cut release branch, update changelog, notify stakeholders.', status: 'inprogress', labels: ['release'], priority: 2, estimateMin: 90, scheduledDate: tomorrow, scheduledStart: '10:00', scheduledMinutes: 90, scheduledDone: false, order: 0, createdAt: nowIso(), updatedAt: nowIso() };
  const cardStandup = { id: uid(), projectId: projectWork.id, title: 'Prepare sprint retro', description: 'Collect metrics and feedback for Thursday retro.', status: 'ready', labels: ['team'], priority: 1, estimateMin: 45, scheduledDate: null, scheduledStart: null, scheduledMinutes: null, scheduledDone: false, order: 1, createdAt: nowIso(), updatedAt: nowIso() };
  const cardParty = { id: uid(), projectId: projectHome.id, title: 'Plan birthday dinner', description: 'Pick restaurant, send invites, order cake.', status: 'backlog', labels: ['family'], priority: 1, estimateMin: 60, scheduledDate: t2, scheduledStart: '18:00', scheduledMinutes: 60, scheduledDone: false, order: 0, createdAt: nowIso(), updatedAt: nowIso() };
  const cardTaxes = { id: uid(), projectId: projectHome.id, title: 'File taxes', description: 'Gather docs and file before deadline.', status: 'backlog', labels: ['admin'], priority: 3, estimateMin: 120, scheduledDate: null, scheduledStart: null, scheduledMinutes: null, scheduledDone: false, order: 1, createdAt: nowIso(), updatedAt: nowIso() };

  const db = {
    schemaVersion: 1,
    createdAt: nowIso(),
    tasks: [
      { id: uid(), title: 'Welcome to Agenda 👋', notes: 'This is your daily task list. Type a note, schedule it with a time + reminder, or press Ctrl+K (or the mic) and talk to the app. Everything syncs to real calendars via CalDAV / Google / ICS.', date: today, time: null, durationMin: null, reminderMin: null, status: 'open', priority: 0, source: null, order: 0, createdAt: nowIso(), completedAt: null },
      { id: uid(), title: 'Take a walk', notes: '', date: today, time: '17:00', durationMin: 30, reminderMin: 15, status: 'open', priority: 1, source: null, order: 1, createdAt: nowIso(), completedAt: null },
    ],
    events: [
      { id: uid(), title: 'Team standup', description: 'Daily sync — 15 min max.', location: 'Zoom', start: `${today}T09:30:00`, end: `${today}T09:45:00`, allDay: false, rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', exdates: [], overrides: [], reminders: [{ minutes: 5 }], status: 'confirmed', color: '#5b8cff', source: 'local', externalId: null, integrationId: null, syncKey: null },
    ],
    projects: [projectWork, projectHome],
    cards: [cardRelease, cardStandup, cardParty, cardTaxes],
    integrations: [],
    settings: { reminderDefault: 15, weekStartsOn: 1, focusMinutes: 25 },
    _seq: 0,
  };
  return db;
}

export function createAgendaApi({ storage, workflowSpec, bus } = {}) {
  storage = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!storage) throw new Error('createAgendaApi: no storage provided');
  bus = bus ?? createEventBus();

  const taskWf = createWorkflow(workflowSpec.task);
  const cardWf = createWorkflow(workflowSpec.card);

  let db = load();
  function load() {
    try {
      const raw = storage.getItem(DB_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed.schemaVersion !== 1) return null;
      return parsed;
    } catch { return null; }
  }
  function save() {
    try { storage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) { console.error('agenda: save failed', e); }
  }
  function emit(resource, id) { bus.emit('db:changed', { resource, id }); }

  if (!db) { db = seedDb(); save(); }

  function nextOrder(list, key = 'order') {
    return list.reduce((m, x) => Math.max(m, x[key] ?? 0), -1) + 1;
  }

  function findTask(id) { return db.tasks.find((t) => t.id === id); }
  function findEvent(id) { return db.events.find((e) => e.id === id); }
  function findProject(id) { return db.projects.find((p) => p.id === id); }
  function findCard(id) { return db.cards.find((c) => c.id === id); }

  // ------------------------------------------------------------------ tasks

  const api = {
    bus,
    get COLUMNS() { return COLUMNS.slice(); },
    get COLUMN_LABEL() { return COLUMN_LABEL; },
    get settings() { return db.settings; },

    health() {
      return {
        status: 'ok', schemaVersion: db.schemaVersion,
        counts: {
          tasks: db.tasks.length, events: db.events.length,
          projects: db.projects.length, cards: db.cards.length,
          integrations: db.integrations.length,
        },
      };
    },

    listTasks({ date, status, source } = {}) {
      let out = db.tasks.slice();
      if (date) out = out.filter((t) => t.date === date);
      if (status) out = out.filter((t) => t.status === status);
      if (source) out = out.filter((t) => t.source === source);
      return out.sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99') || (a.order - b.order));
    },

    createTask({ title, notes = '', date, time = null, durationMin = null, reminderMin = null, priority = 1, source = null }) {
      if (!title || !date) throw new Error('createTask: title and date required');
      const task = {
        id: uid(), title: String(title).trim(), notes: notes ?? '', date, time, durationMin,
        reminderMin, status: 'open', priority, source, order: nextOrder(db.tasks),
        createdAt: nowIso(), completedAt: null,
      };
      db.tasks.push(task); save(); emit('task', task.id);
      return task;
    },

    getTask(id) { return findTask(id) ?? null; },

    updateTask(id, patch) {
      const t = findTask(id);
      if (!t) throw new Error('task not found');
      const allowed = ['title', 'notes', 'date', 'time', 'durationMin', 'reminderMin', 'priority'];
      for (const k of allowed) if (k in patch) t[k] = patch[k];
      save(); emit('task', id);
      return t;
    },

    deleteTask(id) {
      db.tasks = db.tasks.filter((t) => t.id !== id);
      save(); emit('task', id);
    },

    completeTask(id) {
      const t = findTask(id);
      if (!t) throw new Error('task not found');
      const next = taskWf.next(t.status, 'complete');
      if (!next) throw new Error(`cannot complete a ${t.status} task`);
      t.status = next; t.completedAt = nowIso();
      if (t.source?.startsWith('card:')) refreshCardScheduleDone(t.source.slice(5));
      save(); emit('task', id);
      return t;
    },

    reopenTask(id) {
      const t = findTask(id);
      if (!t) throw new Error('task not found');
      const next = taskWf.next(t.status, 'reopen');
      if (!next) throw new Error(`cannot reopen a ${t.status} task`);
      t.status = next; t.completedAt = null;
      if (t.source?.startsWith('card:')) refreshCardScheduleDone(t.source.slice(5));
      save(); emit('task', id);
      return t;
    },

    rescheduleTask(id, { date, time = null, durationMin = null, reminderMin = null }) {
      const t = findTask(id);
      if (!t) throw new Error('task not found');
      if (date) t.date = date;
      if (time !== undefined) t.time = time;
      if (durationMin != null) t.durationMin = durationMin;
      if (reminderMin != null) t.reminderMin = reminderMin;
      save(); emit('task', id);
      return t;
    },

    // ----------------------------------------------------------------- events

    listEvents({ start, end } = {}) {
      if (start && end) {
        return db.events.flatMap((ev) => expandInstance(ev, start, end));
      }
      return db.events.slice().sort((a, b) => a.start.localeCompare(b.start));
    },

    createEvent({ title, start, end, description = '', location = '', allDay = false, rrule = null, reminders = [], color = '#5b8cff', source = 'local' }) {
      if (!title || !start || !end) throw new Error('createEvent: title, start, end required');
      const ev = {
        id: uid(), title: String(title).trim(), description, location, start, end, allDay,
        rrule, exdates: [], overrides: [], reminders, status: 'confirmed',
        color, source, externalId: null, integrationId: null, syncKey: null,
      };
      db.events.push(ev); save(); emit('event', ev.id);
      return ev;
    },

    getEvent(id) { return findEvent(id) ?? null; },

    updateEvent(id, patch, { instance } = {}) {
      const ev = findEvent(id);
      if (!ev) throw new Error('event not found');
      if (instance) {
        // Detach this instance: record override + add EXDATE to the series.
        const orig = instance;
        ev.exdates = ev.exdates ?? [];
        if (!ev.exdates.includes(orig)) ev.exdates.push(orig);
        ev.overrides = ev.overrides ?? [];
        const existing = ev.overrides.find((o) => o.originalStart === orig);
        const override = {
          originalStart: orig,
          title: patch.title ?? ev.title,
          start: patch.start ?? orig,
          end: patch.end ?? patch.start ?? orig,
          description: patch.description ?? ev.description,
          location: patch.location ?? ev.location,
          allDay: patch.allDay ?? ev.allDay,
          cancelled: false,
        };
        if (existing) Object.assign(existing, override); else ev.overrides.push(override);
        // An override with a moved start no longer needs the EXDATE at the original slot.
        ev.exdates = ev.exdates.filter((x) => x !== orig || override.start === orig);
        save(); emit('event', id);
        return ev;
      }
      const allowed = ['title', 'description', 'location', 'start', 'end', 'allDay', 'rrule', 'reminders', 'color', 'status'];
      for (const k of allowed) if (k in patch) ev[k] = patch[k];
      save(); emit('event', id);
      return ev;
    },

    deleteEvent(id, { instance } = {}) {
      const ev = findEvent(id);
      if (!ev) throw new Error('event not found');
      if (instance) {
        ev.exdates = ev.exdates ?? [];
        if (!ev.exdates.includes(instance)) ev.exdates.push(instance);
        save(); emit('event', id);
        return;
      }
      db.events = db.events.filter((e) => e.id !== id);
      save(); emit('event', id);
    },

    // --------------------------------------------------------------- projects

    listProjects() {
      return db.projects
        .filter((p) => !p.archived)
        .map((p) => {
          const cards = db.cards.filter((c) => c.projectId === p.id && c.status !== 'done');
          const counts = {};
          for (const c of cards) counts[c.status] = (counts[c.status] ?? 0) + 1;
          return { ...p, cardCounts: counts };
        })
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    createProject({ name, description = '', color = '#5b8cff' }) {
      if (!name) throw new Error('createProject: name required');
      const p = { id: uid(), name: String(name).trim(), description, color, archived: false, createdAt: nowIso() };
      db.projects.push(p); save(); emit('project', p.id);
      return p;
    },

    getProject(id) { return findProject(id) ?? null; },

    updateProject(id, patch) {
      const p = findProject(id);
      if (!p) throw new Error('project not found');
      const allowed = ['name', 'description', 'color', 'archived'];
      for (const k of allowed) if (k in patch) p[k] = patch[k];
      save(); emit('project', id);
      return p;
    },

    deleteProject(id) {
      const cardIds = new Set(db.cards.filter((c) => c.projectId === id).map((c) => c.id));
      db.cards = db.cards.filter((c) => c.projectId !== id);
      db.tasks = db.tasks.filter((t) => !(t.source && cardIds.has(t.source.slice(5))));
      db.projects = db.projects.filter((p) => p.id !== id);
      save(); emit('project', id);
    },

    // ----------------------------------------------------------------- cards

    listCards({ projectId, status } = {}) {
      let out = db.cards.slice();
      if (projectId) out = out.filter((c) => c.projectId === projectId);
      if (status) out = out.filter((c) => c.status === status);
      return out.sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
    },

    createCard(projectId, { title, description = '', labels = [], priority = 1, estimateMin = null, status = 'backlog' }) {
      const p = findProject(projectId);
      if (!p) throw new Error('project not found');
      if (!title) throw new Error('createCard: title required');
      if (!cardWf.spec.states.includes(status)) status = 'backlog';
      const card = {
        id: uid(), projectId, title: String(title).trim(), description, status, labels, priority,
        estimateMin, scheduledDate: null, scheduledStart: null, scheduledMinutes: null, scheduledDone: false,
        order: nextOrder(db.cards), createdAt: nowIso(), updatedAt: nowIso(),
      };
      db.cards.push(card); save(); emit('card', card.id);
      return card;
    },

    getCard(id) { return findCard(id) ?? null; },

    updateCard(id, patch) {
      const c = findCard(id);
      if (!c) throw new Error('card not found');
      const allowed = ['title', 'description', 'labels', 'priority', 'estimateMin'];
      for (const k of allowed) if (k in patch) c[k] = patch[k];
      c.updatedAt = nowIso();
      save(); emit('card', id);
      return c;
    },

    moveCard(id, { to, event: evt = 'move' }) {
      const c = findCard(id);
      if (!c) throw new Error('card not found');
      if (c.status === to) return c;
      // Check the transition table for the exact (from, event, to) triple.
      // (jcule's next() returns the first match, so multi-target events like
      // 'move' need the explicit triple lookup.) Explicit events like
      // advance/finish/skip are strict; 'move' is the permissive drag event
      // and covers every column pair.
      const triple = (event) => cardWf.spec.transitions.some((t) => t.from === c.status && t.on === event && t.to === to);
      if (!triple(evt)) throw new Error(`workflow: cannot move card from ${c.status} to ${to} on "${evt}"`);
      c.status = to;
      c.updatedAt = nowIso();
      if (to === 'done') {
        // Completing the card completes its linked open tasks.
        for (const t of db.tasks.filter((t) => t.source === `card:${c.id}` && t.status === 'open')) {
          const n = taskWf.next(t.status, 'complete');
          if (n) { t.status = n; t.completedAt = nowIso(); }
        }
        c.scheduledDone = true;
      } else if (c.status !== 'done' && evt === 'move') {
        // moving out of done
      }
      refreshCardScheduleDone(c.id);
      save(); emit('card', id);
      return c;
    },

    deleteCard(id) {
      db.tasks = db.tasks.filter((t) => t.source !== `card:${id}`);
      db.cards = db.cards.filter((c) => c.id !== id);
      save(); emit('card', id);
    },

    /**
     * The kanban → planner → today pipeline.
     * Scheduling a card for a date creates (or updates) a linked task on that
     * day, which then shows up in the task list and — via the work block —
     * in the day planner. On the day, /now reports it as the focus.
     */
    scheduleCard(id, { date, start = null, minutes = null, reminderMin = null }) {
      const c = findCard(id);
      if (!c) throw new Error('card not found');
      if (!date) throw new Error('scheduleCard: date required');
      c.scheduledDate = date;
      c.scheduledStart = start;
      c.scheduledMinutes = minutes;
      c.scheduledDone = false;
      c.updatedAt = nowIso();

      const existing = db.tasks.find((t) => t.source === `card:${c.id}`);
      const project = findProject(c.projectId);
      const title = c.title + (project ? ` · ${project.name}` : '');
      let created = false;
      if (existing) {
        Object.assign(existing, {
          title, date, time: start, durationMin: minutes,
          reminderMin: reminderMin ?? existing.reminderMin,
          notes: c.description || existing.notes,
        });
      } else {
        const task = {
          id: uid(), title, notes: c.description || '', date, time: start,
          durationMin: minutes, reminderMin: reminderMin ?? db.settings.reminderDefault,
          status: 'open', priority: c.priority, source: `card:${c.id}`,
          order: nextOrder(db.tasks), createdAt: nowIso(), completedAt: null,
        };
        db.tasks.push(task);
        created = true;
      }
      save(); emit('card', id); emit('task');
      return { card: c, task: existing ?? db.tasks.find((t) => t.source === `card:${c.id}`), created };
    },

    unscheduleCard(id) {
      const c = findCard(id);
      if (!c) throw new Error('card not found');
      c.scheduledDate = null; c.scheduledStart = null; c.scheduledMinutes = null; c.scheduledDone = false;
      c.updatedAt = nowIso();
      // Open linked tasks are removed (they were generated work); completed ones stay as history.
      db.tasks = db.tasks.filter((t) => !(t.source === `card:${c.id}` && t.status === 'open'));
      save(); emit('card', id); emit('task');
      return c;
    },

    /** Cards scheduled for a date — the work blocks shown in the planner. */
    workBlocksForDate(date) {
      return db.cards
        .filter((c) => c.scheduledDate === date && c.status !== 'done')
        .map((c) => {
          const project = findProject(c.projectId);
          return { cardId: c.id, title: c.title, projectName: project?.name ?? '', color: project?.color ?? '#888', start: c.scheduledStart, minutes: c.scheduledMinutes, done: c.scheduledDone };
        })
        .sort((a, b) => (a.start ?? '99:99').localeCompare(b.start ?? '99:99'));
    },

    // ------------------------------------------------------------- /now

    now(at = new Date()) {
      const today = dateStr(at);
      const nowTime = hhmm(at);
      const openToday = this.listTasks({ date: today, status: 'open' });
      const doneToday = this.listTasks({ date: today, status: 'done' });
      const scheduled = openToday.filter((t) => t.time);
      const notes = openToday.filter((t) => !t.time).sort((a, b) => a.priority - b.priority || a.order - b.order);

      // events: currently happening, or starting within the next 15 minutes
      const evWindowStart = new Date(at.getTime() - 15 * 60000);
      const evWindowEnd = new Date(at.getTime() + 15 * 60000);
      const evs = this.listEvents({ start: localIso(evWindowStart), end: localIso(evWindowEnd) });
      const ev = (name) => evs.find((e) => name(e));
      const happening = ev((e) => !e.allDay && new Date(e.start) <= at && at < new Date(e.end));
      const starting = ev((e) => !e.allDay && new Date(e.start) > at && new Date(e.start).getTime() - at.getTime() <= 15 * 60000);

      let current = null;
      let context = 'clear';
      const inWindow = scheduled.find((t) => {
        const st = t.time;
        const en = addMin(t.time, t.durationMin ?? 0);
        return nowTime >= st && nowTime < en;
      });
      if (inWindow) { current = inWindow; context = 'focus'; }
      else if (happening) { current = toEventShape(happening); context = 'event'; }
      else if (starting) { current = toEventShape(starting); context = 'event-next'; }
      else {
        const next = scheduled.find((t) => t.time > nowTime);
        if (next) { current = next; context = 'next'; }
        else if (notes.length) { current = notes[0]; context = 'next'; }
        else {
          // carry over unfinished from recent days
          const prevDates = [...new Set(db.tasks.filter((t) => t.status === 'open' && t.date < today).map((t) => t.date))].sort().reverse();
          for (const d of prevDates) {
            const carry = db.tasks.filter((t) => t.status === 'open' && t.date === d)
              .sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'));
            if (carry.length) { current = carry[0]; context = 'carryover'; break; }
          }
        }
      }

      const remaining = openToday.filter((t) => t.id !== current?.id).slice(0, 3);
      const label = !current
        ? (openToday.length ? 'A quiet moment' : 'All clear — nothing scheduled today')
        : context === 'focus'
          ? `Right now: ${current.title}${current.time ? ` (until ${fmtT(addMin(current.time, current.durationMin ?? 0))})` : ''}`
          : context === 'event'
            ? `Right now: ${current.title} (until ${fmtT(current.endTime)})`
            : context === 'event-next'
              ? `Coming up: ${current.title} at ${fmtT(current.startTime)}`
              : context === 'carryover'
                ? `Carried over: ${current.title}`
                : `Next up: ${current.title}${current.time ? ` at ${fmtT(current.time)}` : ''}`;

      return {
        at: at.toISOString(), day: today, context, current,
        nextUp: remaining, dayOpen: openToday.length, dayDone: doneToday.length, label,
      };
    },

    // ---------------------------------------------------------- integrations

    listIntegrations() { return db.integrations.slice(); },
    getIntegration(id) { return db.integrations.find((i) => i.id === id) ?? null; },

    addIntegration({ type, name, config = {} }) {
      if (!['caldav', 'google', 'ics'].includes(type)) throw new Error('unknown integration type');
      const it = { id: uid(), type, name: String(name).trim(), enabled: true, config, lastSync: null, lastError: null };
      db.integrations.push(it); save(); emit('integration', it.id);
      return it;
    },

    updateIntegration(id, patch) {
      const it = db.integrations.find((i) => i.id === id);
      if (!it) throw new Error('integration not found');
      if ('enabled' in patch) it.enabled = patch.enabled;
      if (patch.config) Object.assign(it.config, patch.config);
      save(); emit('integration', id);
      return it;
    },

    removeIntegration(id) {
      db.integrations = db.integrations.filter((i) => i.id !== id);
      save(); emit('integration', id);
    },

    markSync(id, { pulled = 0, pushed = 0, errors = [] } = {}) {
      const it = db.integrations.find((i) => i.id === id);
      if (!it) return;
      it.lastSync = nowIso();
      it.lastError = errors.length ? errors.join('; ') : null;
      save(); emit('integration', id);
      return { pulled, pushed, errors, at: it.lastSync };
    },

    // ------------------------------------------------------------------- ICS

    exportIcs({ start, end } = {}) {
      const events = (start && end)
        ? db.events.flatMap((ev) => expandInstance(ev, start + 'T00:00:00', end + 'T00:00:00')).map((i) => ({
            id: i.eventId, title: i.title, description: i.description, location: i.location,
            start: i.start, end: i.end, allDay: i.allDay, color: i.color,
          }))
        : db.events.map(({ overrides, ...ev }) => ev);
      return events;
    },

    // --------------------------------------------------------------- helpers

    save,
    reset() { db = seedDb(); save(); emit('db'); },
    _raw() { return db; },
  };

  function addMin(hhmmStr, min) {
    const [h, m] = hhmmStr.split(':').map(Number);
    const d = new Date(2000, 0, 1, h, m + (min ?? 0));
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function localIso(d) {
    return `${dateStr(d)}T${hhmm(d)}:00`;
  }
  function toEventShape(e) {
    return {
      id: `evt:${e.eventId}:${e.instanceStart}`,
      kind: 'event',
      title: e.title,
      time: e.start.slice(11, 16),
      startTime: e.start.slice(11, 16),
      endTime: e.end.slice(11, 16),
      date: e.start.slice(0, 10),
      allDay: e.allDay,
      eventId: e.eventId,
      status: 'open',
    };
  }
  function fmtT(hhmmStr) {
    const [h, m] = hhmmStr.split(':').map(Number);
    const ap = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return m ? `${h12}:${String(m).padStart(2, '0')}${ap}` : `${h12}${ap}`;
  }

  function refreshCardScheduleDone(cardId) {
    const c = findCard(cardId);
    if (!c) return;
    if (!c.scheduledDate) { c.scheduledDone = false; return; }
    const open = db.tasks.filter((t) => t.source === `card:${cardId}` && t.date === c.scheduledDate && t.status === 'open');
    c.scheduledDone = open.length === 0 && db.tasks.some((t) => t.source === `card:${cardId}` && t.date === c.scheduledDate);
  }

  function expandInstance(ev, start, end) {
    if (ev.rrule) return expandEvent(ev, start, end);
    const s = new Date(start), e = new Date(end);
    const es = new Date(ev.start), ee = new Date(ev.end);
    if (ee <= s || es >= e) return [];
    return [{
      eventId: ev.id, instanceStart: ev.start, start: ev.start, end: ev.end,
      allDay: ev.allDay, title: ev.title, description: ev.description ?? '',
      location: ev.location ?? '', color: ev.color ?? '', source: ev.source ?? 'local', isException: false,
    }];
  }

  return api;
}
