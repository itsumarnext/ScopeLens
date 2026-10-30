// ws/payments.js — Payments tab: Overview, Invoices & payment requests, Transactions, Dues & overdue, printable invoice.

import {
  esc, icon, fmt, field, row2, formError, pageHead, tabsNav, sectionHead, empty, card, menu, table, badge, filterBar, listState,
  options, dl, text, clientLink, projectLink, clientOptions, projectOptions,
} from './ui.js';
import * as D from '../domain.js';
import * as S from '../store.js';
import { copyToClipboard } from '../utils.js';
import {
  toast, confirmDialog, formDialog, infoDialog, showFieldErrors, readForm, trySave, saveWithToast, failForm, go, refresh, today,
} from './core.js';
import { dueBadge, invoiceStatusBadge, transactionTable } from './parts.js';

const TABS = [
  { key: 'overview', label: 'Payment overview', href: '#/payments' },
  { key: 'invoices', label: 'Invoices & payment requests', href: '#/payments/invoices' },
  { key: 'transactions', label: 'Transactions', href: '#/payments/transactions' },
  { key: 'dues', label: 'Dues & overdue', href: '#/payments/dues' },
];
const head = (active, title, sub, actions = '') => `${pageHead({ title, sub, actions })}${tabsNav(TABS, active, 'Payments sections')}`;

/* --------------------------------------- fields --------------------------------------- */

function invoiceFields(db, v = {}) {
  const f = (name, label, o = {}) => field({ id: `iv-${name}`, name, label, value: v[name] ?? '', ...o });
  const statusList = [{ value: 'Draft', label: 'Draft (not issued yet)' }, { value: 'Unpaid', label: 'Issued (waiting for payment)' }, ...(v.status === 'Cancelled' ? [{ value: 'Cancelled', label: 'Cancelled' }] : [])];
  return `${row2(f('number', 'Invoice number', { required: true, max: 40 }), f('clientId', 'Client', { kind: 'select', required: true, list: clientOptions(db, v.clientId), blank: 'Choose a client…', extra: 'data-role="iv-client"' }))}
    ${f('projectId', 'Related project', { kind: 'select', list: projectOptions(db, v.clientId, v.projectId), blank: 'No project', value: v.projectId })}
    ${f('description', 'What is this invoice for?', { kind: 'textarea', rows: 2, required: true, max: 1000 })}
    ${row2(f('amount', 'Amount', { kind: 'money', required: true, value: v.amount ?? '', hint: `In ${db.settings.currency}.` }), f('status', 'Invoice status', { kind: 'select', list: statusList, value: v.status || 'Unpaid', hint: 'Paid and Overdue are worked out for you from payments and dates.' }))}
    ${row2(f('issueDate', 'Issue date', { kind: 'date', required: true }), f('dueDate', 'Due date', { kind: 'date', required: true }))}
    ${f('notes', 'Notes', { kind: 'textarea', rows: 2, max: 5000, hint: 'Shown on the printed invoice. For example your bank details or a thank-you.' })}`;
}

function openInvoiceOptions(db, clientId, includeId = '') {
  const t0 = today();
  return db.invoices
    .filter((i) => (!clientId || i.clientId === clientId))
    .map((i) => ({ i, v: D.invoiceView(db, i, t0) }))
    .filter(({ i, v }) => (v.isOpen) || i.id === includeId)
    .sort((a, b) => a.i.number.localeCompare(b.i.number))
    .map(({ i, v }) => ({ value: i.id, label: `${i.number} · ${i.description.slice(0, 30)} · ${fmt.money(v.balance)} owed` }));
}

function txFields(db, v = {}) {
  const f = (name, label, o = {}) => field({ id: `tx-${name}`, name, label, value: v[name] ?? '', ...o });
  const inv = D.byId(db.invoices, v.invoiceId);
  const clientId = inv ? inv.clientId : v.clientId || '';
  return `${f('clientId', 'Client', { kind: 'select', required: true, list: clientOptions(db, clientId), blank: 'Choose a client…', value: clientId, extra: 'data-role="tx-client"' })}
    ${f('invoiceId', 'Which invoice is this for?', { kind: 'select', list: openInvoiceOptions(db, clientId, v.invoiceId), blank: 'Not linked to an invoice', value: v.invoiceId, extra: 'data-role="tx-invoice"', hint: 'Choosing an invoice updates its balance and status. You can record several part payments on one invoice.' })}
    ${row2(f('amount', 'Amount received', { kind: 'money', required: true, value: v.amount ?? '' }), f('date', 'Date received', { kind: 'date', required: true }))}
    ${row2(f('method', 'Payment method', { kind: 'select', list: D.PAYMENT_METHODS, blank: 'Not recorded', value: v.method }), f('reference', 'Transaction or reference ID', { max: 120 }))}
    ${f('notes', 'Notes', { kind: 'textarea', rows: 2, max: 2000 })}`;
}

