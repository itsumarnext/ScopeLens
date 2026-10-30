// projects.js — data model and all project operations (pure functions on plain objects).
// The UI calls these, then persists the returned project with storage.saveProject().

import {
  uid, nowISO, todayDate, offsetDate, isValidDateString, cleanString, fmtDate, truncate, plural,
} from './utils.js';
import {
  compareScope, summarizeFindings, FINDING_TYPES, TYPE_LABELS, STATUS_LABELS, LIMITS,
} from './comparison.js';

export const SCHEMA_VERSION = 1;
export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD', 'AED', 'JPY'];
export const SOURCE_SUGGESTIONS = ['Email', 'Chat message', 'Meeting', 'Phone call', 'Document comment', 'Other'];
export const STATUSES = ['pending', 'relevant', 'irrelevant', 'clarify'];
const CONFIDENCES = ['high', 'medium', 'low'];

const HISTORY_LABELS = {
  project_created: 'Project created',
  project_updated: 'Project details changed',
  project_archived: 'Project archived',
  project_restored: 'Project restored',
  baseline_created: 'Original agreement saved',
  baseline_revised: 'Original agreement changed',
  request_added: 'Client request added',
  request_edited: 'Client request edited',
  request_deleted: 'Client request deleted',
  comparison_run: 'Comparison done',
  comparison_deleted: 'Comparison deleted',
  finding_reviewed: 'Result reviewed',
  note_saved: 'Note saved',
  message_edited: 'Message to client edited',
  report_exported: 'Report shared or saved',
  data_exported: 'Project backup downloaded',
  demo_loaded: 'Sample project loaded',
};
export const historyLabel = (type) => HISTORY_LABELS[type] || 'Activity';

/* ---------------------------- project fields ---------------------------- */

export function validateProjectFields(raw = {}) {
  const errors = {};
  const values = {
    name: cleanString(raw.name, 200),
    client: cleanString(raw.client, 200),
    description: cleanString(raw.description, 2000),
    startDate: cleanString(raw.startDate, 20),
    budget: cleanString(String(raw.budget ?? ''), 30),
    currency: cleanString(raw.currency, 10) || 'INR',
  };
  if (!values.name) errors.name = 'Enter a project name.';
  else if (values.name.length > 120) errors.name = 'Use 120 letters or fewer for the project name.';
  if (values.client.length > 120) errors.client = 'Use 120 letters or fewer for the client name.';
  if (values.description.length > 1000) errors.description = 'Use 1,000 letters or fewer for the description.';
  if (values.startDate && !isValidDateString(values.startDate)) errors.startDate = 'Enter a real date.';
  if (values.budget !== '') {
    const n = Number(values.budget);
    if (!Number.isFinite(n) || n < 0) errors.budget = 'Enter a number, like 45000.';
    else if (n > 1e12) errors.budget = 'That number is too big.';
  }
  if (!CURRENCIES.includes(values.currency)) errors.currency = 'Pick a currency from the list.';
  return { errors, values, ok: Object.keys(errors).length === 0 };
}

export function addHistory(project, type, text, meta = {}) {
  project.history.push({ id: uid(), at: nowISO(), type, text, meta });
}

const touch = (p) => { p.updatedAt = nowISO(); return p; };

export function newProject(values) {
  const now = nowISO();
  const p = {
    id: uid(),
    schema: SCHEMA_VERSION,
    name: values.name,
    client: values.client || '',
    description: values.description || '',
    startDate: values.startDate || '',
    budget: values.budget === '' ? '' : Number(values.budget),
    currency: values.currency || 'INR',
    archived: false,
    isDemo: false,
    createdAt: now,
    updatedAt: now,
    baseline: null,
    baselineRevisions: [],
    requests: [],
    comparisons: [],
    history: [],
  };
  addHistory(p, 'project_created', `Project “${p.name}” created.`);
  return p;
}

