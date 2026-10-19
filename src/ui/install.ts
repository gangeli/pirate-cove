/**
 * Installable app support: service worker registration and updates, the title-menu "Install" and
 * "Download for Offline" entries, the iOS "Add to Home Screen" hint, the "Update ready" toast, and
 * standalone polish (window-controls-overlay title strip, no pinch zoom / pull-to-refresh, wake lock).
 *
 * Hooks: main.ts calls initPwa() at startup and launchShortcut() once booted; menu.ts calls
 * pwaMenuItems() each time it renders the title menu.
 */
import './install.css';
import type { App } from './app';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
interface OfflineStatus {
  version: string;
  total: number;
  cached: number;
  bytes: number;
  cachedBytes: number;
  missing: [string, number][];
}

const mq = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;
/** running as an installed app (any of the manifest's display modes), not in a browser tab */
export function isStandalone(): boolean {
  return mq('(display-mode: standalone)') || mq('(display-mode: window-controls-overlay)') || mq('(display-mode: fullscreen)') || mq('(display-mode: minimal-ui)') || (navigator as any).standalone === true;
}
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let app: App | null = null;
let reg: ServiceWorkerRegistration | null = null;
let deferred: BeforeInstallPromptEvent | null = null;
let slot: HTMLElement | null = null;
let iosHint = false;
let offline: OfflineStatus | null = null;
let dl: { done: number; total: number; state: 'busy' | 'done' | 'error' } | null = null;

/** call once at startup, before assets start loading */
export function initPwa(a: App): void {
  app = a;
  // the first visit loads everything before the worker controls the page; remember what it was
  try {
    performance.setResourceTimingBufferSize(4000);
  } catch {}
  if (isStandalone()) document.documentElement.classList.add('pwa-standalone');
  standalonePolish();
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // show our own Install entry instead of the browser's mini-infobar
    deferred = e as BeforeInstallPromptEvent;
    renderSlot();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    renderSlot();
  });
  registerServiceWorker();
}

/** the title menu's extra entries; menu.ts calls this with its `.items` column after each render */
export function pwaMenuItems(items: Element | null): void {
  if (!items) return;
  slot = document.createElement('div');
  slot.className = 'pwa-items';
  items.appendChild(slot);
  renderSlot();
  refreshOffline();
}

/** home-screen shortcuts from the manifest: ?new=1 opens the new game setup, ?continue=1 resumes the autosave */
export async function launchShortcut(a: App, params: URLSearchParams): Promise<void> {
  const act = params.has('continue') ? 'continue' : params.has('new') ? 'new' : null;
  if (!act || a.state !== 'menu') return;
  const url = new URL(location.href);
  url.searchParams.delete('continue');
  url.searchParams.delete('new');
  history.replaceState(null, '', url);
  if (act === 'continue' && (await a.hasSave('auto'))) await a.continueGame('auto');
  else (a.menu as any).openSetup();
}

// ---------------------------------------------------------------- title menu entries

const SHARE_ICON = '<svg width="16" height="18" viewBox="0 0 16 18" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 1v11M4 5l4-4 4 4"/><path d="M5 8H2v9h12V8h-3"/></svg>';
const mb = (n: number) => `${Math.max(1, Math.round(n / 1e6))} MB`;

