// backup.js — the shape of the saved workspace, plus strict cleaning of anything loaded from
// browser storage or from an imported backup file. Nothing is trusted: every field is checked
// and anything broken is repaired or skipped with a plain-English warning.

import { uid, nowISO, isValidDateString } from './utils.js';
import {
  CLIENT_STATUSES, CLIENT_TYPES, LEAD_STATUSES, PROJECT_STATUSES, INVOICE_MANUAL_STATUSES,
  AGREEMENT_MANUAL_STATUSES, TASK_STATUSES, PRIORITIES, CHANGE_STATUSES, WARN_PERIODS,
} from './domain.js';
import { CURRENCIES, DATE_FORMATS, NUMBER_LOCALES } from './fmt.js';

export const SCHEMA = 1;
export const APP_NAME = 'WorkSphare';
export const LEGACY_APP_NAMES = ['ScopeLens']; // backups made before the rename are still accepted
export const COLLECTIONS = ['clients', 'leads', 'projects', 'agreements', 'invoices', 'transactions', 'tasks', 'comparisons', 'scopeChanges', 'activity'];
export const LABELS = {
  clients: 'clients', leads: 'leads', projects: 'projects', agreements: 'agreements', invoices: 'invoices',
  transactions: 'payments received', tasks: 'tasks', comparisons: 'saved comparisons', scopeChanges: 'scope changes', activity: 'activity entries',
};
const MAX_PER_COLLECTION = 5000;
export const MAX_ACTIVITY = 2000;

export const defaultSettings = () => ({
  businessName: '', email: '', phone: '', currency: 'INR', dateFormat: 'medium', numberLocale: 'en-IN',
  currencyDisplay: 'symbol', expiryWarnDays: 30,
});

export const emptyDb = () => {
  const db = { schema: SCHEMA, createdAt: nowISO(), updatedAt: nowISO(), settings: defaultSettings() };
  for (const c of COLLECTIONS) db[c] = [];
  return db;
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : '');
const isoOr = (v) => (typeof v === 'string' && !Number.isNaN(new Date(v).getTime()) ? v.slice(0, 40) : nowISO());
const money = (v) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 && n <= 1e12 ? Math.round(n * 100) / 100 : '';
};

/* Field kinds: str(max, required) · enum(list, default) · money(required) · int(min,max,default) · date · bool · ref(collection, required) */
const F = {
  str: (max, required = false) => ({ k: 'str', max, required }),
  enum: (list, def) => ({ k: 'enum', list, def }),
  money: (required = false) => ({ k: 'money', required }),
  int: (min, max, def) => ({ k: 'int', min, max, def }),
  date: () => ({ k: 'date' }),
  bool: () => ({ k: 'bool' }),
  ref: (to, required = false) => ({ k: 'ref', to, required }),
};