/* ------------------------------------ list: invoices ------------------------------------ */

const INV_DEFAULTS = { q: '', status: 'all', client: 'all', sort: 'newest' };
const INV_SORTS = { newest: 'Newest first', due: 'Due date (soonest first)', amount: 'Amount (largest first)', client: 'Client (A to Z)' };

function invoiceListHtml() {
  const db = S.data();
  const st = listState('invoices', INV_DEFAULTS);
  const t0 = today();
  let rows = db.invoices.map((i) => ({ i, v: D.invoiceView(db, i, t0) })).filter(({ i, v }) => (st.status === 'all' || v.status === st.status)
    && (st.client === 'all' || i.clientId === st.client) && D.searchMatch([i.number, i.description, D.clientName(db, i.clientId)], st.q));
  rows.sort({
    newest: (a, b) => b.i.issueDate.localeCompare(a.i.issueDate) || b.i.number.localeCompare(a.i.number),
    due: (a, b) => a.i.dueDate.localeCompare(b.i.dueDate),
    amount: (a, b) => b.i.amount - a.i.amount,
    client: (a, b) => D.compareText(D.clientName(db, a.i.clientId), D.clientName(db, b.i.clientId)),
  }[st.sort] || (() => 0));
  if (!db.invoices.length) return empty({ title: 'No invoices yet', text: 'Create an invoice to track what a client owes. WorkSphare does not send invoices. You print or share them yourself.', action: '<button type="button" class="btn btn-primary" data-action="inv-new">Create an invoice</button>' });
  return table({
    list: 'invoices', rows, caption: 'Invoices', empty: empty({ title: 'No invoices match', text: 'Try a different search or filter.' }),
    cols: [
      { label: 'Invoice', cell: ({ i }) => `<a href="#/payments/invoice/${esc(i.id)}"><strong>${esc(i.number)}</strong></a>${i.demo ? ' ' + badge('Demo', 'muted') : ''}<br><span class="small muted">${esc(i.description.slice(0, 70))}</span>` },
      { label: 'Client', cell: ({ i }) => clientLink(db, i.clientId) },
      { label: 'Project', cell: ({ i }) => projectLink(db, i.projectId) },
      { label: 'Issued', cell: ({ i }) => esc(fmt.date(i.issueDate)) },
      { label: 'Due', cell: ({ i, v }) => dueBadge(i.dueDate, !v.isOpen) },
      { label: 'Amount', cls: 'num', cell: ({ i }) => esc(fmt.money(i.amount)) },
      { label: 'Received', cls: 'num', cell: ({ v }) => esc(fmt.money(v.paid)) },
      { label: 'Balance', cls: 'num', cell: ({ v }) => (v.issued ? `<strong>${esc(fmt.money(v.balance))}</strong>` : '<span class="muted">—</span>') },
      { label: 'Status', cell: ({ v }) => invoiceStatusBadge(v) },
      { label: 'Actions', cls: 'actions', cell: ({ i, v }) => `<div class="row-actions"><a class="btn btn-sm" href="#/payments/invoice/${esc(i.id)}">View</a>${v.isOpen ? `<button type="button" class="btn btn-sm" data-action="txn-new" data-invoice="${esc(i.id)}">Record payment</button>` : ''}${menu([
        { action: 'inv-edit', id: i.id, label: 'Edit', icon: 'edit' },
        ...(i.status === 'Draft' ? [{ action: 'inv-issue', id: i.id, label: 'Mark as issued', icon: 'check' }] : []),
        ...(v.isOpen ? [{ action: 'inv-markpaid', id: i.id, label: 'Mark as paid…', icon: 'check' }, { action: 'inv-reminder', id: i.id, label: 'Payment reminder', icon: 'copy' }] : []),
        ...(i.status === 'Cancelled' ? [{ action: 'inv-reopen', id: i.id, label: 'Reopen invoice', icon: 'rotate' }] : i.status !== 'Cancelled' ? [{ action: 'inv-cancel', id: i.id, label: 'Cancel invoice…', icon: 'x' }] : []),
        { action: 'inv-delete', id: i.id, label: 'Delete…', icon: 'trash', danger: true },
      ], `More actions for ${i.number}`)}</div>` },
    ],
  });
}

