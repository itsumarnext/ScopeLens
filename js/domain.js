// domain.js — business rules for the workspace. Pure functions: no DOM, no storage.
// Everything the screens show (balances, overdue days, deadlines, dashboard totals) is calculated here
// from saved records, so the numbers can never drift away from the data.

import { isValidDateString, todayDate } from './utils.js';
import { money as fmtM } from './fmt.js';

export const CLIENT_STATUSES = ['Lead', 'Active', 'Inactive', 'Archived'];
export const CLIENT_TYPES = ['Individual', 'Small business', 'Company', 'Agency', 'Startup', 'Non-profit', 'Other'];
export const LEAD_STATUSES = ['New', 'Contacted', 'Proposal Sent', 'Negotiation', 'Won', 'Lost'];
export const LEAD_SOURCES = ['Referral', 'Website', 'Social media', 'Cold outreach', 'Marketplace', 'Event', 'Other'];
export const PROJECT_STATUSES = ['Not Started', 'In Progress', 'On Hold', 'Completed', 'Cancelled'];
export const INVOICE_STATUSES = ['Draft', 'Unpaid', 'Partially Paid', 'Paid', 'Overdue', 'Cancelled'];
/** Statuses the user sets by hand. The others are worked out from payments and dates. */
export const INVOICE_MANUAL_STATUSES = ['Draft', 'Unpaid', 'Cancelled'];
export const AGREEMENT_STATUSES = ['Draft', 'Active', 'Expiring Soon', 'Expired', 'Completed', 'Archived'];
/** Statuses the user sets by hand. "Expiring Soon" and "Expired" come from the end date. */
export const AGREEMENT_MANUAL_STATUSES = ['Draft', 'Active', 'Completed', 'Archived'];
export const TASK_STATUSES = ['To Do', 'In Progress', 'Done'];
export const PRIORITIES = ['Low', 'Medium', 'High'];
export const CHANGE_STATUSES = ['Needs Review', 'Discussing', 'Approved', 'Rejected', 'Completed'];
export const PAYMENT_METHODS = ['Bank transfer', 'UPI', 'Card', 'Cash', 'Cheque', 'PayPal', 'Other'];
export const WARN_PERIODS = [7, 14, 30, 60, 90];
export const SOON_DAYS = 7;

/* ------------------------------ small helpers ------------------------------ */

const str = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
export const toCents = (n) => Math.round(Number(n) * 100);
export const fromCents = (c) => Math.round(c) / 100;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** Whole days from a to b (b later = positive). Both are YYYY-MM-DD. */
export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** Parses an amount typed by a person. Returns { value } or { error }. */
export function parseMoney(raw, { required = false, allowZero = true } = {}) {
  const s = String(raw ?? '').trim().replace(/[,\s]/g, '').replace(/^[₹$€£]/, '');
  if (!s) return required ? { error: 'Enter an amount, like 45000.' } : { value: '' };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { error: 'Enter a number like 45000 or 1250.50.' };
  const n = Number(s);
  if (!allowZero && n <= 0) return { error: 'The amount must be more than zero.' };
  if (n > 1e12) return { error: 'That amount is too large.' };
  return { value: Math.round(n * 100) / 100 };
}

const dateError = (v, label, required) => {
  if (!v) return required ? `Enter ${label}.` : '';
  return isValidDateString(v) ? '' : `Enter ${label} as a real date.`;
};

export const searchMatch = (haystack, query) => {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return haystack.join(' ').toLowerCase().includes(q);
};

export const compareText = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { sensitivity: 'base' });

/* -------------------------------- lookups -------------------------------- */

export const byId = (list, id) => (id ? list.find((x) => x.id === id) || null : null);
export const clientName = (db, id) => byId(db.clients, id)?.name || '';

/* ------------------------------- validation ------------------------------- */

export function findDuplicateClients(db, values, ignoreId = null) {
  const email = values.email.toLowerCase();
  const name = values.name.toLowerCase();
  const company = values.company.toLowerCase();
  const others = db.clients.filter((c) => c.id !== ignoreId);
  return {
    byEmail: email ? others.find((c) => (c.email || '').toLowerCase() === email) || null : null,
    byName: others.find((c) => c.name.toLowerCase() === name && (c.company || '').toLowerCase() === company) || null,
  };
}