const SCHEMAS = {
  clients: {
    name: F.str(140, true), company: F.str(140), email: F.str(200), phone: F.str(40), address: F.str(500),
    type: F.enum(CLIENT_TYPES, 'Individual'), status: F.enum(CLIENT_STATUSES, 'Active'), prevStatus: F.str(20), notes: F.str(5000),
  },
  leads: {
    name: F.str(140, true), company: F.str(140), email: F.str(200), phone: F.str(40), source: F.str(60),
    estimatedValue: F.money(), nextFollowUp: F.date(), status: F.enum(LEAD_STATUSES, 'New'), notes: F.str(5000), clientId: F.ref('clients'),
  },
  projects: {
    name: F.str(140, true), clientId: F.ref('clients', true), description: F.str(5000), startDate: F.date(), dueDate: F.date(),
    value: F.money(), status: F.enum(PROJECT_STATUSES, 'Not Started'), progress: F.int(0, 100, 0), agreementId: F.ref('agreements'),
    notes: F.str(5000), archived: F.bool(),
  },
  agreements: {
    title: F.str(160, true), clientId: F.ref('clients', true), projectId: F.ref('projects'), scope: F.str(60000), deliverables: F.str(10000),
    exclusions: F.str(10000), revisions: F.str(400), conditions: F.str(10000), startDate: F.date(), endDate: F.date(), value: F.money(),
    status: F.enum(AGREEMENT_MANUAL_STATUSES, 'Draft'), prevStatus: F.str(20), notes: F.str(5000), renewedAt: F.str(40), renewedToId: F.ref('agreements'), renewalOfId: F.ref('agreements'),
  },
  invoices: {
    number: F.str(40, true), clientId: F.ref('clients', true), projectId: F.ref('projects'), description: F.str(1000),
    amount: F.money(true), issueDate: F.date(), dueDate: F.date(), status: F.enum(INVOICE_MANUAL_STATUSES, 'Unpaid'), notes: F.str(5000),
  },
  transactions: {
    clientId: F.ref('clients', true), invoiceId: F.ref('invoices'), projectId: F.ref('projects'), amount: F.money(true), date: F.date(),
    method: F.str(40), reference: F.str(120), notes: F.str(2000),
  },
  tasks: {
    title: F.str(160, true), description: F.str(3000), dueDate: F.date(), priority: F.enum(PRIORITIES, 'Medium'),
    status: F.enum(TASK_STATUSES, 'To Do'), clientId: F.ref('clients'), projectId: F.ref('projects'), completedAt: F.str(40),
  },
  scopeChanges: {
    title: F.str(160, true), description: F.str(5000), clientId: F.ref('clients'), projectId: F.ref('projects'), agreementId: F.ref('agreements'),
    dateRequested: F.date(), additionalPrice: F.money(), status: F.enum(CHANGE_STATUSES, 'Needs Review'), notes: F.str(5000),
  },
};

function sanitizeFields(coll, raw, warnings) {
  const spec = SCHEMAS[coll];
  const out = {};
  for (const [key, f] of Object.entries(spec)) {
    const v = raw[key];
    switch (f.k) {
      case 'str': out[key] = str(v, f.max); if (f.required && !out[key]) return null; break;
      case 'enum': out[key] = f.list.includes(v) ? v : f.def; break;
      case 'money': { const m = money(v); if (f.required && m === '') return null; out[key] = m; break; }
      case 'int': { const n = Math.round(Number(v)); out[key] = Number.isFinite(n) ? Math.min(f.max, Math.max(f.min, n)) : f.def; break; }
      case 'date': out[key] = typeof v === 'string' && isValidDateString(v) ? v : ''; break;
      case 'bool': out[key] = v === true; break;
      case 'ref': out[key] = str(v, 80); if (f.required && !out[key]) return null; break;
      default: break;
    }
  }
  if (coll === 'invoices' && (!out.issueDate || !out.dueDate)) { warnings.push(`An invoice (${out.number}) had no valid dates and was skipped.`); return null; }
  if (coll === 'transactions' && !out.date) { warnings.push('A payment had no valid date and was skipped.'); return null; }
  return out;
}

function sanitizeFile(v) {
  if (!isObj(v) || typeof v.id !== 'string') return null;
  return { id: str(v.id, 80), name: str(v.name, 200) || 'file', type: str(v.type, 100), size: Math.max(0, Math.round(Number(v.size) || 0)) };
}

function sanitizeItems(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 200).filter(isObj).map((i) => ({
    request: str(i.request, 2000), agreement: str(i.agreement, 2000), exclusion: str(i.exclusion, 2000), reason: str(i.reason, 2000),
    flags: Array.isArray(i.flags) ? i.flags.slice(0, 10).map((x) => str(x, 400)).filter(Boolean) : [],
    confidence: ['high', 'medium', 'low'].includes(i.confidence) ? i.confidence : 'low',
  }));
}