function renderSlot(): void {
  if (!slot || !slot.isConnected) return;
  slot.textContent = '';
  const item = (label: string, sub = '', onClick?: () => void, disabled = false) => {
    const b = document.createElement('button');
    b.className = `item${disabled ? ' disabled' : ''}`;
    b.textContent = label;
    if (sub) {
      const s = document.createElement('span');
      s.className = 'pwa-sub';
      s.textContent = sub;
      b.appendChild(s);
    }
    if (onClick && !disabled) b.onclick = onClick;
    slot!.appendChild(b);
    return b;
  };
  if (!isStandalone()) {
    if (deferred) {
      item('Install', 'play from your desktop or home screen', async () => {
        const e = deferred;
        if (!e) return;
        deferred = null;
        await e.prompt().catch(() => {});
        renderSlot();
      });
    } else if (isIOS()) {
      item('Install', '', () => {
        iosHint = !iosHint;
        renderSlot();
      });
      if (iosHint) {
        const h = document.createElement('div');
        h.className = 'pwa-hint';
        h.innerHTML = `Tap ${SHARE_ICON} <b>Share</b>, then <b>Add to Home Screen</b>.`;
        slot.appendChild(h);
      }
    }
  }
  if (dl?.state === 'busy') {
    const pct = dl.total ? Math.floor((dl.done / dl.total) * 100) : 0;
    const b = item('Downloading', `${pct}% of ${mb(dl.total)}`, undefined, true);
    b.classList.remove('disabled');
    b.style.cursor = 'default';
    const bar = document.createElement('span');
    bar.className = 'pwa-bar';
    bar.innerHTML = `<i style="width:${pct}%"></i>`;
    b.appendChild(bar);
  } else if (offline && offline.cached < offline.total) {
    item('Download for Offline', dl?.state === 'error' ? 'interrupted, tap to resume' : mb(offline.bytes - offline.cachedBytes), () => downloadAll());
  } else if (dl?.state === 'done') {
    item('Ready for Offline', '', undefined, true);
  }
}

// ---------------------------------------------------------------- service worker

/** ask the active worker something over a MessageChannel */
function ask<T>(msg: object, timeout = 10000): Promise<T | null> {
  const sw = navigator.serviceWorker?.controller;
  if (!sw) return Promise.resolve(null);
  return new Promise((res) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => res(null), timeout);
    ch.port1.onmessage = (e) => {
      clearTimeout(t);
      res(e.data as T);
    };
    sw.postMessage(msg, [ch.port2]);
  });
}

async function refreshOffline(): Promise<void> {
  if (dl?.state === 'busy') return;
  const s = await ask<OfflineStatus>({ type: 'status' });
  if (s && !(s as any).error) {
    offline = s;
    renderSlot();
  }
}

/** fetch every game asset not yet cached; the worker keeps each one as it passes through */
async function downloadAll(): Promise<void> {
  if (dl?.state === 'busy' || !reg) return;
  const s = await ask<OfflineStatus>({ type: 'status' });
  if (!s || (s as any).error) return;
  (navigator.storage as any)?.persist?.().catch(() => {});
  dl = { done: s.cachedBytes, total: s.bytes, state: 'busy' };
  renderSlot();
  const queue = [...s.missing];
  let failed = 0;
  let last = 0;
  const tick = () => {
    const now = performance.now();
    if (now - last > 200) (last = now), renderSlot();
  };
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const [path, size] = job;
      try {
        const r = await fetch(new URL(path, reg!.scope).href);
        if (!r.ok) throw new Error(String(r.status));
        await r.arrayBuffer();
      } catch {
        failed++;
      }
      dl!.done += size;
      tick();
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  // the worker writes each file to the cache as it passes through; give the last ones a moment
  await new Promise((r) => setTimeout(r, 500));
  const after = await ask<OfflineStatus>({ type: 'status' });
  if (after) offline = after;
  dl!.state = failed || (after && after.cached < after.total) ? 'error' : 'done';
  renderSlot();
}

let reloadOnTakeover = false;

