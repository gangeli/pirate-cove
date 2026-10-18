/** Save games in IndexedDB (gzip-compressed when the browser supports CompressionStream). */

const DB = 'buccaneer-cove';
const STORE = 'saves';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function gzip(s: string): Promise<Blob | string> {
  if (typeof CompressionStream === 'undefined') return s;
  const cs = new Blob([s]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(cs).blob();
}
async function gunzip(v: Blob | string): Promise<string> {
  if (typeof v === 'string') return v;
  const ds = v.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(ds).text();
}

export interface SaveMeta {
  slot: string;
  date: string;
  king: string;
  savedAt: number;
}

export async function saveGame(slot: string, json: string): Promise<void> {
  try {
    const db = await open();
    const data = await gzip(json);
    const meta = JSON.parse(json.slice(0, 0) || '{}');
    void meta;
    const parsed = JSON.parse(json);
    const m: SaveMeta = { slot, date: dateOf(parsed.time), king: parsed.king?.name ?? '?', savedAt: Date.now() };
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ data, meta: m }, slot);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) {
    console.warn('save failed', e);
  }
}

function dateOf(t: number): string {
  const m = Math.floor(t / 150);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m % 12]} ${1680 + Math.floor(m / 12)}`;
}

export async function loadGame(slot: string): Promise<string | null> {
  try {
    const db = await open();
    const v = await new Promise<any>((res, rej) => {
      const r = db.transaction(STORE).objectStore(STORE).get(slot);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    if (!v) return null;
    return gunzip(v.data);
  } catch {
    return null;
  }
}

export async function listSaves(): Promise<SaveMeta[]> {
  try {
    const db = await open();
    return await new Promise<SaveMeta[]>((res) => {
      const out: SaveMeta[] = [];
      const r = db.transaction(STORE).objectStore(STORE).openCursor();
      r.onsuccess = () => {
        const c = r.result;
        if (!c) return res(out.sort((a, b) => b.savedAt - a.savedAt));
        out.push(c.value.meta);
        c.continue();
      };
      r.onerror = () => res(out);
    });
  } catch {
    return [];
  }
}

export async function hasSave(slot: string): Promise<boolean> {
  return (await listSaves()).some((s) => s.slot === slot);
}
