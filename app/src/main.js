// Agenda — main. Boots the BLC (jcule event bus), loads the specs, creates the
// API, renders the lock screen (Now), and unlocks into the hub: Today, Planner,
// Projects, Integrations. Also runs the reminder engine, the voice gateway and
// the Ctrl+K command palette.

import { createEventBus } from '../../../jcule/dist/index.js';
import '../../../jellicule/dist/index.js'; // registers jel-* components + design tokens
import { createAgendaApi } from './api.js';
import { renderNow } from './views/now.js';
import { renderTasks } from './views/tasks.js';
import { renderPlanner } from './views/planner.js';
import { renderKanban } from './views/kanban.js';
import { renderIntegrations } from './views/integrations.js';
import { createCommandParser } from './intents.js';
import { expandEvent } from './ical.js';
import { el, icon, openModal, textInput, toast, todayStr, dateToStr, hhmm, addDays } from './ui.js';

const root = document.getElementById('app');
const log = (msg, data) => console.debug(`[agenda] ${msg}`, data ?? '');

const [workflowSpec] = await Promise.all([
  fetch('../specs/workflow.json').then((r) => r.json()),
]);

const bus = createEventBus();
const api = createAgendaApi({
  storage: window.localStorage,
  workflowSpec,
  bus,
});
const commands = createCommandParser(api);

// ------------------------------------------------------------- shell state

let view = 'now';
let locked = true;
let viewHandle = null; // { refresh, setDay, openTask, ... }

const hub = el('div', { class: 'hub' });
const nav = el('div', { class: 'hub-nav' });
const viewRoot = el('div', { class: 'view-root' });
hub.append(nav, viewRoot);

// --------------------------------------------------------------- context

const ctx = {
  api, bus, toast,
  unlock() { setLocked(false); },
  lock() { setLocked(true); },
  gotoTasks(day) { switchView('tasks', { day }); },
  gotoPlanner(day) { switchView('planner', { day }); },
  openTaskModal(task) {
    switchView('tasks', { day: task.date });
    viewHandle?.openTask?.(task);
  },
  openCardModal(card) {
    if (!card) return;
    switchView('projects', { projectId: card.projectId });
    viewHandle?.openCard?.(card);
  },
};

// ------------------------------------------------------------- navigation

const TABS = [
  { id: 'tasks', label: 'Today', icon: 'task' },
  { id: 'planner', label: 'Planner', icon: 'calendar' },
  { id: 'projects', label: 'Projects', icon: 'board' },
  { id: 'integrations', label: 'Integrations', icon: 'plug' },
];

function renderNav() {
  nav.replaceChildren(
    el('div', { class: 'brand' },
      el('span', { class: 'brand-dot' }),
      el('span', {}, 'Agenda'),
    ),
    el('div', { class: 'tabs' },
      TABS.map((t) => el('button', {
        class: 'tab' + (view === t.id ? ' active' : ''),
        onclick: () => switchView(t.id),
      }, icon(t.icon, 15), ` ${t.label}`)),
    ),
    el('div', { class: 'nav-right' },
      el('button', { class: 'icon-btn', title: 'Voice / command (Ctrl+K)', onclick: () => openCommandPalette() }, icon('mic', 17)),
      el('button', { class: 'icon-btn', title: 'Command palette (Ctrl+K)', onclick: () => openCommandPalette() }, '⌘'),
      el('button', { class: 'icon-btn', title: 'Lock screen', onclick: () => setLocked(true) }, icon('lock', 17)),
    ),
  );
}

function switchView(id, opts = {}) {
  view = id;
  viewRoot.replaceChildren();
  renderNav();
  if (id === 'tasks') {
    const day = opts.day ?? viewHandle?.day ?? todayStr();
    viewHandle = renderTasks(viewRoot, ctx, day);
  } else if (id === 'planner') {
    viewHandle = renderPlanner(viewRoot, ctx, { anchor: opts.day });
  } else if (id === 'projects') {
    viewHandle = renderKanban(viewRoot, ctx, { projectId: opts.projectId });
  } else if (id === 'integrations') {
    viewHandle = renderIntegrations(viewRoot, ctx);
  }
  ctx.bus.emit('ui:refresh');
}

// -------------------------------------------------------------- lock screen

let nowHandle = null;

function setLocked(value) {
  locked = value;
  if (locked) {
    view = 'now';
    hub.classList.remove('open');
    setTimeout(() => {
      if (!locked) return;
      viewRoot.replaceChildren();
      nowHandle = renderNow(viewRoot, ctx);
      root.classList.add('locked');
    }, 250);
  } else {
    root.classList.remove('locked');
    nowHandle?.stop?.();
    switchView(view === 'now' ? 'tasks' : view);
    requestAnimationFrame(() => hub.classList.add('open'));
  }
}

