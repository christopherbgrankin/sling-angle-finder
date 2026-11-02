/* Sling Angle Finder service worker
   - Offline: the app is served from the cache, so it opens with no signal.
   - Only complete 200 responses are ever cached (a dropped download can't poison the cache).
   - Update checks are driven by the page (every 14 days, or on demand). */
const CACHE = 'saf-v2';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

// Fetch fresh, read the whole body, cache it. Returns {res, changed}.
async function refresh(req, compare) {
  const res = await fetch(req, { cache: 'no-store' });
  if (!res || res.status !== 200 || (res.type !== 'basic' && res.type !== 'cors')) return { res, changed: false, failed: true };
  const body = await res.clone().arrayBuffer();
  const cache = await caches.open(CACHE);
  let changed = false;
  if (compare) {
    const old = await cache.match(req, { ignoreSearch: true });
    if (old) {
      const a = new Uint8Array(await old.arrayBuffer()), b = new Uint8Array(body);
      changed = a.length !== b.length;
      for (let i = 0; !changed && i < b.length; i++) if (a[i] !== b[i]) changed = true;
    }
  }
  await cache.put(req, new Response(body, { status: 200, statusText: 'OK', headers: res.headers }));
  return { res, changed };
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin && !FONT_HOSTS.includes(url.hostname)) return;
  if (url.pathname.endsWith('/sw.js')) return;
  e.respondWith((async () => {
    const hit = await (await caches.open(CACHE)).match(req, { ignoreSearch: true });
    if (hit) return hit;
    try { return (await refresh(req, false)).res; }
    catch (err) { return new Response('Offline and not saved yet. Open the app once with signal.', { status: 503, headers: { 'Content-Type': 'text/plain' } }); }
  })());
});

self.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'check' || !e.data.url) return;
  e.waitUntil((async () => {
    let msg;
    try { const r = await refresh(new Request(e.data.url), true); msg = r.failed ? 'error' : r.changed ? 'updated' : 'current'; }
    catch (err) { msg = 'error'; }
    if (e.source) e.source.postMessage({ type: msg });
  })());
});