function viewInvoices() {
  const db = S.data();
  const st = listState('invoices', INV_DEFAULTS);
  return {
    title: 'Invoices & payment requests', nav: 'payments',
    html: `${head('invoices', 'Invoices & payment requests', 'Create invoice-style documents and track what is still owed. WorkSphare does not send them. Print or save as PDF, then send it yourself.', `<button type="button" class="btn btn-primary" data-action="inv-new">${icon('plus')}New invoice</button>`)}
      ${db.invoices.length ? filterBar('invoices', st, { placeholder: 'Search number, client or description', selects: [{ key: 'status', label: 'Status', options: [{ value: 'all', label: 'All statuses' }, ...D.INVOICE_STATUSES.map((s) => ({ value: s, label: s }))] }, { key: 'client', label: 'Client', options: [{ value: 'all', label: 'All clients' }, ...clientOptions(db)] }, { key: 'sort', label: 'Sort by', options: Object.entries(INV_SORTS).map(([value, label]) => ({ value, label })) }] }) : ''}
      <div id="list-invoices" aria-live="polite">${invoiceListHtml()}</div>`,
  };
}

/* ---------------------------------- list: transactions ---------------------------------- */

const TX_DEFAULTS = { q: '', client: 'all', method: 'all', sort: 'newest' };

