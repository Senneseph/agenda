// Exercises every view's render path under DOM stubs — catches typos and
// undefined references that only fire when a view actually renders.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const listeners = new Map();
function fakeEl(tag) {
  const node = {
    tagName: String(tag).toUpperCase(), nodeType: 1, children: [], attributes: {}, style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    append(...kids) { for (const k of kids) if (k) this.children.push(k); },
    replaceChildren(...kids) { this.children = kids.filter(Boolean); },
    appendChild(k) { this.children.push(k); return k; },
    addEventListener(type, fn) { const m = listeners.get(this) ?? new Map(); m.set(type, fn); listeners.set(this, m); },
    removeEventListener() {},
    setAttribute(k, v) { this.attributes[k] = v; },
    removeAttribute(k) { delete this.attributes[k]; },
    getAttribute(k) { return this.attributes[k]; },
    hasAttribute(k) { return k in this.attributes; },
    querySelector(sel) { return querySel(this, sel); },
    querySelectorAll() { return []; },
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
    focus() {}, closest() { return null; }, replaceWith() {}, remove() {}, click() {},
    value: '', textContent: '', checked: false,
  };
  return node;
}
function querySel(node, sel) {
  if (typeof sel !== 'string' || !sel.startsWith('.')) return null;
  const cls = sel.slice(1);
  for (const c of node.children ?? []) {
    if (c == null || typeof c !== 'object') continue;
    if (c.className === cls || String(c.className).split(' ').includes(cls)) return c;
    const hit = querySel(c, sel);
    if (hit) return hit;
  }
  return null;
}
globalThis.window = globalThis;
delete globalThis.document;
globalThis.document = {
  createElement: (t) => fakeEl(t), getElementById: () => fakeEl('div'), body: fakeEl('body'), head: fakeEl('head'),
  addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
};
Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true });
globalThis.customElements = { get: () => null, define: () => {} };
globalThis.HTMLElement = class {};
Object.defineProperty(globalThis, 'localStorage', { value: { _m: new Map(), getItem(k) { return this._m.get(k) ?? null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } }, configurable: true });
globalThis.Notification = class { static permission = 'denied'; };
globalThis.fetch = async (url) => {
  const p = join(root, String(url).replace(/^\.\.\/\.\.\//, ''));
  const text = readFileSync(p, 'utf8');
  return { ok: true, json: async () => JSON.parse(text), text: async () => text };
};
if (!globalThis.crypto?.randomUUID) Object.defineProperty(globalThis, 'crypto', { value: { randomUUID: () => 'u' + Math.random().toString(36).slice(2) }, configurable: true });
globalThis.setInterval = () => 1; globalThis.clearInterval = () => {};
globalThis.setTimeout = (fn) => { if (typeof fn === 'function') setTimeout(fn, 1000000); return 1; };

const workflowSpec = JSON.parse(readFileSync(join(root, 'specs', 'workflow.json'), 'utf8'));
const { createAgendaApi } = await import(join(root, 'app', 'src', 'api.js'));
const { createEventBus } = await import(join(root, '..', 'jcule', 'dist', 'index.js'));
const { renderTasks } = await import(join(root, 'app', 'src', 'views', 'tasks.js'));
const { renderPlanner } = await import(join(root, 'app', 'src', 'views', 'planner.js'));
const { renderKanban } = await import(join(root, 'app', 'src', 'views', 'kanban.js'));
const { renderIntegrations } = await import(join(root, 'app', 'src', 'views', 'integrations.js'));
const { todayStr, addDays } = await import(join(root, 'app', 'src', 'ui.js'));

const bus = createEventBus();
const api = createAgendaApi({ storage: globalThis.localStorage, workflowSpec, bus });
const ctx = { api, bus, toast: () => {}, unlock() {}, lock() {}, gotoTasks() {}, gotoPlanner() {}, openTaskModal() {}, openCardModal() {} };

const day = todayStr();
api.createTask({ title: 'demo scheduled', date: day, time: '09:30', durationMin: 45, reminderMin: 10 });
api.createEvent({ title: 'demo event', start: `${day}T11:00:00`, end: `${day}T12:00:00` });
const p = api.createProject({ name: 'Demo' });
const c = api.createCard(p.id, { title: 'demo card' });
api.scheduleCard(c.id, { date: addDays(day, 1), start: '14:00', minutes: 60 });

for (const [name, fn] of [
  ['renderTasks', () => renderTasks(fakeEl('div'), ctx, day)],
  ['renderPlanner.day', () => renderPlanner(fakeEl('div'), ctx, { mode: 'day', anchor: day })],
  ['renderPlanner.week', () => renderPlanner(fakeEl('div'), ctx, { mode: 'week', anchor: day })],
  ['renderPlanner.month', () => renderPlanner(fakeEl('div'), ctx, { mode: 'month', anchor: day })],
  ['renderKanban', () => renderKanban(fakeEl('div'), ctx, {})],
  ['renderIntegrations', () => renderIntegrations(fakeEl('div'), ctx)],
]) {
  try { fn(); console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}: ${e.message}\n${e.stack?.split('\n').slice(0,6).join('\n')}`); process.exit(1); }
}
console.log('\nall views rendered cleanly');