export function applyProjectFields(project, values) {
  const before = `${project.name}|${project.client}|${project.description}|${project.startDate}|${project.budget}|${project.currency}`;
  const renamed = project.name !== values.name;
  project.name = values.name;
  project.client = values.client || '';
  project.description = values.description || '';
  project.startDate = values.startDate || '';
  project.budget = values.budget === '' ? '' : Number(values.budget);
  project.currency = values.currency || 'INR';
  const after = `${project.name}|${project.client}|${project.description}|${project.startDate}|${project.budget}|${project.currency}`;
  if (before !== after) {
    addHistory(project, 'project_updated', renamed ? `Project renamed to “${project.name}”.` : 'Project details updated.');
    touch(project);
  }
  return project;
}

export function setArchived(project, archived) {
  project.archived = archived;
  addHistory(project, archived ? 'project_archived' : 'project_restored', archived ? 'Project archived.' : 'Project restored from the archive.');
  return touch(project);
}

/* ------------------------------- baseline ------------------------------- */

export function validateBaselineFields(raw = {}) {
  const errors = {};
  const text = typeof raw.text === 'string' ? raw.text.replace(/\r\n?/g, '\n') : '';
  const values = {
    title: cleanString(raw.title, 200) || 'Original agreement',
    date: cleanString(raw.date, 20),
    text: text.trim(),
  };
  if (!values.text) errors.text = 'Paste the agreement text before saving.';
  else if (values.text.length > LIMITS.maxChars) errors.text = `That text is too long. The limit is ${LIMITS.maxChars.toLocaleString()} letters.`;
  if (values.title.length > 120) errors.title = 'Use 120 letters or fewer for the title.';
  if (values.date && !isValidDateString(values.date)) errors.date = 'Enter a real date.';
  return { errors, values, ok: Object.keys(errors).length === 0 };
}

export function saveBaseline(project, values) {
  const now = nowISO();
  if (project.baseline) {
    const b = project.baseline;
    if (b.text === values.text && b.title === values.title && b.date === values.date) return { project, changed: false };
    project.baselineRevisions.push({ title: b.title, date: b.date, text: b.text, savedAt: b.updatedAt });
    project.baseline = { ...values, createdAt: b.createdAt, updatedAt: now };
    addHistory(project, 'baseline_revised', `Original agreement changed. The old version was kept (version ${project.baselineRevisions.length}).`);
  } else {
    project.baseline = { ...values, createdAt: now, updatedAt: now };
    addHistory(project, 'baseline_created', 'Original agreement saved.');
  }
  touch(project);
  return { project, changed: true };
}

/* ------------------------------- requests ------------------------------- */

export function validateRequestFields(raw = {}) {
  const errors = {};
  const text = typeof raw.text === 'string' ? raw.text.replace(/\r\n?/g, '\n').trim() : '';
  const values = {
    text,
    date: cleanString(raw.date, 20),
    source: cleanString(raw.source, 80),
    reference: cleanString(raw.reference, 300),
    notes: cleanString(raw.notes, 3000),
  };
  if (!values.text) errors.text = 'Add what the client asked for.';
  else if (values.text.length > 8000) errors.text = 'That request is too long. Use 8,000 letters or fewer.';
  if (!values.date) errors.date = 'Enter the date you received it.';
  else if (!isValidDateString(values.date)) errors.date = 'Enter a valid date.';
  return { errors, values, ok: Object.keys(errors).length === 0 };
}

export const sortedRequests = (project) => [...project.requests].sort((a, b) =>
  (a.date || '').localeCompare(b.date || '') || a.createdAt.localeCompare(b.createdAt));

export const requestLabel = (r) => `Request received ${fmtDate(r.date)}${r.source ? ` via ${r.source}` : ''}`;

