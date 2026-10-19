// Buccaneer Cove service worker.
//
// The build (the `pwa` plugin in vite.config.ts) replaces the BUILD placeholder below with the
// list of every file in dist and its content hash, so:
//  - the app shell (index.html, JS/CSS bundles, fonts, icons, decoders, small JSON) is precached
//    into a cache named after the build hash, and old shell caches are dropped on activate;
//  - the large game assets under assets/ are cached lazily, cache-first, into one long-lived cache
//    whose entries carry their content hash, so changed or removed files get pruned on activate;
//  - navigations are network-first with the cached index.html as the offline fallback;
//  - a new worker waits until the page asks it to take over (the "Update ready" toast), it never
//    skips waiting by itself in the middle of a game;
//  - Range requests (streamed music through <audio>) are answered with a 206 slice of the cached
//    file, or passed through to the network while the full file is cached in the background.
// In dev the placeholder stays null and the worker is never registered (see src/ui/install.ts).

/** @type {{ version: string, shell: [string, string][], assets: [string, string, number][] } | null} */
const BUILD = /*__BC_BUILD__*/ null;

const VERSION = BUILD ? BUILD.version : 'dev';
const SHELL_CACHE = `bc-shell-${VERSION}`;
const ASSET_CACHE = 'bc-assets';
const HASH_HEADER = 'x-bc-hash';
const SCOPE = self.registration.scope;
/** how long a navigation waits for the network before falling back to the cached shell */
const NAV_TIMEOUT = 4000;

/** path (relative to the scope) -> hash, for both precached and lazily cached files */
const shell = new Map((BUILD ? BUILD.shell : []).map(([p, h]) => [p, h]));
const assets = new Map((BUILD ? BUILD.assets : []).map(([p, h, n]) => [p, { hash: h, size: n }]));

const abs = (path) => new URL(path, SCOPE).href;
/** the scope-relative path of a same-origin URL, or null when it is outside the scope */
function relPath(url) {
  if (!url.href.startsWith(SCOPE)) return null;
  return decodeURIComponent(url.href.slice(SCOPE.length).split(/[?#]/)[0]);
}

/** re-wrap a response with its content hash in a header, so later builds can tell stale copies */
function stamped(res, hash) {
  const headers = new Headers(res.headers);
  headers.set(HASH_HEADER, hash);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** a copy of `path` with this hash already held in any of our caches (so updates only fetch what changed) */
async function cachedCopy(path, hash) {
  for (const name of await caches.keys()) {
    if (!name.startsWith('bc-')) continue;
    const hit = await (await caches.open(name)).match(abs(path));
    if (hit && hit.headers.get(HASH_HEADER) === hash) return hit;
  }
  return null;
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const todo = [...shell];
      // a handful at a time, so one install does not open dozens of sockets on a phone
      const worker = async () => {
        for (let job = todo.shift(); job; job = todo.shift()) {
          const [path, hash] = job;
          let res = await cachedCopy(path, hash);
          if (!res) {
            res = await fetch(abs(path), { cache: 'no-cache' });
            if (!res.ok) throw new Error(`precache ${path}: ${res.status}`);
            res = stamped(res, hash);
          }
          await cache.put(abs(path), res);
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      // The first install has nothing to replace, so it can take over at once; an update waits
      // for the page to say so (the player picks "Restart" on the update toast).
      if (!self.registration.active) await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name !== SHELL_CACHE && name !== ASSET_CACHE) await caches.delete(name);
      // drop asset copies that this build no longer ships, or ships with different content
      if (BUILD) {
        const cache = await caches.open(ASSET_CACHE);
        for (const req of await cache.keys()) {
          const path = relPath(new URL(req.url));
          const want = path !== null && assets.get(path);
          if (!want) {
            await cache.delete(req);
            continue;
          }
          const res = await cache.match(req);
          if (!res || res.headers.get(HASH_HEADER) !== want.hash) await cache.delete(req);
        }
      }
      await self.clients.claim();
    })(),
  );
});

/** fetch an asset in full and keep it */
async function fetchAndCache(path, hash) {
  const res = await fetch(abs(path));
  if (res.ok && res.status === 200) {
    const cache = await caches.open(ASSET_CACHE);
    await cache.put(abs(path), stamped(res.clone(), hash));
  }
  return res;
}

/** answer a Range request from a full cached response (what <audio>/<video> elements send) */
async function rangeFrom(res, range) {
  const blob = await res.blob();
  const size = blob.size;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  let start, end;
  if (m && m[1] === '' && m[2] !== '') {
    start = Math.max(0, size - +m[2]); // suffix range: the last N bytes
    end = size - 1;
  } else if (m && m[1] !== '') {
    start = +m[1];
    end = m[2] === '' ? size - 1 : Math.min(+m[2], size - 1);
  }
  if (start === undefined || start >= size || end < start)
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': res.headers.get('Content-Type') || blob.type || 'application/octet-stream',
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    },
  });
}