function txListHtml() {
  const db = S.data();
  const st = listState('transactions', TX_DEFAULTS);
  const rows = db.transactions.filter((t) => (st.client === 'all' || t.clientId === st.client) && (st.method === 'all' || t.method === st.method)
    && D.searchMatch([t.reference, t.notes, D.clientName(db, t.clientId), D.byId(db.invoices, t.invoiceId)?.number], st.q))
    .sort(st.sort === 'oldest' ? (a, b) => a.date.localeCompare(b.date) : st.sort === 'amount' ? (a, b) => b.amount - a.amount : (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  if (!db.transactions.length) return empty({ title: 'No payments recorded yet', text: 'When a client pays you, record it here. Part payments are fine. Invoice balances update by themselves.', action: '<button type="button" class="btn btn-primary" data-action="txn-new">Record a payment</button>' });
  return table({
    list: 'transactions', rows, caption: 'Payments received', empty: empty({ title: 'No payments match', text: 'Try a different search or filter.' }),
    cols: [
      { label: 'Date', cell: (t) => esc(fmt.date(t.date)) },
      { label: 'Client', cell: (t) => clientLink(db, t.clientId) },
      { label: 'Invoice', cell: (t) => { const i = D.byId(db.invoices, t.invoiceId); return i ? `<a href="#/payments/invoice/${esc(i.id)}">${esc(i.number)}</a>` : '<span class="muted">Not linked</span>'; } },
      { label: 'Amount received', cls: 'num', cell: (t) => `<strong>${esc(fmt.money(t.amount))}</strong>` },
      { label: 'Method', cell: (t) => esc(t.method || '—') },
      { label: 'Reference', cell: (t) => esc(t.reference || '—') },
      { label: 'Notes', cell: (t) => esc(t.notes || '—') },
      { label: 'Actions', cls: 'actions', cell: (t) => `<div class="row-actions"><button type="button" class="btn btn-sm" data-action="txn-edit" data-id="${esc(t.id)}">Edit</button>${menu([{ action: 'txn-delete', id: t.id, label: 'Delete…', icon: 'trash', danger: true }], 'More actions for this payment')}</div>` },
    ],
  });
}

function viewTransactions() {
  const db = S.data();
  const st = listState('transactions', TX_DEFAULTS);
  const total = db.transactions.reduce((s, t) => s + D.toCents(t.amount), 0);
  return {
    title: 'Transactions', nav: 'payments',
    html: `${head('transactions', 'Transactions', 'Every payment you have received. Each one can be tied to an invoice.', `<button type="button" class="btn btn-primary" data-action="txn-new">${icon('plus')}Record payment</button>`)}
      ${db.transactions.length ? `<p class="muted">${db.transactions.length} payment${db.transactions.length === 1 ? '' : 's'} recorded, ${esc(fmt.money(D.fromCents(total)))} received in total.</p>${filterBar('transactions', st, { placeholder: 'Search client, invoice, reference or notes', selects: [{ key: 'client', label: 'Client', options: [{ value: 'all', label: 'All clients' }, ...clientOptions(db)] }, { key: 'method', label: 'Method', options: [{ value: 'all', label: 'Any method' }, ...D.PAYMENT_METHODS.map((m) => ({ value: m, label: m }))] }, { key: 'sort', label: 'Sort by', options: [{ value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }, { value: 'amount', label: 'Amount (largest first)' }] }] })}` : ''}
      <div id="list-transactions" aria-live="polite">${txListHtml()}</div>`,
  };
}

/* ------------------------------------- list: dues ------------------------------------- */

const DUES_DEFAULTS = { q: '', status: 'all', client: 'all', from: '', to: '' };

function duesListHtml() {
  const db = S.data();
  const st = listState('dues', DUES_DEFAULTS);
  const t0 = today();
  const rows = db.invoices.map((i) => ({ i, v: D.invoiceView(db, i, t0) })).filter(({ i, v }) => v.isOpen
    && (st.status === 'all' || (st.status === 'overdue' && v.isOverdue) || (st.status === 'soon' && v.dueSoon) || (st.status === 'later' && !v.isOverdue && !v.dueSoon))
    && (st.client === 'all' || i.clientId === st.client) && (!st.from || i.dueDate >= st.from) && (!st.to || i.dueDate <= st.to)
    && D.searchMatch([i.number, i.description, D.clientName(db, i.clientId)], st.q))
    .sort((a, b) => a.i.dueDate.localeCompare(b.i.dueDate));
  if (!db.invoices.some((i) => D.invoiceView(db, i, t0).isOpen)) return empty({ title: 'Nothing is owed right now', text: 'Issued invoices that are not fully paid will be listed here, with how many days late they are.' });
  const sum = rows.reduce((s, { v }) => s + D.toCents(v.balance), 0);
  return `<p class="muted">${rows.length} invoice${rows.length === 1 ? '' : 's'} shown · ${esc(fmt.money(D.fromCents(sum)))} still owed</p>${table({
    list: 'dues', rows, caption: 'Unpaid invoices', empty: empty({ title: 'No invoices match', text: 'Try a different filter.' }),
    cols: [
      { label: 'Invoice', cell: ({ i }) => `<a href="#/payments/invoice/${esc(i.id)}"><strong>${esc(i.number)}</strong></a>` },
      { label: 'Client', cell: ({ i }) => clientLink(db, i.clientId) },
      { label: 'Due date', cell: ({ i }) => esc(fmt.date(i.dueDate)) },
      { label: 'Days overdue', cell: ({ v }) => (v.isOverdue ? `<strong>${v.overdueDays}</strong>` : '<span class="muted">Not overdue</span>') },
      { label: 'Balance', cls: 'num', cell: ({ v }) => `<strong>${esc(fmt.money(v.balance))}</strong>${v.partial ? `<br><span class="small muted">of ${esc(fmt.money(v.paid + v.balance))}</span>` : ''}` },
      { label: 'Status', cell: ({ v }) => invoiceStatusBadge(v) },
      { label: 'Actions', cls: 'actions', cell: ({ i }) => `<div class="row-actions"><button type="button" class="btn btn-sm" data-action="inv-reminder" data-id="${esc(i.id)}">Reminder</button><button type="button" class="btn btn-sm" data-action="txn-new" data-invoice="${esc(i.id)}">Record payment</button></div>` },
    ],
  })}`;
}

function viewDues() {
  const db = S.data();
  const st = listState('dues', DUES_DEFAULTS);
  const dates = `<div class="filter-select"><label for="f-dues-from">Due from</label><input id="f-dues-from" class="input" type="date" data-role="filter" data-list="dues" data-key="from" value="${esc(st.from)}"></div><div class="filter-select"><label for="f-dues-to">Due until</label><input id="f-dues-to" class="input" type="date" data-role="filter" data-list="dues" data-key="to" value="${esc(st.to)}"></div>`;
  return {
    title: 'Dues & overdue', nav: 'payments',
    html: `${head('dues', 'Dues & overdue', 'Unpaid and part-paid invoices. Overdue is worked out from the due date and today’s date.')}
      <p class="note">${icon('info')}<span>Reminders are drafts for you to copy and send yourself. WorkSphare does not send emails or messages.</span></p>
      ${filterBar('dues', st, { placeholder: 'Search invoice or client', selects: [{ key: 'status', label: 'Status', options: [{ value: 'all', label: 'All unpaid' }, { value: 'overdue', label: 'Overdue' }, { value: 'soon', label: 'Due in the next 7 days' }, { value: 'later', label: 'Not due yet' }] }, { key: 'client', label: 'Client', options: [{ value: 'all', label: 'All clients' }, ...clientOptions(db)] }], extra: dates })}
      <div id="list-dues" aria-live="polite">${duesListHtml()}</div>`,
  };
}

/* ----------------------------------------- overview ----------------------------------------- */

function viewOverview() {
  const db = S.data();
  const t0 = today();
  const m = D.moneyTotals(db, t0);
  const views = db.invoices.map((i) => ({ i, v: D.invoiceView(db, i, t0) }));
  const soon = views.filter(({ v }) => v.dueSoon).sort((a, b) => a.i.dueDate.localeCompare(b.i.dueDate));
  const soonSum = soon.reduce((s, { v }) => s + D.toCents(v.balance), 0);
  const recent = [...db.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  return {
    title: 'Payments', nav: 'payments',
    html: `${head('overview', 'Payments', 'Money you have received, kept apart from money you are still owed.', `<button type="button" class="btn" data-action="txn-new">${icon('wallet')}Record payment</button><button type="button" class="btn btn-primary" data-action="inv-new">${icon('plus')}New invoice</button>`)}
      <div class="grid-2">
        ${card(`<h2>Money received</h2><div class="stat stat-wide"><span class="stat-n">${esc(fmt.money(m.received))}</span><span class="stat-l">Total payments you have recorded</span></div><a href="#/payments/transactions">See all transactions</a>`)}
        ${card(`<h2>Money still owed</h2><div class="summary summary-3 summary-tight"><div class="stat"><span class="stat-n">${esc(fmt.money(m.outstanding))}</span><span class="stat-l">Outstanding</span></div><div class="stat"><span class="stat-n">${esc(fmt.money(m.overdue))}</span><span class="stat-l">Overdue</span></div><div class="stat"><span class="stat-n">${esc(fmt.money(D.fromCents(soonSum)))}</span><span class="stat-l">Due in 7 days</span></div></div><p class="small muted">Draft and cancelled invoices are not counted as owed.</p><a href="#/payments/dues">See dues and overdue</a>`)}
      </div>
      ${card(`${sectionHead('Payments due soon', 'Due in the next 7 days.')}${soon.length ? `<ul class="plain-list">${soon.map(({ i, v }) => `<li><div class="list-text"><a href="#/payments/invoice/${esc(i.id)}">${esc(i.number)}</a><span class="small muted">${esc(D.clientName(db, i.clientId))} · ${esc(fmt.money(v.balance))} owed</span></div>${dueBadge(i.dueDate)}</li>`).join('')}</ul>` : '<p class="muted">No payments are due in the next 7 days.</p>'}`)}
      ${card(`${sectionHead('Recent transactions', 'The latest payments you recorded.')}${transactionTable(db, recent)}`)}`,
  };
}

/* ------------------------------------ printable invoice ------------------------------------ */

function viewInvoice(id) {
  const db = S.data();
  const inv = D.byId(db.invoices, id);
  if (!inv) return { title: 'Invoice not found', nav: 'payments', html: `${head('invoices', 'Invoice', '')}${empty({ title: 'This invoice is not here', text: 'It may have been deleted.', action: '<a class="btn" href="#/payments/invoices">Back to invoices</a>' })}` };
  const v = D.invoiceView(db, inv, today());
  const c = D.byId(db.clients, inv.clientId);
  const s = db.settings;
  const txns = db.transactions.filter((t) => t.invoiceId === id).sort((a, b) => a.date.localeCompare(b.date));
  const hasProfile = s.businessName || s.email || s.phone;
  return {
    title: `Invoice ${inv.number}`, nav: 'payments', report: true,
    html: `<div class="report-tools no-print">
        <a class="btn" href="#/payments/invoices">${icon('chevron-left')}All invoices</a>
        <button type="button" class="btn btn-primary" data-action="print-page">${icon('printer')}Print or save as PDF</button>
        ${v.isOpen ? `<button type="button" class="btn" data-action="txn-new" data-invoice="${esc(id)}">Record payment</button><button type="button" class="btn" data-action="inv-reminder" data-id="${esc(id)}">Payment reminder</button>` : ''}
        <button type="button" class="btn" data-action="inv-edit" data-id="${esc(id)}">${icon('edit')}Edit</button>
      </div>
      <p class="note no-print">${icon('info')}<span>WorkSphare does not send invoices. Print or save as PDF (choose “Save as PDF” in the print window), then send it yourself.${hasProfile ? '' : ' Add your business details in <a href="#/settings">Settings</a> so they appear at the top.'}</span></p>
      <div class="report-frame"><article class="invoice" aria-label="Invoice ${esc(inv.number)}">
        <header class="inv-head"><div><h2>${esc(s.businessName || 'Your business')}</h2><p class="small">${esc(s.email)}${s.email && s.phone ? ' · ' : ''}${esc(s.phone)}</p></div>
          <div class="inv-title"><p class="inv-word">${inv.status === 'Draft' ? 'DRAFT INVOICE' : inv.status === 'Cancelled' ? 'CANCELLED INVOICE' : 'INVOICE'}</p><p><strong>${esc(inv.number)}</strong></p><p class="no-print">${invoiceStatusBadge(v)}</p></div></header>
        <div class="inv-meta">
          <div><h3>Bill to</h3><p><strong>${esc(c ? c.name : 'Client removed')}</strong>${c && c.company ? `<br>${esc(c.company)}` : ''}${c && c.address ? `<br><span class="pre">${esc(c.address)}</span>` : ''}${c && c.email ? `<br>${esc(c.email)}` : ''}</p></div>
          <div>${dl([['Issue date', esc(fmt.date(inv.issueDate))], ['Due date', esc(fmt.date(inv.dueDate))], ['Project', inv.projectId ? esc(D.byId(db.projects, inv.projectId)?.name || '') : '']])}</div></div>
        <table class="inv-table"><thead><tr><th scope="col">Description</th><th scope="col" class="num">Amount</th></tr></thead><tbody><tr><td><span class="pre">${esc(inv.description)}</span></td><td class="num">${esc(fmt.money(inv.amount))}</td></tr></tbody>
          <tfoot><tr><th scope="row">Invoice total</th><td class="num">${esc(fmt.money(inv.amount))}</td></tr>${v.paid > 0 ? `<tr><th scope="row">Received so far</th><td class="num">− ${esc(fmt.money(v.paid))}</td></tr>` : ''}<tr class="inv-due"><th scope="row">${inv.status === 'Draft' ? 'Amount to pay' : 'Balance due'}</th><td class="num">${esc(fmt.money(inv.status === 'Draft' ? inv.amount : v.balance))}</td></tr></tfoot></table>
        ${txns.length ? `<h3>Payments received</h3><table class="inv-table"><tbody>${txns.map((t) => `<tr><td>${esc(fmt.date(t.date))}${t.method ? ` · ${esc(t.method)}` : ''}${t.reference ? ` · ${esc(t.reference)}` : ''}</td><td class="num">${esc(fmt.money(t.amount))}</td></tr>`).join('')}</tbody></table>` : ''}
        ${inv.notes ? `<h3>Notes</h3><p class="pre">${esc(inv.notes)}</p>` : ''}
        <p class="small muted inv-foot">Prepared with WorkSphare.</p></article></div>`,
  };
}

export function render(parts) {
  const sub = parts[1];
  if (!sub) return viewOverview();
  if (sub === 'invoices') return viewInvoices();
  if (sub === 'invoice' && parts[2]) return viewInvoice(parts[2]);
  if (sub === 'transactions') return viewTransactions();
  if (sub === 'dues') return viewDues();
  return null;
}

export const lists = { invoices: invoiceListHtml, transactions: txListHtml, dues: duesListHtml };

/* --------------------------------------- handlers --------------------------------------- */

const addDaysStr = D.addDays;

async function openInvoiceDialog(inv, preset = {}) {
  const db = S.data();
  const editing = !!inv;
  const t0 = today();
  const v = inv || { number: D.nextInvoiceNumber(db), clientId: preset.client || '', projectId: preset.project || '', issueDate: t0, dueDate: addDaysStr(t0, 14), status: 'Unpaid', ...(preset.project && !preset.client ? { clientId: D.byId(db.projects, preset.project)?.clientId || '' } : {}) };
  const done = await formDialog({
    title: editing ? `Edit invoice ${inv.number}` : 'New invoice', submitLabel: editing ? 'Save changes' : 'Create invoice', bodyHtml: invoiceFields(db, v), wide: true,
    onSubmit: (raw) => {
      const r = D.validateInvoice(raw, S.data(), { id: inv ? inv.id : null });
      if (!r.ok) return { errors: r.errors };
      const s = trySave(() => {
        if (editing) { S.patch('invoices', inv.id, r.values); S.log('invoice_updated', `Invoice ${r.values.number} updated`, { invoiceId: inv.id, clientId: r.values.clientId, projectId: r.values.projectId }); return inv; }
        const n = S.add('invoices', r.values);
        S.log('invoice_created', `Invoice ${n.number} created for ${D.clientName(S.data(), n.clientId)} (${fmt.money(n.amount)})`, { invoiceId: n.id, clientId: n.clientId, projectId: n.projectId });
        return n;
      });
      return s.ok ? s.out : failForm(s);
    },
  });
  if (done) { toast(editing ? 'Invoice saved.' : 'Invoice created.'); if (location.hash === '#/payments/invoices' || location.hash.startsWith('#/payments/invoice/') || location.hash === '#/payments') refresh(); else if (!editing && location.hash.startsWith('#/payments')) refresh(); else refresh(); }
}

async function openTxnDialog(t, preset = {}) {
  const db = S.data();
  const editing = !!t;
  const v = t || { invoiceId: preset.invoice || '', clientId: preset.client || '', date: today(), amount: preset.invoice ? D.invoiceView(db, D.byId(db.invoices, preset.invoice) || { id: '', amount: 0 }, today()).balance : '' };
  const done = await formDialog({
    title: editing ? 'Edit payment' : 'Record a payment', submitLabel: editing ? 'Save changes' : 'Record payment', bodyHtml: txFields(db, v), wide: true,
    intro: 'Record money you have actually received. WorkSphare never marks an invoice as paid on its own.',
    onSubmit: async (raw) => {
      const r = D.validateTransaction(raw, S.data(), { ignoreId: t ? t.id : null });
      if (!r.ok) return { errors: r.errors };
      const dup = S.data().transactions.find((x) => x.id !== (t && t.id) && x.invoiceId === r.values.invoiceId && x.clientId === r.values.clientId && D.toCents(x.amount) === D.toCents(r.values.amount) && x.date === r.values.date && (x.reference || '') === r.values.reference);
      if (dup && !(await confirmDialog({ title: 'This looks like a repeat', message: 'You already recorded a payment with the same client, invoice, amount, date and reference. Record it again anyway?', confirmLabel: 'Record anyway' }))) return { errors: { _form: 'Not saved, because it looks like a repeat of an earlier payment.' } };
      const s = trySave(() => {
        let rec;
        if (editing) rec = S.patch('transactions', t.id, r.values); else rec = S.add('transactions', r.values);
        const inv = D.byId(S.data().invoices, r.values.invoiceId);
        S.log('payment_recorded', `${editing ? 'Payment updated' : 'Payment recorded'}: ${fmt.money(r.values.amount)} from ${D.clientName(S.data(), r.values.clientId)}${inv ? ` for ${inv.number}` : ''}`, { transactionId: rec.id, invoiceId: inv ? inv.id : '', clientId: r.values.clientId, projectId: r.values.projectId });
        return rec;
      });
      return s.ok ? s.out : failForm(s);
    },
  });
  if (done) { toast(editing ? 'Payment saved.' : 'Payment recorded. Balances are updated.'); refresh(); }
}

export const actions = {
  'inv-new': (el) => openInvoiceDialog(null, { client: el.dataset.client || '', project: el.dataset.project || '' }),
  'inv-edit': (el) => { const i = D.byId(S.data().invoices, el.dataset.id); if (i) return openInvoiceDialog(i); return null; },
  'inv-issue': (el) => {
    const i = D.byId(S.data().invoices, el.dataset.id);
    if (!i) return;
    const r = saveWithToast(() => { S.patch('invoices', i.id, { status: 'Unpaid' }); S.log('invoice_updated', `Invoice ${i.number} marked as issued`, { invoiceId: i.id, clientId: i.clientId, projectId: i.projectId }); }, 'Invoice marked as issued. Remember to send it yourself.');
    if (r.ok) refresh();
  },
  'inv-cancel': async (el) => {
    const db = S.data();
    const i = D.byId(db.invoices, el.dataset.id);
    if (!i) return;
    const paid = D.invoicePaid(db, i.id);
    if (!(await confirmDialog({ title: 'Cancel this invoice?', message: `${i.number} will be marked as cancelled and will no longer count as money owed.${paid > 0 ? ` The ${fmt.money(paid)} already received stays in your payment records.` : ''} You can reopen it later.`, confirmLabel: 'Cancel invoice', cancelLabel: 'Keep invoice', danger: true }))) return;
    const r = saveWithToast(() => { S.patch('invoices', i.id, { status: 'Cancelled' }); S.log('invoice_updated', `Invoice ${i.number} cancelled`, { invoiceId: i.id, clientId: i.clientId, projectId: i.projectId }); }, 'Invoice cancelled.');
    if (r.ok) refresh();
  },
  'inv-reopen': (el) => {
    const i = D.byId(S.data().invoices, el.dataset.id);
    if (!i) return;
    const r = saveWithToast(() => { S.patch('invoices', i.id, { status: 'Unpaid' }); S.log('invoice_updated', `Invoice ${i.number} reopened`, { invoiceId: i.id, clientId: i.clientId, projectId: i.projectId }); }, 'Invoice reopened.');
    if (r.ok) refresh();
  },
  'inv-delete': async (el) => {
    const db = S.data();
    const i = D.byId(db.invoices, el.dataset.id);
    if (!i) return;
    const n = db.transactions.filter((t) => t.invoiceId === i.id).length;
    if (n) { await confirmDialog({ title: 'This invoice has payments', message: `${i.number} has ${n} payment${n === 1 ? '' : 's'} recorded against it. To keep your records correct it cannot be deleted. You can cancel the invoice instead, or delete the payments first.`, confirmLabel: 'OK', cancelLabel: 'Close' }); return; }
    if (!(await confirmDialog({ title: 'Delete this invoice?', message: `${i.number} will be deleted for good. This cannot be undone.`, confirmLabel: 'Delete invoice', danger: true }))) return;
    const r = saveWithToast(() => { S.drop('invoices', i.id); S.log('invoice_deleted', `Invoice ${i.number} deleted`, { clientId: i.clientId }); }, 'Invoice deleted.');
    if (r.ok) { if (location.hash.startsWith('#/payments/invoice/')) go('#/payments/invoices'); else refresh(); }
  },
  'inv-markpaid': async (el) => {
    const db = S.data();
    const i = D.byId(db.invoices, el.dataset.id);
    if (!i) return;
    const v = D.invoiceView(db, i, today());
    if (!v.isOpen) return;
    if (!(await confirmDialog({ title: 'Mark this invoice as paid?', message: `This records a payment of ${fmt.money(v.balance)} dated today against ${i.number}, so the invoice shows as paid. Only do this if the money has really arrived.`, confirmLabel: 'Yes, record the payment' }))) return;
    const r = saveWithToast(() => {
      const t = S.add('transactions', { clientId: i.clientId, invoiceId: i.id, projectId: i.projectId, amount: v.balance, date: today(), method: '', reference: '', notes: 'Recorded with “Mark as paid”.' });
      S.log('payment_recorded', `Payment recorded: ${fmt.money(v.balance)} from ${D.clientName(S.data(), i.clientId)} for ${i.number} (marked as paid)`, { transactionId: t.id, invoiceId: i.id, clientId: i.clientId, projectId: i.projectId });
    }, 'Payment recorded. The invoice is now paid.');
    if (r.ok) refresh();
  },
  'inv-reminder': async (el) => {
    const db = S.data();
    const i = D.byId(db.invoices, el.dataset.id);
    if (!i) return;
    const v = D.invoiceView(db, i, today());
    if (!v.isOpen) { toast('This invoice is not waiting for payment.', { error: true }); return; }
    const body = D.buildReminder({ business: db.settings.businessName, client: D.byId(db.clients, i.clientId), invoice: i, view: v, fmtMoney: fmt.money, fmtDate: fmt.date });
    await infoDialog({
      title: `Payment reminder for ${i.number}`, wide: true, closeLabel: 'Done',
      bodyHtml: `<p class="note">${icon('info')}<span>This is a draft. WorkSphare has not sent anything. Copy it and send it yourself.</span></p><div class="field"><label for="rem-text">Message (you can edit it)</label><textarea id="rem-text" class="input" rows="12">${esc(body)}</textarea></div><button type="button" class="btn" data-action="copy-text" data-target="rem-text">${icon('copy')}Copy message</button>`,
    });
  },

  'txn-new': (el) => openTxnDialog(null, { invoice: el.dataset.invoice || '', client: el.dataset.client || '' }),
  'txn-edit': (el) => { const t = D.byId(S.data().transactions, el.dataset.id); if (t) return openTxnDialog(t); return null; },
  'txn-delete': async (el) => {
    const db = S.data();
    const t = D.byId(db.transactions, el.dataset.id);
    if (!t) return;
    const inv = D.byId(db.invoices, t.invoiceId);
    if (!(await confirmDialog({ title: 'Delete this payment?', message: `The ${fmt.money(t.amount)} payment from ${D.clientName(db, t.clientId) || 'this client'} will be removed${inv ? `, and the balance of ${inv.number} will go back up` : ''}. This cannot be undone.`, confirmLabel: 'Delete payment', danger: true }))) return;
    const r = saveWithToast(() => { S.drop('transactions', t.id); S.log('payment_deleted', `Payment of ${fmt.money(t.amount)} deleted${inv ? ` (${inv.number})` : ''}`, { invoiceId: inv ? inv.id : '', clientId: t.clientId }); }, 'Payment deleted.');
    if (r.ok) refresh();
  },

  'copy-text': async (el) => {
    const box = document.getElementById(el.dataset.target);
    if (!box) return;
    const ok = await copyToClipboard(box.value);
    toast(ok ? 'Copied. Paste it where you want to send it.' : 'Could not copy automatically. Select the text and copy it yourself.', { error: !ok });
  },
  'print-page': () => window.print(),
};

export const changes = {
  'iv-client': (el) => {
    const sel = el.closest('form')?.querySelector('select[name="projectId"]');
    if (sel) sel.innerHTML = `<option value="">No project</option>${options(projectOptions(S.data(), el.value, ''), '')}`;
  },
  'tx-client': (el) => {
    const form = el.closest('form');
    const sel = form?.querySelector('select[name="invoiceId"]');
    if (sel) sel.innerHTML = `<option value="">Not linked to an invoice</option>${options(openInvoiceOptions(S.data(), el.value), '')}`;
  },
  'tx-invoice': (el) => {
    const db = S.data();
    const i = D.byId(db.invoices, el.value);
    const form = el.closest('form');
    if (!i || !form) return;
    form.querySelector('select[name="clientId"]').value = i.clientId;
    const amt = form.querySelector('input[name="amount"]');
    if (amt && !amt.value.trim()) amt.value = String(D.invoiceView(db, i, today()).balance);
  },
};

export const forms = {};