export function addRequest(project, values) {
  const now = nowISO();
  const r = { id: uid(), ...values, createdAt: now, updatedAt: now };
  project.requests.push(r);
  addHistory(project, 'request_added', `Client request added: “${truncate(r.text, 90)}”`, {
    requestId: r.id, receivedDate: r.date, source: r.source,
  });
  touch(project);
  return r;
}

export function updateRequest(project, id, values) {
  const r = project.requests.find((x) => x.id === id);
  if (!r) return null;
  const changed = ['text', 'date', 'source', 'reference', 'notes'].some((k) => r[k] !== values[k]);
  Object.assign(r, values);
  if (changed) {
    r.updatedAt = nowISO();
    addHistory(project, 'request_edited', `Client request edited: “${truncate(r.text, 90)}”`, { requestId: r.id, receivedDate: r.date, source: r.source });
    touch(project);
  }
  return r;
}

export function deleteRequest(project, id) {
  const r = project.requests.find((x) => x.id === id);
  if (!r) return false;
  project.requests = project.requests.filter((x) => x.id !== id);
  addHistory(project, 'request_deleted', `Client request deleted: “${truncate(r.text, 90)}”. Earlier comparisons keep their own copy.`, { requestId: id });
  touch(project);
  return true;
}

/* ----------------------------- comparisons ------------------------------ */

export function runComparison(project, { mode, requestIds = [], manualText = '' }) {
  if (!project.baseline || !project.baseline.text.trim()) {
    return { ok: false, error: 'Add the original agreement first. Every comparison starts from it.' };
  }
  let reqs = [];
  let manual = '';
  if (mode === 'manual') {
    manual = String(manualText || '').replace(/\r\n?/g, '\n').trim();
    if (!manual) return { ok: false, error: 'Paste the new version of the agreement.', field: 'manualText' };
    if (manual.length > LIMITS.maxChars) return { ok: false, error: `That text is too long. The limit is ${LIMITS.maxChars.toLocaleString()} letters.`, field: 'manualText' };
  } else {
    mode = 'requests';
    reqs = sortedRequests(project).filter((r) => requestIds.includes(r.id));
    if (!reqs.length) return { ok: false, error: 'Choose at least one client request.', field: 'requests' };
  }

  const result = compareScope({
    originalText: project.baseline.text,
    mode,
    requests: reqs.map((r) => ({ id: r.id, text: r.text, label: requestLabel(r) })),
    manualText: manual,
  });

  // Carry decisions over from the most recent comparison when a finding is identical.
  const prev = project.comparisons[project.comparisons.length - 1];
  let carried = 0;
  if (prev) {
    const map = new Map();
    for (const f of prev.findings) if (f.status !== 'pending' || f.note) map.set(f.key, f);
    for (const f of result.findings) {
      const old = map.get(f.key);
      if (old) { f.status = old.status; f.note = old.note; carried += 1; }
    }
  }

  const comparison = {
    id: uid(),
    createdAt: nowISO(),
    mode,
    baseline: {
      title: project.baseline.title,
      date: project.baseline.date,
      revision: project.baselineRevisions.length + 1,
    },
    requestIds: reqs.map((r) => r.id),
    requests: reqs.map((r) => ({ id: r.id, text: r.text, date: r.date, source: r.source, reference: r.reference, enteredAt: r.createdAt })),
    originalText: project.baseline.text,
    updatedText: result.updatedText,
    findings: result.findings,
    stats: result.stats,
    message: '',
    messageEdited: false,
    exports: [],
  };
  project.comparisons.push(comparison);

  const s = summarizeFindings(comparison.findings);
  addHistory(project, 'comparison_run',
    `Comparison done (${mode === 'manual' ? 'against a new version of the agreement' : plural(reqs.length, 'client request')}): ` +
    `${s.additions} may be new work, ${s.modified} may change agreed work, ${s.removals} may be removed, ${s.clarify} need clarification.` +
    (carried ? ` ${plural(carried, 'earlier choice')} kept from the last comparison.` : ''),
    { comparisonId: comparison.id });
  touch(project);
  return { ok: true, comparison, carried };
}