export function validateClient(raw, db, { id = null } = {}) {
  const v = {
    name: str(raw.name, 140), company: str(raw.company, 140), email: str(raw.email, 200), phone: str(raw.phone, 40),
    address: str(raw.address, 500), type: CLIENT_TYPES.includes(raw.type) ? raw.type : 'Individual',
    status: CLIENT_STATUSES.includes(raw.status) ? raw.status : 'Active', notes: str(raw.notes, 5000),
  };
  const errors = {};
  if (!v.name) errors.name = 'Enter the client’s name.';
  if (v.email && !EMAIL_RE.test(v.email)) errors.email = 'Enter an email like name@example.com, or leave it empty.';
  if (v.phone && !/^[\d\s+().-]{5,40}$/.test(v.phone)) errors.phone = 'Use digits, spaces and + - ( ) only.';
  const dup = findDuplicateClients(db, v, id);
  if (!errors.email && dup.byEmail) errors.email = `${dup.byEmail.name} already uses this email. Open that client instead, or use a different email.`;
  return { ok: !Object.keys(errors).length, errors, values: v, duplicateName: !errors.email ? dup.byName : null };
}

export function validateLead(raw) {
  const v = {
    name: str(raw.name, 140), company: str(raw.company, 140), email: str(raw.email, 200), phone: str(raw.phone, 40),
    source: str(raw.source, 60), status: LEAD_STATUSES.includes(raw.status) ? raw.status : 'New',
    nextFollowUp: str(raw.nextFollowUp, 10), notes: str(raw.notes, 5000),
  };
  const errors = {};
  if (!v.name) errors.name = 'Enter the lead’s name.';
  if (v.email && !EMAIL_RE.test(v.email)) errors.email = 'Enter an email like name@example.com, or leave it empty.';
  const val = parseMoney(raw.estimatedValue);
  if (val.error) errors.estimatedValue = val.error; else v.estimatedValue = val.value;
  const de = dateError(v.nextFollowUp, 'the follow-up date', false);
  if (de) errors.nextFollowUp = de;
  return { ok: !Object.keys(errors).length, errors, values: v };
}

export function validateProject(raw, db) {
  const v = {
    name: str(raw.name, 140), clientId: str(raw.clientId, 80), description: str(raw.description, 5000),
    startDate: str(raw.startDate, 10), dueDate: str(raw.dueDate, 10),
    status: PROJECT_STATUSES.includes(raw.status) ? raw.status : 'Not Started',
    agreementId: str(raw.agreementId, 80), notes: str(raw.notes, 5000),
  };
  const errors = {};
  if (!v.name) errors.name = 'Enter a project name.';
  if (!v.clientId) errors.clientId = 'Choose a client. You can add a new one first.';
  else if (!byId(db.clients, v.clientId)) errors.clientId = 'This client is not saved. Choose another.';
  const sd = dateError(v.startDate, 'the start date', false);
  const dd = dateError(v.dueDate, 'the due date', false);
  if (sd) errors.startDate = sd;
  if (dd) errors.dueDate = dd;
  if (!sd && !dd && v.startDate && v.dueDate && v.dueDate < v.startDate) errors.dueDate = 'The due date cannot be before the start date.';
  const val = parseMoney(raw.value);
  if (val.error) errors.value = val.error; else v.value = val.value;
  const p = String(raw.progress ?? '').trim();
  if (p === '') v.progress = 0;
  else if (!/^\d{1,3}$/.test(p) || Number(p) > 100) errors.progress = 'Enter a whole number from 0 to 100.';
  else v.progress = Number(p);
  if (v.agreementId) {
    const a = byId(db.agreements, v.agreementId);
    if (!a) errors.agreementId = 'This agreement is not saved. Choose another.';
    else if (v.clientId && a.clientId !== v.clientId) errors.agreementId = 'This agreement belongs to a different client.';
  }
  return { ok: !Object.keys(errors).length, errors, values: v };
}

