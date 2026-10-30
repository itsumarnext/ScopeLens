// store.js — the one place that reads and writes the workspace in the browser.
//
//   localStorage   key "scopelens_data_v1"     all clients, projects, invoices, tasks… as one JSON document
//   sessionStorage key "scopelens_session_v1"  temporary screen state only (search boxes, filters, sort order)
//   IndexedDB      "scopelens_files_v1"        uploaded agreement files (see files.js)
//
// Every change goes through mutate(): the change is applied to the in-memory copy, written to
// localStorage, and rolled back if the write fails (for example when the browser quota is full).
// Screens never call localStorage directly.

import { uid, nowISO } from './utils.js';
import { configure } from './fmt.js';
import { COLLECTIONS, SCHEMA, MAX_ACTIVITY, emptyDb, sanitizeDb, exportEnvelope, validateBackup } from './backup.js';

export const DATA_KEY = 'scopelens_data_v1';
export const SESSION_KEY = 'scopelens_session_v1';

let db = emptyDb();
let inTx = false;
const health = { mode: 'local', corrupted: false, message: '', savedBackupKey: '' };

export class StoreError extends Error {}

const quotaLike = (e) => e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);

function readRaw() {
  try { return { ok: true, raw: localStorage.getItem(DATA_KEY) }; } catch (e) { return { ok: false, error: e }; }
}

/** Loads the saved workspace. Never throws: damaged or missing data becomes an empty workspace plus a message. */
export function init() {
  const r = readRaw();
  if (!r.ok) {
    health.mode = 'memory';
    health.message = 'Your browser is not letting WorkSphare save data (this can happen in private browsing). Everything you add will be lost when you close or refresh this page. Download a backup often from Settings.';
    db = emptyDb();
  } else if (r.raw === null) {
    db = emptyDb();
  } else {
    let parsed = null;
    try { parsed = JSON.parse(r.raw); } catch { parsed = null; }
    const tooNew = parsed && typeof parsed.schema === 'number' && parsed.schema > SCHEMA;
    const clean = parsed && !tooNew ? sanitizeDb(parsed) : { db: null };
    if (!clean.db) {
      health.corrupted = true;
      const key = `${DATA_KEY}_unreadable_${Date.now()}`;
      try { localStorage.setItem(key, r.raw); health.savedBackupKey = key; } catch { /* nothing more we can do */ }
      health.message = tooNew
        ? 'The saved data was made by a newer version of WorkSphare, so it was left untouched and a copy was kept. Update the app to open it.'
        : 'The saved data could not be read, so WorkSphare started with an empty workspace. A copy of the unreadable data was kept in this browser in case it can be recovered.';
      db = emptyDb();
    } else {
      db = clean.db;
      if (clean.warnings.length) health.message = `Some saved entries were damaged and were skipped: ${clean.warnings.slice(0, 3).join(' ')}`;
    }
  }
  configure(db.settings);
  return health;
}

export const data = () => db;
export const storageHealth = () => health;

function persist() {
  if (health.mode === 'memory') return;
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(db));
  } catch (e) {
    if (quotaLike(e)) throw new StoreError('This browser has no room left for WorkSphare data. Download a backup, then delete things you no longer need (old saved comparisons use the most space).');
    throw new StoreError('Could not save to this browser. Your change was not kept.');
  }
}

/**
 * Applies fn(db) and saves. If fn throws or saving fails, the previous data is restored.
 * Returns whatever fn returns.
 */
export function mutate(fn) {
  if (inTx) return fn(db);
  const snapshot = JSON.stringify(db);
  inTx = true;
  try {
    const out = fn(db);
    db.updatedAt = nowISO();
    persist();
    configure(db.settings);
    return out;
  } catch (e) {
    db = JSON.parse(snapshot);
    throw e;
  } finally {
    inTx = false;
  }
}

/* ---- helpers to use inside mutate() ---- */

export function add(coll, fields) {
  const now = nowISO();
  const rec = { id: uid(), ...fields, createdAt: now, updatedAt: now };
  db[coll].push(rec);
  return rec;
}

export function patch(coll, id, changes) {
  const rec = db[coll].find((r) => r.id === id);
  if (!rec) throw new StoreError('That record is no longer here. It may have been deleted.');
  Object.assign(rec, changes, { updatedAt: nowISO() });
  return rec;
}

export function drop(coll, id) {
  const i = db[coll].findIndex((r) => r.id === id);
  if (i >= 0) db[coll].splice(i, 1);
}

/** Records an event in the activity log. Call it inside the same mutate() as the change it describes. */
export function log(type, text, refs = {}) {
  db.activity.push({ id: uid(), at: nowISO(), type, text: String(text).slice(0, 600), refs });
  if (db.activity.length > MAX_ACTIVITY) db.activity.splice(0, db.activity.length - MAX_ACTIVITY);
}

/* ---- whole-workspace operations ---- */

export function exportAll() { return exportEnvelope(db); }

export function replaceAll(newDb) {
  const keepDemo = newDb;
  mutate(() => { db = keepDemo; });
}

export function importBackup(parsed) {
  const res = validateBackup(parsed);
  if (!res.ok) return res;
  mutate(() => { db = res.db; log('data_import', 'A backup was restored. The earlier data in this browser was replaced.'); });
  return res;
}

export function clearAll() {
  try { localStorage.removeItem(DATA_KEY); } catch { /* ignore */ }
  db = emptyDb();
  configure(db.settings);
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

export const isEmpty = () => COLLECTIONS.every((c) => c === 'activity' || db[c].length === 0);

/** Approximate size of the saved workspace in bytes. */
export function usage() {
  let bytes = 0;
  try { bytes = (localStorage.getItem(DATA_KEY) || '').length * 2; } catch { /* ignore */ }
  return bytes;
}

/* ---- temporary screen state (sessionStorage) ---- */

let sessionMemory = {};
function readSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return sessionMemory; }
}
export const session = {
  get(key, fallback = null) {
    const v = readSession()[key];
    return v === undefined ? fallback : v;
  },
  set(key, value) {
    const all = readSession();
    all[key] = value;
    sessionMemory = all;
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(all)); } catch { /* memory copy still works */ }
  },
};