export const getComparison = (project, id) => project.comparisons.find((c) => c.id === id) || null;
export const latestComparison = (project) => project.comparisons[project.comparisons.length - 1] || null;

export function deleteComparison(project, id) {
  const before = project.comparisons.length;
  project.comparisons = project.comparisons.filter((c) => c.id !== id);
  if (project.comparisons.length === before) return false;
  addHistory(project, 'comparison_deleted', 'A saved comparison was deleted.');
  touch(project);
  return true;
}

export function setFindingStatus(project, comparison, findingId, status) {
  const f = comparison.findings.find((x) => x.id === findingId);
  if (!f || !STATUSES.includes(status)) return null;
  if (f.status === status) return f;
  f.status = status;
  addHistory(project, 'finding_reviewed',
    status === 'pending'
      ? `Cleared your choice for “${truncate(f.title, 70)}”.`
      : `Marked “${truncate(f.title, 70)}” as: ${STATUS_LABELS[status]}.`,
    { comparisonId: comparison.id, findingId, status });
  touch(project);
  return f;
}

export function setFindingNote(project, comparison, findingId, note) {
  const f = comparison.findings.find((x) => x.id === findingId);
  if (!f) return null;
  const clean = String(note ?? '').slice(0, 5000).trim();
  if (clean === f.note) return f;
  const had = !!f.note;
  f.note = clean;
  addHistory(project, 'note_saved',
    clean ? `${had ? 'Changed' : 'Added'} a note on “${truncate(f.title, 70)}”.` : `Removed the note on “${truncate(f.title, 70)}”.`,
    { comparisonId: comparison.id, findingId });
  touch(project);
  return f;
}

export function setMessage(project, comparison, text) {
  comparison.message = String(text ?? '').slice(0, 10000);
  comparison.messageEdited = true;
  addHistory(project, 'message_edited', 'Message to the client was edited.', { comparisonId: comparison.id });
  touch(project);
}

export function resetMessage(comparison) {
  comparison.message = '';
  comparison.messageEdited = false;
}

export function logExport(project, comparison, kind) {
  comparison.exports.push({ at: nowISO(), kind });
  addHistory(project, 'report_exported', `Report saved or shared (${kind}).`, { comparisonId: comparison.id, kind });
  touch(project);
}

export function logDataExport(project) {
  addHistory(project, 'data_exported', 'Project backup downloaded.');
  touch(project);
}

/* ------------------------------ dashboard ------------------------------- */

export function comparisonSummaryText(comparison) {
  const s = summarizeFindings(comparison.findings);
  if (!s.flagged) return 'No changes found';
  const bits = [];
  if (s.additions) bits.push(`${s.additions} may be new work`);
  if (s.modified) bits.push(`${s.modified} may change agreed work`);
  if (s.removals) bits.push(`${s.removals} may be removed`);
  if (s.ambiguous) bits.push(`${s.ambiguous} unclear`);
  if (s.duplicates) bits.push(`${s.duplicates} possibly already included`);
  return bits.join(' · ');
}

export function projectStatusLine(project) {
  const c = latestComparison(project);
  if (c) return `Last compared ${fmtDate(c.createdAt)}: ${comparisonSummaryText(c)}`;
  if (!project.baseline) return 'No agreement added yet';
  if (!project.requests.length) return 'Agreement added. No client requests yet';
  return `Agreement added · ${plural(project.requests.length, 'client request')} · not compared yet`;
}