export function validateAgreement(raw, db) {
  const v = {
    title: str(raw.title, 160), clientId: str(raw.clientId, 80), projectId: str(raw.projectId, 80),
    scope: str(raw.scope, 60000), deliverables: str(raw.deliverables, 10000), exclusions: str(raw.exclusions, 10000),
    revisions: str(raw.revisions, 400), conditions: str(raw.conditions, 10000),
    startDate: str(raw.startDate, 10), endDate: str(raw.endDate, 10),
    status: AGREEMENT_MANUAL_STATUSES.includes(raw.status) ? raw.status : 'Draft', notes: str(raw.notes, 5000),
  };
  const errors = {};
  if (!v.title) errors.title = 'Enter a title, like “Website design agreement”.';
  if (!v.clientId) errors.clientId = 'Choose a client. You can add a new one first.';
  else if (!byId(db.clients, v.clientId)) errors.clientId = 'This client is not saved. Choose another.';
  if (v.projectId) {
    const p = byId(db.projects, v.projectId);
    if (!p) errors.projectId = 'This project is not saved. Choose another.';
    else if (v.clientId && p.clientId !== v.clientId) errors.projectId = 'This project belongs to a different client.';
  }
  const sd = dateError(v.startDate, 'the start date', false);
  const ed = dateError(v.endDate, 'the end date', false);
  if (sd) errors.startDate = sd;
  if (ed) errors.endDate = ed;
  if (!sd && !ed && v.startDate && v.endDate && v.endDate < v.startDate) errors.endDate = 'The end date cannot be before the start date.';
  const val = parseMoney(raw.value);
  if (val.error) errors.value = val.error; else v.value = val.value;
  return { ok: !Object.keys(errors).length, errors, values: v };
}

