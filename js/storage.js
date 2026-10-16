// storage.js — IndexedDB persistence with an in-memory fallback.
// Everything stays in the browser. Nothing is sent anywhere.

const DB_NAME = 'scopelens';
const DB_VERSION = 1;
const STORE = 'projects';
const PROBE_ID = '__probe__';

let dbPromise = null;
let mode = 'unknown'; // 'indexeddb' | 'memory'
let initError = null;
const memory = new Map();

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open browser storage.'));
    req.onblocked = () => reject(new Error('Browser storage is blocked by another open tab.'));
  });
}

function run(db, type, fn) {
  return new Promise((resolve, reject) => {
    let result;
    let t;
    try {
      t = db.transaction(STORE, type);
    } catch (e) {
      reject(e);
      return;
    }
    const store = t.objectStore(STORE);
    const r = fn(store);
    if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error || new Error('Storage error.'));
    t.onabort = () => reject(t.error || new Error('Storage transaction was aborted.'));
  });
}

export function describeError(e) {
  if (e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''))) {
    return 'Browser storage is full. Export a backup, then delete old projects to free space.';
  }
  return (e && e.message) || 'Unknown storage error.';
}

/** Opens storage once. Falls back to memory-only mode if IndexedDB is unusable. */
export async function initStorage() {
  if (mode !== 'unknown') return mode;
  try {
    const db = await openDB();
    await run(db, 'readwrite', (s) => s.put({ id: PROBE_ID }));
    await run(db, 'readwrite', (s) => s.delete(PROBE_ID));
    dbPromise = Promise.resolve(db);
    mode = 'indexeddb';
  } catch (e) {
    initError = e;
    mode = 'memory';
  }
  return mode;
}

export const storageMode = () => mode;
export const storageInitError = () => (initError ? describeError(initError) : '');

async function db() {
  if (mode === 'unknown') await initStorage();
  return dbPromise;
}

export async function getAllProjects() {
  if (mode === 'unknown') await initStorage();
  if (mode === 'memory') return [...memory.values()].map((p) => structuredClone(p));
  const rows = await run(await db(), 'readonly', (s) => s.getAll());
  return (rows || []).filter((p) => p && p.id !== PROBE_ID);
}

export async function getProject(id) {
  if (mode === 'unknown') await initStorage();
  if (mode === 'memory') return memory.has(id) ? structuredClone(memory.get(id)) : null;
  const row = await run(await db(), 'readonly', (s) => s.get(id));
  return row || null;
}

export async function saveProject(project) {
  if (mode === 'unknown') await initStorage();
  if (mode === 'memory') {
    memory.set(project.id, structuredClone(project));
    return;
  }
  await run(await db(), 'readwrite', (s) => s.put(project));
}

export async function deleteProject(id) {
  if (mode === 'unknown') await initStorage();
  if (mode === 'memory') {
    memory.delete(id);
    return;
  }
  await run(await db(), 'readwrite', (s) => s.delete(id));
}

/** Asks the browser not to evict our data under storage pressure. May be refused. */
export async function requestPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch { /* ignore */ }
  return false;
}

export async function persistenceInfo() {
  const info = { supported: false, persisted: false, usage: null, quota: null };
  try {
    if (navigator.storage && navigator.storage.persisted) {
      info.supported = true;
      info.persisted = await navigator.storage.persisted();
    }
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      info.usage = est.usage ?? null;
      info.quota = est.quota ?? null;
    }
  } catch { /* ignore */ }
  return info;
}

/** Tiny preference helpers (localStorage may throw in private mode, so always guarded). */
export const prefs = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem('scopelens:' + key);
      return v === null ? fallback : v;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('scopelens:' + key, String(value));
      return true;
    } catch {
      return false;
    }
  },
};