// --------------------------------------------------------- command palette

function openCommandPalette() {
  const input = textInput('', { placeholder: '“add task call mom tomorrow at 6pm”, “new project taxes”, “help”…' });
  input.classList.add('cmd-input');
  const resultBox = el('div', { class: 'cmd-result' });
  const run = async () => {
    const text = input.value.trim();
    if (!text) return;
    const res = commands.run(text);
    resultBox.replaceChildren(
      el('div', { class: `cmd-intent ${res.ok ? '' : 'bad'}` },
        res.ok ? `✓ ${res.intent}` : `✗ ${res.intent ?? 'unknown'}`),
      el('div', { class: 'cmd-summary' }, res.summary ?? res.error),
    );
    if (res.ok) {
      ctx.bus.emit('ui:refresh');
      viewHandle?.refresh?.();
      toast(res.summary.split('\n')[0], { kind: 'success', icon: 'check', sticky: true });
    } else {
      toast(res.error ?? res.summary, { kind: 'warn' });
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') run();
    if (e.key === 'Escape') modal.close();
  });
  const { close, el: modal } = openModal({
    title: 'Command — talk to Agenda (Ctrl+K)',
    width: 560,
    body: el('div', {}, input, resultBox),
  });
  input.focus();
  setTimeout(() => input.focus(), 50);
  return { run };
}

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!locked) openCommandPalette(); }
});

// ---------------------------------------------------------------- voice

let recognition = null;
function setupVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  recognition = new SR();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (e) => {
    const text = e.results[0][0].transcript;
    toast(`🎙 “${text}”`, { kind: 'info' });
    setTimeout(() => { const res = commands.run(text); toast(res.summary.split('\n')[0], { kind: res.ok ? 'success' : 'warn', sticky: true }); ctx.bus.emit('ui:refresh'); viewHandle?.refresh?.(); }, 350);
  };
  recognition.onerror = (e) => toast(`Voice: ${e.error}`, { kind: 'warn' });
}

// ---------------------------------------------------------------- reminders

const armed = new Set();
function fireReminder(title, when) {
  const body = `Now: ${title}`;
  if (window.Notification && Notification.permission === 'granted') {
    try { new Notification('Agenda', { body, icon: 'manifest/icon.svg' }); return; } catch { /* fall through */ }
  }
  toast(`⏰ ${body}`, { kind: 'warn', sticky: true });
}

function armReminders() {
  const now = new Date();
  const horizon = now.getTime() + 24 * 3600000;
  const arm = (when, key, title) => {
    const t = new Date(when).getTime();
    if (t <= now.getTime() + 2000 || t > horizon) return;
    const k = `${key}:${t}`;
    if (armed.has(k)) return;
    armed.add(k);
    setTimeout(() => fireReminder(title, when), t - now.getTime());
  };
  for (const t of api.listTasks({ status: 'open' })) {
    if (t.time && t.reminderMin != null) {
      arm(new Date(`${t.date}T${t.time}:00`).getTime() - t.reminderMin * 60000, `task:${t.id}`, t.title);
    }
  }
  for (const ev of api.listEvents()) {
    for (const r of ev.reminders ?? []) {
      const instances = ev.rrule
        ? expandEvent(ev, new Date(now.getTime() - 86400000).toISOString(), new Date(horizon + 86400000).toISOString())
        : [{ start: ev.start, title: ev.title }];
      for (const inst of instances) {
        arm(new Date(inst.start).getTime() - r.minutes * 60000, `evt:${ev.id}:${inst.start}`, inst.title);
      }
    }
  }
}

function requestNotifications() {
  if (window.Notification && Notification.permission === 'default') {
    Notification.requestPermission().then((p) => log('notification permission', p));
  }
}

// ------------------------------------------------------------- live refresh

let refreshTimer = null;
bus.on('db:changed', () => { viewHandle?.refresh?.(); if (!locked) armReminders(); });
bus.on('ui:refresh', () => { viewHandle?.refresh?.(); });
setInterval(() => { if (!locked && view === 'tasks') viewHandle?.refresh?.(); armReminders(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) armReminders(); });

// ------------------------------------------------------------------- boot

function boot() {
  setupVoice();
  requestNotifications();
  renderNav();
  root.append(hub);
  root.classList.add('locked');
  nowHandle = renderNow(viewRoot, ctx);
  armReminders();
  log('booted');
}

boot();
