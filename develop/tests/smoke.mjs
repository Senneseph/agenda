// Agenda smoke test — runs the API, workflow, pipeline, recurrence and
// command parser under Node (no DOM needed). Mirrors cicda/tests/smoke.mjs
// style used across the WebAX repos.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const workflowSpec = JSON.parse(readFileSync(join(root, 'specs', 'workflow.json'), 'utf8'));

// ---- in-memory storage shim ----
function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}

const { createAgendaApi } = await import(join(root, 'app', 'src', 'api.js'));
const { createCommandParser } = await import(join(root, 'app', 'src', 'intents.js'));
const { expandEvent, serializeIcs, parseIcs } = await import(join(root, 'app', 'src', 'ical.js'));

let pass = 0;
function ok(name, cond, extra = '') {
  assert.ok(cond, name + (extra ? ` — ${extra}` : ''));
  pass++;
  console.log(`  ✓ ${name}`);
}

// ---------------------------------------------------------------- setup

const storage = memoryStorage();
const api = createAgendaApi({ storage, workflowSpec });

console.log('\nagenda smoke');
console.log('  health / seed');
ok('seeded on first run', api.health().counts.tasks >= 1);
ok('two seeded projects', api.listProjects().length === 2);

// ---------------------------------------------------------------- tasks

console.log('  tasks');
const t1 = api.createTask({ title: 'call mom', date: '2026-08-25', time: '18:00', reminderMin: 15 });
ok('create task', api.getTask(t1.id).title === 'call mom');
ok('scheduled task lists under its date', api.listTasks({ date: '2026-08-25' }).some((t) => t.id === t1.id));
api.completeTask(t1.id);
ok('complete → done', api.getTask(t1.id).status === 'done');
api.reopenTask(t1.id);
ok('reopen → open', api.getTask(t1.id).status === 'open');
api.updateTask(t1.id, { notes: 'ask about saturday' });
ok('update notes', api.getTask(t1.id).notes === 'ask about saturday');
api.deleteTask(t1.id);
ok('delete task', api.getTask(t1.id) === null);

// ------------------------------------------------------------ the pipeline

console.log('  kanban → planner → today pipeline');
const p = api.createProject({ name: 'Taxes', color: '#f6ad55' });
const card = api.createCard(p.id, { title: 'File Q3 return', status: 'backlog' });
ok('card in backlog', api.getCard(card.id).status === 'backlog');

const { task } = api.scheduleCard(card.id, { date: '2026-08-25', start: '10:00', minutes: 90, reminderMin: 20 });
ok('schedule creates linked task', task && task.source === `card:${card.id}`);
ok('linked task carries time+reminder', task.time === '10:00' && task.reminderMin === 20);
ok('card remembers schedule', api.getCard(card.id).scheduledDate === '2026-08-25');
ok('work block visible for that date', api.workBlocksForDate('2026-08-25').length === 1);

api.completeTask(task.id);
ok('completing task marks card scheduledDone', api.getCard(card.id).scheduledDone === true);

api.moveCard(card.id, { to: 'inprogress' });
ok('workflow advance to inprogress', api.getCard(card.id).status === 'inprogress');
api.moveCard(card.id, { to: 'done' });
ok('move to done allowed', api.getCard(card.id).status === 'done');
ok('card in done clears schedule block', api.workBlocksForDate('2026-08-25').length === 0);

// workflow rejection
const card2 = api.createCard(p.id, { title: 'Unstarted work' });
assert.throws(() => api.moveCard(card2.id, { to: 'done', event: 'finish' }), /workflow/);
ok('illegal transition rejected', true);

// unschedule
const card3 = api.createCard(p.id, { title: 'Maybe later' });
api.scheduleCard(card3.id, { date: '2026-09-01' });
ok('unschedule clears tasks', api.unscheduleCard(card3.id).scheduledDate === null && api.listTasks({ source: `card:${card3.id}` }).length === 0);

// ---------------------------------------------------------------- events

console.log('  events + recurrence (RFC 5545)');
const ev = api.createEvent({
  title: 'Standup', start: '2026-08-24T09:30:00', end: '2026-08-24T09:45:00',
  rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', reminders: [{ minutes: 5 }],
});
const instances = api.listEvents({ start: '2026-08-24T00:00:00', end: '2026-09-06T00:00:00' });
const weekInstances = instances.filter((i) => i.eventId === ev.id);
ok('weekly MWF expands to 6 in 2 weeks', weekInstances.length === 6, `got ${weekInstances.length}`);
ok('first instance monday 09:30', weekInstances[0].start === '2026-08-24T09:30:00');

