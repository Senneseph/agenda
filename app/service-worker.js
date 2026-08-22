// Agenda — service worker. Network-first for the app shell with cache fallback
// so the app works offline after first load.

const CACHE = 'agenda-v1';
const CORE = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './manifest/icon.svg',
  './src/main.js',
  './src/ui.js',
  './src/ical.js',
  './src/api.js',
  './src/intents.js',
  './src/caldav.js',
  './src/views/now.js',
  './src/views/tasks.js',
  './src/views/planner.js',
  './src/views/kanban.js',
  './src/views/integrations.js',
  '../../jcule/dist/index.js',
  '../../jellicule/dist/index.js',
  '../specs/workflow.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
  );
});
