// files.js — uploaded agreement files live in IndexedDB (never in localStorage, which is too small for files).
// Only the file's name, type and size are kept in the workspace record; the file itself stays in this browser.

const DB_NAME = 'scopelens_files_v1';
const STORE = 'files';
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const TEXT_TYPES = ['.txt', '.md', '.csv', '.rtf'];
export const ACCEPTED = '.txt,.md,.csv,.pdf,.doc,.docx,.png,.jpg,.jpeg';

function open() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('This browser cannot store files.')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open file storage.'));
  });
}

function run(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const out = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(out && 'result' in out ? out.result : undefined); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('File storage failed.')); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('File storage was blocked. The storage may be full.')); };
  }));
}

export const extOf = (name) => (String(name).toLowerCase().match(/\.[a-z0-9]+$/) || [''])[0];
export const isTextFile = (file) => TEXT_TYPES.includes(extOf(file.name)) || (file.type || '').startsWith('text/');

export function checkFile(file) {
  if (!file) return 'Choose a file first.';
  if (file.size > MAX_FILE_BYTES) return `This file is too big. The limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.`;
  if (file.size === 0) return 'This file is empty.';
  const ext = extOf(file.name);
  if (!ACCEPTED.split(',').includes(ext)) return 'This file type is not supported. Use .txt, .md, .pdf, .docx, .doc or an image, or paste the text instead.';
  return '';
}

export const readText = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ''));
  r.onerror = () => reject(r.error || new Error('Could not read the file.'));
  r.readAsText(file);
});

export const saveFile = (id, file) => run('readwrite', (s) => s.put({ id, name: file.name, type: file.type, size: file.size, blob: file, addedAt: new Date().toISOString() }));
export const deleteFile = (id) => run('readwrite', (s) => s.delete(id));
export const clearFiles = () => run('readwrite', (s) => s.clear());
export const getFile = (id) => open().then((db) => new Promise((resolve, reject) => {
  const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
  req.onsuccess = () => { db.close(); resolve(req.result || null); };
  req.onerror = () => { db.close(); reject(req.error); };
}));