api.updateEvent(ev.id, { start: '2026-08-26T10:00:00', end: '2026-08-26T10:30:00' }, { instance: '2026-08-26T09:30:00' });
const afterEdit = api.listEvents({ start: '2026-08-24T00:00:00', end: '2026-08-28T00:00:00' });
ok('single-instance edit detaches (wed at 10:00)', afterEdit.some((i) => i.eventId === ev.id && i.start === '2026-08-26T10:00:00' && i.isException));
ok('original wed slot excluded', !afterEdit.some((i) => i.eventId === ev.id && i.start === '2026-08-26T09:30:00'));

api.deleteEvent(ev.id, { instance: '2026-08-28T09:30:00' });
const afterDel = api.listEvents({ start: '2026-08-28T00:00:00', end: '2026-08-29T00:00:00' });
ok('delete one instance → EXDATE', afterDel.filter((i) => i.eventId === ev.id).length === 0);

// --------------------------------------------------------------- ICS

console.log('  ICS round-trip');
const ics = serializeIcs([api.getEvent(ev.id)]);
ok('ics contains RRULE', ics.includes('RRULE:FREQ=WEEKLY'));
const parsed = parseIcs(ics);
ok('parse round-trip keeps title', parsed[0].title === 'Standup');
ok('parse keeps recurrence', parsed[0].rrule === 'FREQ=WEEKLY;BYDAY=MO,WE,FR');

// ---------------------------------------------------------------- now

console.log('  /now');
const monday = new Date('2026-08-24T09:30:00'); // monday morning, standup starts
const n1 = api.now(monday);
ok('standup (calendar event) is current focus', n1.context === 'event' && /standup/i.test(n1.current?.title ?? ''), n1.context + ' / ' + n1.current?.title);

const t2 = api.createTask({ title: 'deep work', date: '2026-08-24', time: '14:00', durationMin: 120 });
const n2 = api.now(new Date('2026-08-24T13:40:00'));
ok('next up before window', n2.context === 'next' && n2.current?.id === t2.id);
const n3 = api.now(new Date('2026-08-24T14:30:00'));
ok('focus inside window', n3.context === 'focus' && n3.current?.id === t2.id);
const n4 = api.now(new Date('2026-08-24T16:30:00'));
ok('after window → note/carryover or clear', ['next', 'carryover', 'clear'].includes(n4.context));

// ------------------------------------------------------------ commands

console.log('  voice commands');
const cmd = createCommandParser(api);
const r1 = cmd.run('add task buy milk tomorrow at 8am', { date: '2026-08-24' });
ok('task.create parses', r1.ok && r1.intent === 'task.create' && r1.result.task.title === 'buy milk');
ok('tomorrow lands on the right day', r1.result.task.date === '2026-08-25' && r1.result.task.time === '08:00', r1.result.task.date + ' ' + r1.result.task.time);
ok('default reminder attached when scheduled', r1.result.task.reminderMin != null);

const r2 = cmd.run('what am I doing today', { date: '2026-08-24' });
ok('task.list intent', r2.ok && r2.intent === 'task.list' && Array.isArray(r2.result.tasks));

const r3 = cmd.run('new project Renovation');
ok('project.create', r3.ok && api.listProjects().some((x) => x.name === 'Renovation'));

const r4 = cmd.run('project Renovation add card paint bedroom, schedule it for next tuesday');
ok('card.add + schedule in one command', r4.ok, JSON.stringify(r4));
const renovation = api.listProjects().find((x) => x.name === 'Renovation');
const paintCard = api.listCards({ projectId: renovation.id }).find((c) => c.title.includes('paint'));
ok('paint card exists', !!paintCard);
ok('paint card scheduled on a tuesday', /2026-\d{2}-\d{2}/.test(paintCard.scheduledDate) && new Date(paintCard.scheduledDate + 'T00:00:00').getDay() === 2, paintCard.scheduledDate);

const r5 = cmd.run('move it to in progress');
ok('reference "it" resolves to last card', r5.ok && r5.result.card.status === 'inprogress');

const r6 = cmd.run('schedule a meeting friday 2pm-3pm recurring weekly');
ok('event.create with range+recurrence', r6.ok && r6.result.event.rrule === 'FREQ=WEEKLY');

const r7 = cmd.run('complete the buy milk task', { date: '2026-08-25' });
ok('task.complete', r7.ok && api.getTask(r1.result.task.id).status === 'done');

const r8 = cmd.run('gibberish nonsense words');
ok('unknown intent fails gracefully', !r8.ok && r8.error);

const r9 = cmd.run('export my calendar');
ok('export intent', r9.ok && r9.intent === 'export');

// ---------------------------------------------------------------- totals

console.log(`\n  ${pass} assertions passed\n`);