export function nextInvoiceNumber(db) {
  let max = 0;
  for (const i of db.invoices) {
    const m = /(\d+)\s*$/.exec(i.number || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `INV-${String(max + 1).padStart(4, '0')}`;
}

export function validateInvoice(raw, db, { id = null } = {}) {
  const v = {
    number: str(raw.number, 40), clientId: str(raw.clientId, 80), projectId: str(raw.projectId, 80),
    description: str(raw.description, 1000), issueDate: str(raw.issueDate, 10), dueDate: str(raw.dueDate, 10),
    status: INVOICE_MANUAL_STATUSES.includes(raw.status) ? raw.status : 'Unpaid', notes: str(raw.notes, 5000),
  };
  const errors = {};
  if (!v.number) errors.number = 'Enter an invoice number.';
  else if (db.invoices.some((i) => i.id !== id && i.number.toLowerCase() === v.number.toLowerCase())) errors.number = 'Another invoice already uses this number.';
  if (!v.clientId) errors.clientId = 'Choose a client.';
  else if (!byId(db.clients, v.clientId)) errors.clientId = 'This client is not saved. Choose another.';
  if (v.projectId) {
    const p = byId(db.projects, v.projectId);
    if (!p) errors.projectId = 'This project is not saved. Choose another.';
    else if (v.clientId && p.clientId !== v.clientId) errors.projectId = 'This project belongs to a different client.';
  }
  if (!v.description) errors.description = 'Say what the invoice is for.';
  const amt = parseMoney(raw.amount, { required: true, allowZero: false });
  if (amt.error) errors.amount = amt.error; else v.amount = amt.value;
  const id1 = dateError(v.issueDate, 'the issue date', true);
  const dd = dateError(v.dueDate, 'the due date', true);
  if (id1) errors.issueDate = id1;
  if (dd) errors.dueDate = dd;
  if (!id1 && !dd && v.dueDate < v.issueDate) errors.dueDate = 'The due date cannot be before the issue date.';
  if (id && !errors.amount) {
    const paid = db.transactions.filter((t) => t.invoiceId === id).reduce((s, t) => s + toCents(t.amount), 0);
    if (toCents(v.amount) < paid) errors.amount = `The amount cannot be less than the ${fmtM(fromCents(paid))} already received.`;
    if (v.status === 'Draft' && paid > 0) errors.status = 'An invoice with payments cannot go back to draft.';
  }
  return { ok: !Object.keys(errors).length, errors, values: v };
}

export function validateTransaction(raw, realDb, { today = todayDate(), ignoreId = null } = {}) {
  const db = ignoreId ? { ...realDb, transactions: realDb.transactions.filter((t) => t.id !== ignoreId) } : realDb;
  const v = {
    clientId: str(raw.clientId, 80), invoiceId: str(raw.invoiceId, 80), projectId: str(raw.projectId, 80), date: str(raw.date, 10),
    method: str(raw.method, 40), reference: str(raw.reference, 120), notes: str(raw.notes, 2000),
  };
  const errors = {};
  const inv = v.invoiceId ? byId(db.invoices, v.invoiceId) : null;
  if (v.invoiceId && !inv) errors.invoiceId = 'This invoice is not saved. Choose another.';
  if (inv) v.clientId = inv.clientId; // an invoice decides the client
  if (!v.clientId) errors.clientId = 'Choose a client, or choose an invoice.';
  else if (!byId(db.clients, v.clientId)) errors.clientId = 'This client is not saved. Choose another.';
  const amt = parseMoney(raw.amount, { required: true, allowZero: false });
  if (amt.error) errors.amount = amt.error; else v.amount = amt.value;
  const de = dateError(v.date, 'the date received', true);
  if (de) errors.date = de;
  else if (v.date > today) errors.date = 'The date received cannot be in the future. Record the payment when it arrives.';
  if (inv && !errors.invoiceId) {
    const view = invoiceView(db, inv, today);
    if (inv.status === 'Draft') errors.invoiceId = 'This invoice is still a draft. Mark it as issued before recording a payment.';
    else if (inv.status === 'Cancelled') errors.invoiceId = 'This invoice is cancelled.';
    else if (!errors.amount && toCents(v.amount) > toCents(view.balance)) errors.amount = `This is more than the ${fmtM(view.balance)} still owed on this invoice.`;
  }
  if (inv) v.projectId = inv.projectId || '';
  else if (v.projectId) {
    const p = byId(db.projects, v.projectId);
    if (!p) errors.projectId = 'This project is not saved. Choose another.';
    else if (v.clientId && p.clientId !== v.clientId) errors.projectId = 'This project belongs to a different client.';
  }
  return { ok: !Object.keys(errors).length, errors, values: v };
}

export function validateTask(raw, db) {
  const v = {
    title: str(raw.title, 160), description: str(raw.description, 3000), dueDate: str(raw.dueDate, 10),
    priority: PRIORITIES.includes(raw.priority) ? raw.priority : 'Medium',
    status: TASK_STATUSES.includes(raw.status) ? raw.status : 'To Do',
    clientId: str(raw.clientId, 80), projectId: str(raw.projectId, 80),
  };
  const errors = {};
  if (!v.title) errors.title = 'Enter what needs to be done.';
  const de = dateError(v.dueDate, 'the due date', false);
  if (de) errors.dueDate = de;
  if (v.clientId && !byId(db.clients, v.clientId)) errors.clientId = 'This client is not saved. Choose another.';
  if (v.projectId) {
    const p = byId(db.projects, v.projectId);
    if (!p) errors.projectId = 'This project is not saved. Choose another.';
    else if (v.clientId && p.clientId !== v.clientId) errors.projectId = 'This project belongs to a different client.';
    else if (!v.clientId) v.clientId = p.clientId; // a project decides the client
  }
  return { ok: !Object.keys(errors).length, errors, values: v };
}

export function validateScopeChange(raw, db, { today = todayDate() } = {}) {
  const v = {
    title: str(raw.title, 160), description: str(raw.description, 5000), clientId: str(raw.clientId, 80),
    projectId: str(raw.projectId, 80), agreementId: str(raw.agreementId, 80),
    dateRequested: str(raw.dateRequested, 10) || today,
    status: CHANGE_STATUSES.includes(raw.status) ? raw.status : 'Needs Review', notes: str(raw.notes, 5000),
  };
  const errors = {};
  if (!v.title) errors.title = 'Give the change a short title.';
  const project = v.projectId ? byId(db.projects, v.projectId) : null;
  const agreement = v.agreementId ? byId(db.agreements, v.agreementId) : null;
  if (v.projectId && !project) errors.projectId = 'This project is not saved. Choose another.';
  if (v.agreementId && !agreement) errors.agreementId = 'This agreement is not saved. Choose another.';
  if (v.clientId && !byId(db.clients, v.clientId)) errors.clientId = 'This client is not saved. Choose another.';
  if (!v.clientId) v.clientId = project?.clientId || agreement?.clientId || '';
  if (v.clientId && project && project.clientId !== v.clientId) errors.projectId = 'This project belongs to a different client.';
  if (v.clientId && agreement && agreement.clientId !== v.clientId) errors.agreementId = 'This agreement belongs to a different client.';
  if (!v.clientId && !project && !agreement) errors.clientId = 'Link a client, a project or an agreement.';
  const de = dateError(v.dateRequested, 'the date requested', true);
  if (de) errors.dateRequested = de;
  const val = parseMoney(raw.additionalPrice);
  if (val.error) errors.additionalPrice = val.error; else v.additionalPrice = val.value;
  return { ok: !Object.keys(errors).length, errors, values: v };
}

export function validateSettings(raw) {
  const v = {
    businessName: str(raw.businessName, 140), email: str(raw.email, 200), phone: str(raw.phone, 40),
    currency: raw.currency, dateFormat: raw.dateFormat, numberLocale: raw.numberLocale,
    currencyDisplay: raw.currencyDisplay === 'code' ? 'code' : 'symbol',
    expiryWarnDays: Number(raw.expiryWarnDays),
  };
  const errors = {};
  if (v.email && !EMAIL_RE.test(v.email)) errors.email = 'Enter an email like name@example.com, or leave it empty.';
  if (!/^[A-Z]{3}$/.test(String(v.currency || ''))) errors.currency = 'Choose a currency.';
  if (!WARN_PERIODS.includes(v.expiryWarnDays)) errors.expiryWarnDays = 'Choose a warning period.';
  return { ok: !Object.keys(errors).length, errors, values: v };
}

/* --------------------------- money and invoice maths --------------------------- */

export function invoicePaid(db, invoiceId) {
  return fromCents(db.transactions.filter((t) => t.invoiceId === invoiceId).reduce((s, t) => s + toCents(t.amount), 0));
}

/**
 * Works out what to show for an invoice. Payments and dates decide Paid, Partially Paid and Overdue.
 * Only Draft, Unpaid and Cancelled are chosen by the user. Opening or editing never marks anything paid.
 */
export function invoiceView(db, inv, today = todayDate()) {
  const amountC = toCents(inv.amount);
  const paidC = db.transactions.filter((t) => t.invoiceId === inv.id).reduce((s, t) => s + toCents(t.amount), 0);
  const balanceC = Math.max(0, amountC - paidC);
  const issued = inv.status !== 'Draft' && inv.status !== 'Cancelled';
  let status = inv.status === 'Draft' || inv.status === 'Cancelled' ? inv.status : 'Unpaid';
  let overdueDays = 0;
  if (issued) {
    if (paidC >= amountC) status = 'Paid';
    else {
      status = paidC > 0 ? 'Partially Paid' : 'Unpaid';
      if (inv.dueDate && inv.dueDate < today) { status = 'Overdue'; overdueDays = daysBetween(inv.dueDate, today); }
    }
  }
  const dueIn = inv.dueDate ? daysBetween(today, inv.dueDate) : null;
  return {
    status, paid: fromCents(paidC), balance: fromCents(balanceC), overdueDays, issued,
    isOpen: issued && balanceC > 0, isOverdue: overdueDays > 0, partial: paidC > 0 && balanceC > 0,
    dueSoon: issued && balanceC > 0 && overdueDays === 0 && dueIn !== null && dueIn <= SOON_DAYS,
  };
}

export function moneyTotals(db, today = todayDate()) {
  let received = 0; let outstanding = 0; let overdue = 0;
  for (const t of db.transactions) received += toCents(t.amount);
  for (const inv of db.invoices) {
    const v = invoiceView(db, inv, today);
    if (!v.isOpen) continue;
    outstanding += toCents(v.balance);
    if (v.isOverdue) overdue += toCents(v.balance);
  }
  return { received: fromCents(received), outstanding: fromCents(outstanding), overdue: fromCents(overdue) };
}

export function clientMoney(db, clientId, today = todayDate()) {
  let outstanding = 0; let received = 0;
  for (const inv of db.invoices) {
    if (inv.clientId !== clientId) continue;
    const v = invoiceView(db, inv, today);
    if (v.isOpen) outstanding += toCents(v.balance);
  }
  for (const t of db.transactions) if (t.clientId === clientId) received += toCents(t.amount);
  return { outstanding: fromCents(outstanding), received: fromCents(received) };
}

export function projectMoney(db, projectId, today = todayDate()) {
  let invoiced = 0; let outstanding = 0; let received = 0;
  for (const inv of db.invoices) {
    if (inv.projectId !== projectId) continue;
    const v = invoiceView(db, inv, today);
    if (v.issued) invoiced += toCents(inv.amount);
    if (v.isOpen) outstanding += toCents(v.balance);
  }
  for (const t of db.transactions) {
    const inv = t.invoiceId ? byId(db.invoices, t.invoiceId) : null;
    if ((inv && inv.projectId === projectId) || (!inv && t.projectId === projectId)) received += toCents(t.amount);
  }
  return { invoiced: fromCents(invoiced), outstanding: fromCents(outstanding), received: fromCents(received) };
}

/* -------------------------------- agreements -------------------------------- */

export function agreementView(a, today = todayDate(), warnDays = 30) {
  let status = a.status;
  let daysLeft = null;
  if (a.endDate) daysLeft = daysBetween(today, a.endDate);
  if (a.status === 'Active' && a.endDate) {
    if (daysLeft < 0) status = 'Expired';
    else if (daysLeft <= warnDays) status = 'Expiring Soon';
  }
  return { status, daysLeft, renewed: !!(a.renewedAt || a.renewedToId) };
}

/* --------------------------------- reminders --------------------------------- */

export function buildReminder({ business, client, invoice, view, fmtMoney, fmtDate }) {
  const first = (client?.name || 'there').split(/\s+/)[0];
  const lines = [`Hi ${first},`, ''];
  if (view.isOverdue) {
    lines.push(`I hope you're well. This is a friendly reminder that invoice ${invoice.number}${invoice.description ? ` (${invoice.description})` : ''} was due on ${fmtDate(invoice.dueDate)} and is now ${view.overdueDays} day${view.overdueDays === 1 ? '' : 's'} past due.`);
  } else {
    lines.push(`I hope you're well. This is a friendly reminder that invoice ${invoice.number}${invoice.description ? ` (${invoice.description})` : ''} is due on ${fmtDate(invoice.dueDate)}.`);
  }
  lines.push('');
  lines.push(`Invoice amount: ${fmtMoney(invoice.amount)}`);
  if (view.paid > 0) lines.push(`Received so far: ${fmtMoney(view.paid)}`);
  lines.push(`Balance due: ${fmtMoney(view.balance)}`);
  lines.push('');
  lines.push('If you have already paid, please let me know the date and reference so I can update my records. If anything about the invoice is unclear, just reply and I will be glad to help.');
  lines.push('');
  lines.push('Thank you,');
  lines.push(business || '');
  return lines.join('\n').trim();
}

/* ------------------------------ deadlines and calendar ------------------------------ */

/** Every dated thing in the workspace, as one list. Each event says what it is and where to open it. */
export function calendarEvents(db, today = todayDate(), warnDays = 30) {
  const ev = [];
  for (const t of db.tasks) {
    if (t.dueDate && t.status !== 'Done') ev.push({ date: t.dueDate, type: 'task', title: t.title, sub: clientName(db, t.clientId), id: t.id, href: '#/tasks', open: 'task-edit' });
  }
  for (const p of db.projects) {
    if (p.dueDate && !p.archived && p.status !== 'Completed' && p.status !== 'Cancelled') ev.push({ date: p.dueDate, type: 'project', title: `Project due: ${p.name}`, sub: clientName(db, p.clientId), id: p.id, href: `#/projects/details/${p.id}` });
  }
  for (const inv of db.invoices) {
    const v = invoiceView(db, inv, today);
    if (v.isOpen && inv.dueDate) ev.push({ date: inv.dueDate, type: 'payment', title: `Payment due: ${inv.number}`, sub: clientName(db, inv.clientId), id: inv.id, href: `#/payments/invoices` , open: 'inv-view' });
  }
  for (const a of db.agreements) {
    const v = agreementView(a, today, warnDays);
    if (a.endDate && (a.status === 'Active') && !v.renewed) ev.push({ date: a.endDate, type: 'agreement', title: `Agreement ends: ${a.title}`, sub: clientName(db, a.clientId), id: a.id, href: `#/agreements/details/${a.id}` });
  }
  for (const l of db.leads) {
    if (l.nextFollowUp && l.status !== 'Won' && l.status !== 'Lost') ev.push({ date: l.nextFollowUp, type: 'lead', title: `Follow up: ${l.name}`, sub: l.company || '', id: l.id, href: '#/clients/leads' });
  }
  return ev.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

export const EVENT_TYPES = {
  task: 'Task', project: 'Project due', payment: 'Payment due', agreement: 'Agreement ends', lead: 'Lead follow-up',
};

/* ---------------------------------- dashboard ---------------------------------- */

export function dashboardMetrics(db, today = todayDate(), warnDays = 30) {
  const money = moneyTotals(db, today);
  const agreements = db.agreements.map((a) => ({ a, v: agreementView(a, today, warnDays) }));
  const openTasks = db.tasks.filter((t) => t.status !== 'Done');
  const inDays = (n) => addDays(today, n);
  const invViews = db.invoices.map((inv) => ({ inv, v: invoiceView(db, inv, today) }));
  const events = calendarEvents(db, today, warnDays);
  return {
    totals: {
      clients: db.clients.filter((c) => c.status !== 'Archived').length,
      activeProjects: db.projects.filter((p) => !p.archived && p.status === 'In Progress').length,
      received: money.received, outstanding: money.outstanding, overdue: money.overdue,
      activeAgreements: agreements.filter((x) => x.v.status === 'Active' || x.v.status === 'Expiring Soon').length,
    },
    today: {
      tasksToday: openTasks.filter((t) => t.dueDate === today),
      tasksOverdue: openTasks.filter((t) => t.dueDate && t.dueDate < today),
      projects: db.projects.filter((p) => !p.archived && p.dueDate && p.status !== 'Completed' && p.status !== 'Cancelled' && p.dueDate <= inDays(14)).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      paymentsSoon: invViews.filter((x) => x.v.dueSoon),
      overdueInvoices: invViews.filter((x) => x.v.isOverdue && x.v.isOpen),
      agreementsEnding: agreements.filter((x) => x.v.status === 'Expiring Soon' && !x.v.renewed),
    },
    upcoming: events.filter((e) => e.date >= today).slice(0, 8),
    overdueEvents: events.filter((e) => e.date < today),
    health: {
      projectsByStatus: PROJECT_STATUSES.map((s) => ({ status: s, count: db.projects.filter((p) => !p.archived && p.status === s).length })),
      invoicesByStatus: INVOICE_STATUSES.map((s) => ({ status: s, count: invViews.filter((x) => x.v.status === s).length })),
      tasksByStatus: TASK_STATUSES.map((s) => ({ status: s, count: db.tasks.filter((t) => t.status === s).length })),
      leadsOpen: db.leads.filter((l) => l.status !== 'Won' && l.status !== 'Lost').length,
      changesOpen: db.scopeChanges.filter((c) => c.status === 'Needs Review' || c.status === 'Discussing').length,
    },
  };
}
