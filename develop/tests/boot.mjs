// Loads the full app entry (main.js) under Node with minimal DOM stubs, to
// catch module-graph and boot-time wiring errors that the logic smoke test
// can't see. Not a UI test — it proves the app *loads* cleanly.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const listeners = new Map();
function fakeEl(tag) {
  return {
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
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
    focus() {},
    closest() { return null; },
    replaceWith() {},
    remove() {},
    click() {},
  };
}

globalThis.window = globalThis;
delete globalThis.document;
globalThis.document = {
  createElement: (t) => fakeEl(t),
  getElementById: () => fakeEl('div'),
  body: fakeEl('body'),
  head: fakeEl('head'),
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  title: 'test',
};
Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true });
globalThis.customElements = { get: () => null, define: () => {} };
globalThis.HTMLElement = class {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    _m: new Map(),
    getItem(k) { return this._m.get(k) ?? null; },
    setItem(k, v) { this._m.set(k, String(v)); },
    removeItem(k) { this._m.delete(k); },
  },
  configurable: true,
});
globalThis.Notification = class { static permission = 'denied'; };
globalThis.fetch = async (url) => {
  const u = String(url).replace(/^(\.\.\/)+/, '');
  const p = join(root, u);
  const text = readFileSync(p, 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text, headers: new Map(), clone: () => null };
};
if (!globalThis.crypto?.randomUUID) Object.defineProperty(globalThis, 'crypto', { value: { randomUUID: () => 'uuid-' + Math.random().toString(36).slice(2) }, configurable: true });
globalThis.setInterval = () => 1;
globalThis.clearInterval = () => {};
globalThis.setTimeout = (fn) => { if (typeof fn === 'function') setTimeout(fn, 1000000); return 1; };

try {
  await import(join(root, 'app', 'src', 'main.js'));
  console.log('✓ main.js loaded + booted without errors');
  const raw = globalThis.localStorage.getItem('agenda.db.v1');
  const db = JSON.parse(raw);
  console.log(`✓ db seeded (${db.tasks.length} tasks, ${db.events.length} events, ${db.projects.length} projects, ${db.cards.length} cards)`);
} catch (e) {
  console.error('✗ boot failed:', e);
  process.exit(1);
}