function sanitizeComparison(raw) {
  const r = isObj(raw.result) ? raw.result : {};
  const lines = (a, n) => (Array.isArray(a) ? a.slice(0, n).map((x) => str(x, 1000)).filter(Boolean) : []);
  return {
    clientId: str(raw.clientId, 80), clientName: str(raw.clientName, 140), agreementId: str(raw.agreementId, 80),
    agreementTitle: str(raw.agreementTitle, 160), projectId: str(raw.projectId, 80), projectName: str(raw.projectName, 140),
    requestText: str(raw.requestText, 60000), context: str(raw.context, 5000), constraints: str(raw.constraints, 5000),
    agreementText: str(raw.agreementText, 60000), manualAgreement: raw.manualAgreement === true, engine: str(raw.engine, 40) || 'local-rules-v1',
    result: {
      summary: str(r.summary, 1000), covered: sanitizeItems(r.covered), possible: sanitizeItems(r.possible),
      outside: sanitizeItems(r.outside), unclear: sanitizeItems(r.unclear), notes: lines(r.notes, 20), nextSteps: lines(r.nextSteps, 20),
    },
    response: str(raw.response, 20000), responseEdited: raw.responseEdited === true,
  };
}

function sanitizeSettings(raw) {
  const d = defaultSettings();
  if (!isObj(raw)) return d;
  return {
    businessName: str(raw.businessName, 140), email: str(raw.email, 200), phone: str(raw.phone, 40),
    currency: CURRENCIES.includes(raw.currency) ? raw.currency : d.currency,
    dateFormat: DATE_FORMATS[raw.dateFormat] ? raw.dateFormat : d.dateFormat,
    numberLocale: NUMBER_LOCALES[raw.numberLocale] ? raw.numberLocale : d.numberLocale,
    currencyDisplay: raw.currencyDisplay === 'code' ? 'code' : 'symbol',
    expiryWarnDays: WARN_PERIODS.includes(Number(raw.expiryWarnDays)) ? Number(raw.expiryWarnDays) : d.expiryWarnDays,
  };
}

function sanitizeActivity(raw) {
  const refs = {};
  if (isObj(raw.refs)) for (const k of ['clientId', 'projectId', 'agreementId', 'invoiceId', 'taskId', 'comparisonId', 'leadId', 'changeId', 'transactionId']) if (typeof raw.refs[k] === 'string') refs[k] = raw.refs[k].slice(0, 80);
  return { at: isoOr(raw.at), type: str(raw.type, 40) || 'note', text: str(raw.text, 600), refs, ...(raw.demo === true ? { demo: true } : {}) };
}

/**
 * Cleans a whole workspace object. Returns { db, warnings, errors }.
 * Records that cannot be repaired are skipped and counted in warnings.
 */