/** the app shell, so a navigation works offline */
async function offlinePage() {
  const cache = await caches.open(SHELL_CACHE);
  return (await cache.match(abs('index.html'))) || (await cache.match(abs('./'))) || (await caches.match(abs('index.html'), { ignoreSearch: true }));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const path = relPath(url);
  if (path === null || path === 'sw.js') return;

  if (req.mode === 'navigate') {
    // network-first: a fresh index.html points at the newest bundles once the new worker is in
    // (with a time limit: on a dead or crawling connection the cached shell is served instead)
    e.respondWith(
      (async () => {
        const net = fetch(req).catch(() => null);
        const first = await Promise.race([net, new Promise((r) => setTimeout(() => r('slow'), NAV_TIMEOUT))]);
        if (first && first !== 'slow' && first.ok) return first;
        const cached = await offlinePage();
        if (cached) return cached;
        return (first !== 'slow' && first) || (await net) || Response.error();
      })(),
    );
    return;
  }

  const range = req.headers.get('range');
  const shellHash = shell.get(path);
  if (shellHash) {
    e.respondWith(
      (async () => {
        const hit = await caches.match(abs(path), { cacheName: SHELL_CACHE });
        if (hit) return range ? rangeFrom(hit, range) : hit;
        return fetch(req);
      })(),
    );
    return;
  }

  const asset = assets.get(path);
  if (asset) {
    e.respondWith(
      (async () => {
        const cache = await caches.open(ASSET_CACHE);
        const hit = await cache.match(abs(path));
        if (hit) return range ? rangeFrom(hit, range) : hit;
        if (range) {
          // stream this one straight from the network (a partial response cannot be cached),
          // and keep a full copy for next time and for offline play
          e.waitUntil(fetchAndCache(path, asset.hash).catch(() => {}));
          return fetch(req);
        }
        return fetchAndCache(path, asset.hash);
      })(),
    );
    return;
  }

  // anything not in the build (dev files, stray URLs): network, falling back to any cached copy
  e.respondWith(fetch(req).catch(() => caches.match(req).then((r) => r || Response.error())));
});

/** how much of the game is held for offline play */
async function status() {
  const cache = await caches.open(ASSET_CACHE);
  const have = new Set((await cache.keys()).map((r) => r.url));
  const missing = [];
  let bytes = 0, cachedBytes = 0;
  for (const [path, a] of assets) {
    bytes += a.size;
    if (have.has(abs(path))) cachedBytes += a.size;
    else missing.push([path, a.size]);
  }
  return { version: VERSION, total: assets.size, cached: assets.size - missing.length, bytes, cachedBytes, missing };
}

self.addEventListener('message', (e) => {
  const msg = e.data || {};
  const reply = (v) => e.ports[0] && e.ports[0].postMessage(v);
  if (msg.type === 'skip-waiting') self.skipWaiting();
  else if (msg.type === 'version') reply({ version: VERSION });
  else if (msg.type === 'status') e.waitUntil(status().then(reply, (err) => reply({ error: String(err) })));
  else if (msg.type === 'warm' && Array.isArray(msg.urls)) {
    // files the page loaded before this worker controlled it (the very first visit): keep them
    e.waitUntil(
      (async () => {
        const cache = await caches.open(ASSET_CACHE);
        for (const u of msg.urls) {
          const path = relPath(new URL(u, SCOPE));
          const a = path !== null && assets.get(path);
          if (!a || (await cache.match(abs(path)))) continue;
          await fetchAndCache(path, a.hash).catch(() => {});
        }
        reply({ ok: true });
      })(),
    );
  }
});