export function searchProjects(projects, query) {
  const q = String(query || '').trim().toLowerCase();
  const list = !q ? projects : projects.filter((p) => `${p.name} ${p.client}`.toLowerCase().includes(q));
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/* ----------------------------- export / import -------------------------- */

export function exportEnvelope(projects) {
  return {
    app: 'WorkSphare',
    schema: SCHEMA_VERSION,
    exportedAt: nowISO(),
    note: 'WorkSphare backup. This is a plain, unlocked file. Keep it somewhere safe and private.',
    projects,
  };
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const safeId = (v) => (typeof v === 'string' && /^[\w-]{1,80}$/.test(v) ? v : null);
const isoOrNow = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : nowISO());
const dateOrEmpty = (v) => (typeof v === 'string' && isValidDateString(v) ? v : '');

function sanitizeFinding(f) {
  if (!isObj(f) || !FINDING_TYPES.includes(f.type)) return null;
  const orig = cleanString(f.original, 4000);
  const upd = cleanString(f.updated, 4000);
  return {
    id: safeId(f.id) || uid(),
    key: cleanString(f.key, 40) || uid(),
    type: f.type,
    title: cleanString(f.title, 300) || TYPE_LABELS[f.type],
    original: orig,
    updated: upd,
    reason: cleanString(f.reason, 2000),
    flags: Array.isArray(f.flags) ? f.flags.slice(0, 12).map((x) => cleanString(x, 500)).filter(Boolean) : [],
    confidence: CONFIDENCES.includes(f.confidence) ? f.confidence : 'medium',
    similarity: typeof f.similarity === 'number' && f.similarity >= 0 && f.similarity <= 1 ? f.similarity : null,
    source: isObj(f.source) ? { requestId: cleanString(f.source.requestId, 80), label: cleanString(f.source.label, 300) } : null,
    closest: isObj(f.closest) && typeof f.closest.text === 'string'
      ? { text: cleanString(f.closest.text, 4000), similarity: typeof f.closest.similarity === 'number' ? f.closest.similarity : 0 } : null,
    related: isObj(f.related) && typeof f.related.text === 'string' ? { text: cleanString(f.related.text, 4000) } : null,
    diff: Array.isArray(f.diff)
      ? f.diff.slice(0, 400).filter((c) => isObj(c) && ['eq', 'add', 'del'].includes(c.type) && typeof c.text === 'string').map((c) => ({ type: c.type, text: c.text.slice(0, 4000) }))
      : null,
    status: STATUSES.includes(f.status) ? f.status : 'pending',
    note: cleanString(f.note, 5000),
  };
}

function sanitizeProject(raw) {
  if (!isObj(raw)) return { error: 'It is not a project.' };
  const name = cleanString(raw.name, 120);
  if (!name) return { error: 'It has no project name.' };
  const now = nowISO();
  const budgetNum = raw.budget === '' || raw.budget == null ? '' : Number(raw.budget);
  const p = {
    id: safeId(raw.id) || uid(),
    schema: SCHEMA_VERSION,
    name,
    client: cleanString(raw.client, 120),
    description: cleanString(raw.description, 1000),
    startDate: dateOrEmpty(raw.startDate),
    budget: budgetNum === '' || !Number.isFinite(budgetNum) || budgetNum < 0 ? '' : budgetNum,
    currency: CURRENCIES.includes(raw.currency) ? raw.currency : 'INR',
    archived: raw.archived === true,
    isDemo: raw.isDemo === true,
    createdAt: isoOrNow(raw.createdAt),
    updatedAt: isoOrNow(raw.updatedAt || now),
    baseline: null,
    baselineRevisions: [],
    requests: [],
    comparisons: [],
    history: [],
  };

  const mkScope = (b) => {
    if (!isObj(b) || typeof b.text !== 'string' || !b.text.trim()) return null;
    return {
      title: cleanString(b.title, 200) || 'Original agreement',
      date: dateOrEmpty(b.date),
      text: b.text.slice(0, LIMITS.maxChars),
    };
  };
  const base = mkScope(raw.baseline);
  if (base) p.baseline = { ...base, createdAt: isoOrNow(raw.baseline.createdAt), updatedAt: isoOrNow(raw.baseline.updatedAt) };
  if (Array.isArray(raw.baselineRevisions)) {
    for (const r of raw.baselineRevisions.slice(0, 200)) {
      const s = mkScope(r);
      if (s) p.baselineRevisions.push({ ...s, savedAt: isoOrNow(r.savedAt) });
    }
  }

  const idMap = new Map();
  if (Array.isArray(raw.requests)) {
    for (const r of raw.requests.slice(0, 2000)) {
      if (!isObj(r) || typeof r.text !== 'string' || !r.text.trim()) continue;
      const id = safeId(r.id) || uid();
      idMap.set(r.id, id);
      p.requests.push({
        id,
        text: r.text.trim().slice(0, 8000),
        date: dateOrEmpty(r.date) || p.createdAt.slice(0, 10),
        source: cleanString(r.source, 80),
        reference: cleanString(r.reference, 300),
        notes: cleanString(r.notes, 3000),
        createdAt: isoOrNow(r.createdAt),
        updatedAt: isoOrNow(r.updatedAt),
      });
    }
  }

  if (Array.isArray(raw.comparisons)) {
    for (const c of raw.comparisons.slice(0, 200)) {
      if (!isObj(c) || !Array.isArray(c.findings)) continue;
      const findings = c.findings.slice(0, 3000).map(sanitizeFinding).filter(Boolean);
      const seen = new Set();
      findings.forEach((f) => { while (seen.has(f.id)) f.id = uid(); seen.add(f.id); });
      p.comparisons.push({
        id: safeId(c.id) || uid(),
        createdAt: isoOrNow(c.createdAt),
        mode: c.mode === 'manual' ? 'manual' : 'requests',
        baseline: {
          title: cleanString(c.baseline?.title, 200) || 'Original agreement',
          date: dateOrEmpty(c.baseline?.date),
          revision: Number.isInteger(c.baseline?.revision) ? c.baseline.revision : 1,
        },
        requestIds: Array.isArray(c.requestIds) ? c.requestIds.map((x) => idMap.get(x) || safeId(x)).filter(Boolean).slice(0, 2000) : [],
        requests: Array.isArray(c.requests) ? c.requests.slice(0, 2000).filter((r) => isObj(r) && typeof r.text === 'string').map((r) => ({
          id: safeId(r.id) || uid(),
          text: r.text.slice(0, 8000),
          date: dateOrEmpty(r.date),
          source: cleanString(r.source, 80),
          reference: cleanString(r.reference, 300),
          enteredAt: isoOrNow(r.enteredAt),
        })) : [],
        originalText: typeof c.originalText === 'string' ? c.originalText.slice(0, LIMITS.maxChars * 2) : '',
        updatedText: typeof c.updatedText === 'string' ? c.updatedText.slice(0, LIMITS.maxChars * 2) : '',
        findings,
        stats: isObj(c.stats) ? Object.fromEntries(Object.entries(c.stats).filter(([, v]) => typeof v === 'number').slice(0, 10)) : {},
        message: cleanString(c.message, 10000),
        messageEdited: c.messageEdited === true,
        exports: Array.isArray(c.exports) ? c.exports.slice(0, 200).filter(isObj).map((e) => ({ at: isoOrNow(e.at), kind: cleanString(e.kind, 20) })) : [],
      });
    }
  }

  if (Array.isArray(raw.history)) {
    for (const h of raw.history.slice(0, 5000)) {
      if (!isObj(h) || typeof h.text !== 'string') continue;
      p.history.push({
        id: safeId(h.id) || uid(),
        at: isoOrNow(h.at),
        type: Object.hasOwn(HISTORY_LABELS, h.type) ? h.type : 'project_updated',
        text: h.text.slice(0, 1000),
        meta: isObj(h.meta) ? Object.fromEntries(Object.entries(h.meta).filter(([, v]) => typeof v === 'string' || typeof v === 'number').slice(0, 8).map(([k, v]) => [k.slice(0, 30), typeof v === 'string' ? v.slice(0, 200) : v])) : {},
      });
    }
  }
  return { project: p };
}

/**
 * Validates a parsed backup file. Never throws. Returns { projects, errors, warnings }.
 * Nothing is trusted: every field is type-checked, trimmed and length-limited.
 */
export function validateImport(data) {
  const errors = [];
  const warnings = [];
  const projects = [];
  if (!isObj(data)) return { projects, errors: ['This is not a WorkSphare backup file.'], warnings };
  if (data.app !== 'WorkSphare' && data.app !== 'ScopeLens') return { projects, errors: ['This does not look like a WorkSphare backup file.'], warnings };
  if (typeof data.schema !== 'number' || data.schema < 1) return { projects, errors: ['This backup file is missing its version number.'], warnings };
  if (data.schema > SCHEMA_VERSION) return { projects, errors: [`This backup was made by a newer version of WorkSphare. Update the app and try again.`], warnings };
  if (!Array.isArray(data.projects)) return { projects, errors: ['This backup file has no projects in it.'], warnings };
  if (data.projects.length > 500) warnings.push('Only the first 500 projects were restored.');
  data.projects.slice(0, 500).forEach((raw, i) => {
    const r = sanitizeProject(raw);
    if (r.error) warnings.push(`Skipped project ${i + 1}: ${r.error}`);
    else projects.push(r.project);
  });
  if (!projects.length && !errors.length) errors.push('No usable projects were found in this file.');
  return { projects, errors, warnings };
}

/** Gives an imported project a fresh id if one already exists, so nothing is overwritten. */
export function prepareImported(project, existingIds) {
  if (existingIds.has(project.id)) {
    project.id = uid();
    project.name = `${project.name} (restored copy)`.slice(0, 140);
  }
  existingIds.add(project.id);
  return project;
}

/* --------------------------------- demo --------------------------------- */

export function buildDemoProject() {
  const p = newProject({
    name: 'Sunrise Bakery website (sample)',
    client: 'Sample client',
    description: 'A made-up project so you can try WorkSphare. You can remove it any time from the Backups page.',
    startDate: offsetDate(-30),
    budget: '45000',
    currency: 'INR',
  });
  p.isDemo = true;
  p.history = [];
  addHistory(p, 'demo_loaded', 'Sample project loaded. Everything in it is made up.');
  saveBaseline(p, {
    title: 'Signed website proposal',
    date: offsetDate(-28),
    text: [
      'Work to be delivered:',
      '- A 5-page responsive website: Home, About, Menu, Gallery and Contact.',
      '- The contact page will include a contact form with name, email and message fields.',
      '- Menu items will be supplied by the client and entered by the developer, up to 30 items.',
      '- The site will be delivered on the client\'s existing domain and hosting.',
      '- Basic on-page SEO: page titles and meta descriptions for each page.',
      '- Up to 2 rounds of revisions are included.',
      '',
      'The agreement does not include online ordering, payment processing or photography.',
      'Delivery is within 4 weeks of receiving all content.',
    ].join('\n'),
  });
  const demoRequests = [
    [-20, 'Email', 'Re: Menu page', 'Hi! Could you also add an online ordering form so customers can pre-order cakes? Thanks!'],
    [-12, 'Chat message', '', 'Please change the number of pages from 5 to 7, we want to add a Blog and a Careers page.'],
    [-7, 'Meeting', 'Weekly call', "We'd like to drop the Gallery page for now."],
    [-3, 'Email', '', 'The contact form should also include a phone number field.'],
    [-1, 'Chat message', '', 'Can you make the site look more modern and improve the speed? Also a third round of revisions please.'],
  ];
  for (const [d, source, reference, text] of demoRequests) {
    addRequest(p, { text, date: offsetDate(d), source, reference, notes: '' });
  }
  return p;
}

export { todayDate };
