/** Save games in IndexedDB (gzip-compressed when the browser supports CompressionStream). */

import { cleanName, legacyGameName, GAME_NAME_MAX } from '../sim/names';
import { shortDate } from '../sim/time';

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
  /** the game's name (saves from before games had names have none: see slotTitle) */
  name?: string;
  /** island size */
  size?: string;
}

export interface SaveInfo {
  time: number;
  king: string;
  name?: string;
  size?: string;
}

/** the label a save goes by: its game's name, or for an old save the ruler and date its slot used to show */
export function slotTitle(m: Pick<SaveMeta, 'name' | 'king' | 'date'>): string {
  return cleanName(m.name, GAME_NAME_MAX) || legacyGameName(m.king, m.date);
}

/** the line under a save's name: ruler, date and island */
export function slotDetails(m: Pick<SaveMeta, 'king' | 'date' | 'size'>): string {
  const size = m.size ? `${m.size[0].toUpperCase()}${m.size.slice(1)} island` : '';
  return [m.king, m.date, size].filter(Boolean).join(' · ');
}

/** what the slot list needs from a serialized game */
export function infoOf(json: string): SaveInfo {
  const d = JSON.parse(json);
  return { time: d.time, king: d.king?.name ?? '?', name: d.name, size: d.settings?.size };
}

export function metaOf(slot: string, info: SaveInfo, savedAt = Date.now()): SaveMeta {
  const date = dateOf(info.time);
  return { slot, date, king: info.king, savedAt, name: cleanName(info.name, GAME_NAME_MAX) || legacyGameName(info.king, date), size: info.size };
}

function put(db: IDBDatabase, slot: string, rec: { data: Blob | string; meta: SaveMeta }): Promise<void> {
  return new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(rec, slot);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
function get(db: IDBDatabase, slot: string): Promise<{ data: Blob | string; meta: SaveMeta } | undefined> {
  return new Promise((res, rej) => {
    const r = db.transaction(STORE).objectStore(STORE).get(slot);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

/** `info` (game time, ruler, name) saves re-parsing the whole save just to label it */
export async function saveGame(slot: string, json: string, info?: SaveInfo): Promise<void> {
  try {
    const db = await open();
    const data = await gzip(json);
    await put(db, slot, { data, meta: metaOf(slot, info ?? infoOf(json)) });
  } catch (e) {
    console.warn('save failed', e);
  }
}

/** give a saved game a new name, in its slot label and in the save itself (so it keeps it when loaded) */
export async function renameSave(slot: string, raw: string): Promise<boolean> {
  const name = cleanName(raw, GAME_NAME_MAX);
  if (!name) return false;
  try {
    const db = await open();
    const v = await get(db, slot);
    if (!v) return false;
    const d = JSON.parse(await gunzip(v.data));
    d.name = name;
    await put(db, slot, { data: await gzip(JSON.stringify(d)), meta: { ...v.meta, name } });
    return true;
  } catch (e) {
    console.warn('rename failed', e);
    return false;
  }
}

const dateOf = shortDate;

export async function loadGame(slot: string): Promise<string | null> {
  try {
    const db = await open();
    const v = await get(db, slot);
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