export function sanitizeDb(raw) {
  const warnings = [];
  const errors = [];
  if (!isObj(raw)) return { db: null, warnings, errors: ['This is not a WorkSphare workspace.'] };
  const out = emptyDb();
  out.createdAt = isoOr(raw.createdAt);
  out.updatedAt = isoOr(raw.updatedAt);
  out.settings = sanitizeSettings(raw.settings);

  for (const coll of COLLECTIONS) {
    const arr = raw[coll];
    if (arr === undefined) continue;
    if (!Array.isArray(arr)) { warnings.push(`The list of ${LABELS[coll]} was damaged and was skipped.`); continue; }
    const seen = new Set();
    let skipped = 0;
    for (const rec of arr.slice(0, coll === 'activity' ? MAX_ACTIVITY : MAX_PER_COLLECTION)) {
      if (!isObj(rec) || typeof rec.id !== 'string' || !rec.id || rec.id.length > 80 || seen.has(rec.id)) { skipped += 1; continue; }
      let fields;
      if (coll === 'comparisons') fields = sanitizeComparison(rec);
      else if (coll === 'activity') fields = sanitizeActivity(rec);
      else fields = sanitizeFields(coll, rec, warnings);
      if (!fields) { skipped += 1; continue; }
      const full = { id: rec.id, ...fields };
      if (coll !== 'activity') {
        full.createdAt = isoOr(rec.createdAt);
        full.updatedAt = isoOr(rec.updatedAt);
        full.demo = rec.demo === true;
      }
      if (coll === 'agreements') { const f = sanitizeFile(rec.file); if (f) full.file = f; }
      if (coll === 'scopeChanges') {
        full.history = Array.isArray(rec.history) ? rec.history.slice(0, 200).filter(isObj).map((h) => ({ at: isoOr(h.at), status: CHANGE_STATUSES.includes(h.status) ? h.status : 'Needs Review', note: str(h.note, 600) })) : [];
      }
      seen.add(rec.id);
      out[coll].push(full);
    }
    if (skipped) warnings.push(`${skipped} ${LABELS[coll]} ${skipped === 1 ? 'entry was' : 'entries were'} damaged or repeated and ${skipped === 1 ? 'was' : 'were'} skipped.`);
  }

  // References: clear links to records that are not there; drop records that cannot live without their link.
  const spec = (coll) => SCHEMAS[coll] || {};
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 10) {
    changed = false;
    const ids = Object.fromEntries(COLLECTIONS.map((c) => [c, new Set(out[c].map((r) => r.id))]));
    for (const coll of Object.keys(SCHEMAS)) {
      const keep = [];
      for (const rec of out[coll]) {
        let drop = false;
        for (const [key, f] of Object.entries(spec(coll))) {
          if (f.k !== 'ref' || !rec[key] || ids[f.to].has(rec[key])) continue;
          if (f.required) { drop = true; warnings.push(`A record in ${LABELS[coll]} pointed to something that is not in this backup and was skipped.`); break; }
          rec[key] = '';
        }
        if (drop) changed = true; else keep.push(rec);
      }
      out[coll] = keep;
    }
  }
  // comparisons and activity: soft references only
  const ids = Object.fromEntries(['clients', 'projects', 'agreements'].map((c) => [c, new Set(out[c].map((r) => r.id))]));
  for (const c of out.comparisons) {
    if (c.clientId && !ids.clients.has(c.clientId)) c.clientId = '';
    if (c.projectId && !ids.projects.has(c.projectId)) c.projectId = '';
    if (c.agreementId && !ids.agreements.has(c.agreementId)) c.agreementId = '';
  }
  out.activity.sort((a, b) => a.at.localeCompare(b.at));
  out.activity = out.activity.slice(-MAX_ACTIVITY).map((a, i) => ({ id: a.id || uid() + i, ...a }));
  return { db: out, warnings: [...new Set(warnings)], errors };
}

export function exportEnvelope(db) {
  return { app: APP_NAME, kind: 'workspace-backup', schema: SCHEMA, exportedAt: nowISO(), note: 'Uploaded agreement files are not included. They stay in the browser they were added in.', data: db };
}

/** Checks a parsed backup file. Returns { ok, errors, warnings, db, counts }. */
export function validateBackup(parsed) {
  if (!isObj(parsed)) return { ok: false, errors: ['This file is not a WorkSphare backup.'], warnings: [] };
  if (parsed.app !== APP_NAME && !LEGACY_APP_NAMES.includes(parsed.app)) return { ok: false, errors: ['This does not look like a WorkSphare backup file.'], warnings: [] };
  if (parsed.kind !== 'workspace-backup') {
    return { ok: false, errors: [parsed.kind || parsed.projects ? 'This is a backup from the Classic projects page. Restore it from Classic projects → Backups.' : 'This is not a workspace backup.'], warnings: [] };
  }
  if (typeof parsed.schema !== 'number' || parsed.schema < 1) return { ok: false, errors: ['This backup is missing its version number.'], warnings: [] };
  if (parsed.schema > SCHEMA) return { ok: false, errors: ['This backup was made by a newer version of WorkSphare. Update the app and try again.'], warnings: [] };
  const { db, warnings, errors } = sanitizeDb(parsed.data);
  if (!db) return { ok: false, errors, warnings };
  const counts = Object.fromEntries(COLLECTIONS.map((c) => [c, db[c].length]));
  return { ok: true, errors: [], warnings, db, counts };
}