function registerServiceWorker(): void {
  // only for real builds: the dev server serves modules that must not be cached
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  const hadController = !!sw.controller;
  sw.addEventListener('controllerchange', () => {
    if (reloadOnTakeover) {
      reloadOnTakeover = false;
      // back to where the player was: the autosave was just written
      const url = new URL(location.href);
      if (app?.state === 'game') url.searchParams.set('continue', '1');
      location.replace(url.href);
    } else if (!hadController) {
      warm(); // the first install just took control of this page
      refreshOffline();
    }
  });
  const go = async () => {
    try {
      reg = await sw.register(`${import.meta.env.BASE_URL}sw.js`);
    } catch (e) {
      console.warn('service worker', e);
      return;
    }
    const watch = (w: ServiceWorker | null) =>
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && sw.controller) showUpdate();
      });
    if (reg.waiting && sw.controller) showUpdate();
    watch(reg.installing);
    reg.addEventListener('updatefound', () => watch(reg!.installing));
    // look for a new version now and then, and when the player comes back to the window
    let lastCheck = Date.now();
    const check = () => {
      if (Date.now() - lastCheck < 60_000) return;
      lastCheck = Date.now();
      reg?.update().catch(() => {});
    };
    setInterval(check, 30 * 60_000);
    document.addEventListener('visibilitychange', () => !document.hidden && check());
    if (sw.controller) {
      warm();
      refreshOffline();
    }
  };
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });
}

/** hand the worker everything already loaded, so the first visit is playable offline too */
function warm(): void {
  const urls = performance
    .getEntriesByType('resource')
    .map((e) => e.name)
    .filter((u) => u.startsWith(location.origin));
  // later loads (more buildings streaming in) go through the worker by themselves
  ask({ type: 'warm', urls: [...new Set(urls)] }, 120000).then(() => refreshOffline());
}

let toast: HTMLElement | null = null;
function showUpdate(): void {
  if (toast) return;
  toast = document.createElement('div');
  toast.className = 'pwa-toast';
  toast.innerHTML = '<div><b>Update ready</b>A new version of Buccaneer Cove has made port.</div><button class="btn small" data-r>Restart</button><button class="x" data-x title="Later">&times;</button>';
  document.body.appendChild(toast);
  toast.querySelector<HTMLElement>('[data-x]')!.onclick = () => {
    toast?.remove();
    toast = null;
  };
  toast.querySelector<HTMLElement>('[data-r]')!.onclick = async (e) => {
    (e.currentTarget as HTMLButtonElement).disabled = true;
    if (app?.state === 'game') await app.save('auto').catch(() => {});
    const w = reg?.waiting;
    if (!w) return location.reload();
    reloadOnTakeover = true;
    w.postMessage({ type: 'skip-waiting' });
  };
}

// ---------------------------------------------------------------- standalone polish

function standalonePolish(): void {
  // a draggable title strip where the window controls overlay the page (styled in install.css)
  if ('windowControlsOverlay' in navigator) {
    const bar = document.createElement('div');
    bar.className = 'pwa-titlebar';
    bar.textContent = 'Buccaneer Cove';
    document.body.appendChild(bar);
  }
  // iOS Safari ignores user-scalable=no; stop page pinch zoom (the canvas handles its own touches)
  const stop = (e: Event) => e.preventDefault();
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, stop, { passive: false });
  // a quick double tap would zoom the page on iOS
  let lastTap = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = e.timeStamp;
      if (now - lastTap < 300 && e.target === document.getElementById('view')) e.preventDefault();
      lastTap = now;
    },
    { passive: false },
  );
  // keep the screen on while a game is running (installed app only; a no-op without the API)
  let lock: { release(): Promise<void>; addEventListener(t: string, f: () => void): void } | null = null;
  let asking = false;
  const sync = async () => {
    if (!isStandalone() || !('wakeLock' in navigator)) return;
    const want = app?.state === 'game' && !document.hidden;
    if (want && !lock && !asking) {
      asking = true;
      try {
        lock = await (navigator as any).wakeLock.request('screen');
        lock!.addEventListener('release', () => (lock = null));
      } catch {}
      asking = false;
    } else if (!want && lock) {
      const l = lock;
      lock = null;
      l.release().catch(() => {});
    }
  };
  document.addEventListener('visibilitychange', sync);
  setInterval(sync, 4000);
}
