// ws/clients.js — Clients tab: All clients, Add client, Client history (profile), Leads & follow-ups.

import {
  esc, icon, fmt, field, row2, formError, pageHead, tabsNav, sectionHead, empty, card, menu, table, badge,
  filterBar, listState, setListState, options, dl, text, clientLink, projectLink,
} from './ui.js';
import * as D from '../domain.js';
import * as S from '../store.js';
import { truncate } from '../utils.js';
import {
  toast, confirmDialog, formDialog, showFieldErrors, readForm, trySave, saveWithToast, failForm, go, refresh, today,
} from './core.js';
import {
  taskList, activityList, projectTable, agreementTable, invoiceTable, transactionTable, comparisonList, changeList, dueBadge,
} from './parts.js';

const TABS = [
  { key: 'all', label: 'All clients', href: '#/clients' },
  { key: 'add', label: 'Add client', href: '#/clients/add' },
  { key: 'history', label: 'Client history', href: '#/clients/history' },
  { key: 'leads', label: 'Leads & follow-ups', href: '#/clients/leads' },
];
const head = (active, title, sub, actions = '') => `${pageHead({ title, sub, actions })}${tabsNav(TABS, active, 'Clients sections')}`;

/* ------------------------------------- fields ------------------------------------- */

export function clientFields(v = {}) {
  const f = (name, label, o = {}) => field({ id: `cl-${name}`, name, label, value: v[name] ?? '', ...o });
  return `${f('name', 'Client name', { required: true, max: 140 })}
    ${row2(f('company', 'Company', { max: 140 }), f('type', 'Client type', { kind: 'select', list: D.CLIENT_TYPES, value: v.type || 'Individual' }))}
    ${row2(f('email', 'Email', { kind: 'email', max: 200 }), f('phone', 'Phone', { kind: 'tel', max: 40 }))}
    ${f('address', 'Address', { kind: 'textarea', rows: 2, max: 500 })}
    ${f('status', 'Status', { kind: 'select', list: D.CLIENT_STATUSES, value: v.status || 'Active' })}
    ${f('notes', 'General notes', { kind: 'textarea', rows: 3, max: 5000, hint: 'Anything worth remembering about this client.' })}`;
}

const leadFields = (v = {}) => {
  const f = (name, label, o = {}) => field({ id: `ld-${name}`, name, label, value: v[name] ?? '', ...o });
  return `${f('name', 'Lead name', { required: true, max: 140 })}
    ${row2(f('company', 'Company', { max: 140 }), f('source', 'Where did this lead come from?', { kind: 'select', list: D.LEAD_SOURCES, blank: 'Not sure', value: v.source }))}
    ${row2(f('email', 'Email', { kind: 'email', max: 200 }), f('phone', 'Phone', { kind: 'tel', max: 40 }))}
    ${row2(f('estimatedValue', 'Estimated deal value', { kind: 'money', hint: 'Your best guess. Not counted as money received.', value: v.estimatedValue === '' ? '' : v.estimatedValue ?? '' }), f('nextFollowUp', 'Next follow-up date', { kind: 'date' }))}
    ${f('status', 'Where is this lead?', { kind: 'select', list: D.LEAD_STATUSES, value: v.status || 'New' })}
    ${f('notes', 'Notes', { kind: 'textarea', rows: 3, max: 5000 })}`;
};

/* ----------------------------------- list helpers ----------------------------------- */

const SORTS = {
  'name-asc': 'Name (A to Z)', 'name-desc': 'Name (Z to A)', newest: 'Newest first', oldest: 'Oldest first',
  'balance-desc': 'Most owed first', 'balance-asc': 'Least owed first',
};

function clientRows(db, st) {
  const t0 = today();
  let rows = db.clients.map((c) => ({ c, money: D.clientMoney(db, c.id, t0) }));
  rows = rows.filter(({ c }) => {
    if (st.status === 'open' && c.status === 'Archived') return false;
    if (!['open', 'all'].includes(st.status) && c.status !== st.status) return false;
    return D.searchMatch([c.name, c.company, c.email, c.phone], st.q);
  });
  const by = {
    'name-asc': (a, b) => D.compareText(a.c.name, b.c.name),
    'name-desc': (a, b) => D.compareText(b.c.name, a.c.name),
    newest: (a, b) => b.c.createdAt.localeCompare(a.c.createdAt),
    oldest: (a, b) => a.c.createdAt.localeCompare(b.c.createdAt),
    'balance-desc': (a, b) => b.money.outstanding - a.money.outstanding || D.compareText(a.c.name, b.c.name),
    'balance-asc': (a, b) => a.money.outstanding - b.money.outstanding || D.compareText(a.c.name, b.c.name),
  };
  return rows.sort(by[st.sort] || by['name-asc']);
}

function clientListHtml() {
  const db = S.data();
  const st = listState('clients', { q: '', status: 'open', sort: 'name-asc' });
  const rows = clientRows(db, st);
  if (!db.clients.length) {
    return empty({ title: 'No clients yet', text: 'Add your first client to start tracking projects, agreements and payments.', action: '<a class="btn btn-primary" href="#/clients/add">Add a client</a>' });
  }
  return table({
    list: 'clients', rows, caption: 'Clients',
    empty: empty({ title: 'No clients match', text: 'Try a different search, or change the status filter.' }),
    cols: [
      { label: 'Client', cell: ({ c }) => `<a href="#/clients/history/${esc(c.id)}"><strong>${esc(c.name)}</strong></a>${c.demo ? ' ' + badge('Demo', 'muted') : ''}${c.company ? `<br><span class="small muted">${esc(c.company)}</span>` : ''}` },
      { label: 'Contact', cell: ({ c }) => `${c.email ? esc(c.email) : ''}${c.email && c.phone ? '<br>' : ''}${c.phone ? esc(c.phone) : ''}${!c.email && !c.phone ? '<span class="muted">—</span>' : ''}` },
      { label: 'Type', cell: ({ c }) => esc(c.type) },
      { label: 'Status', cell: ({ c }) => badge(c.status) },
      { label: 'Owes you', cls: 'num', cell: ({ money }) => (money.outstanding > 0 ? `<strong>${esc(fmt.money(money.outstanding))}</strong>` : '<span class="muted">Nothing</span>') },
      { label: 'Added', cell: ({ c }) => esc(fmt.date(c.createdAt)) },
      { label: 'Actions', cls: 'actions', cell: ({ c }) => `<div class="row-actions"><a class="btn btn-sm" href="#/clients/history/${esc(c.id)}">View</a><button type="button" class="btn btn-sm" data-action="client-edit" data-id="${esc(c.id)}">Edit</button>${menu([
        c.status === 'Archived' ? { action: 'client-unarchive', id: c.id, label: 'Unarchive', icon: 'archive' } : { action: 'client-archive', id: c.id, label: 'Archive', icon: 'archive' },
        { action: 'client-delete', id: c.id, label: 'Delete…', icon: 'trash', danger: true },
      ], `More actions for ${c.name}`)}</div>` },
    ],
  });
}

/* --------------------------------------- pages --------------------------------------- */

function viewAll() {
  const db = S.data();
  const st = listState('clients', { q: '', status: 'open', sort: 'name-asc' });
  const statusOpts = [['open', 'All except archived'], ['all', 'Everything'], ...D.CLIENT_STATUSES.map((s) => [s, s])].map(([value, label]) => ({ value, label }));
  const bar = filterBar('clients', { ...st }, {
    placeholder: 'Search name, company, email or phone',
    selects: [
      { key: 'status', label: 'Show', options: statusOpts },
      { key: 'sort', label: 'Sort by', options: Object.entries(SORTS).map(([value, label]) => ({ value, label })) },
    ],
  });
  return {
    title: 'Clients', nav: 'clients',
    html: `${head('all', 'Clients', 'Everyone you work with, in one place.', '<a class="btn btn-primary" href="#/clients/add">' + icon('plus') + 'Add client</a>')}${db.clients.length ? bar : ''}<div id="list-clients" aria-live="polite">${clientListHtml()}</div>`,
  };
}

function viewAdd() {
  return {
    title: 'Add client', nav: 'clients',
    html: `${head('add', 'Add a client', 'Only the name is required. You can add the rest later.')}
      <form class="form card" data-form="client-add" novalidate>${formError()}${clientFields()}
        <div class="form-actions"><a class="btn" href="#/clients">Cancel</a><button class="btn btn-primary" type="submit">Save client</button></div></form>`,
  };
}

function viewPicker() {
  const db = S.data();
  if (!db.clients.length) return { title: 'Client history', nav: 'clients', html: `${head('history', 'Client history', 'Open a client to see everything linked to them.')}${empty({ title: 'No clients yet', text: 'Add a client first. Their projects, agreements and payments will appear here.', action: '<a class="btn btn-primary" href="#/clients/add">Add a client</a>' })}` };
  const list = [...db.clients].sort((a, b) => D.compareText(a.name, b.name));
  return {
    title: 'Client history', nav: 'clients',
    html: `${head('history', 'Client history', 'Choose a client to see their projects, agreements, payments, tasks and activity.')}
      <ul class="project-list">${list.map((c) => `<li class="project-row"><a class="project-link" href="#/clients/history/${esc(c.id)}"><span class="project-name">${esc(c.name)}${c.company ? ` — ${esc(c.company)}` : ''}</span><span class="project-meta">${badge(c.status)} ${esc(c.type)}</span></a></li>`).join('')}</ul>`,
  };
}

function viewProfile(id) {
  const db = S.data();
  const c = D.byId(db.clients, id);
  if (!c) return { title: 'Client not found', nav: 'clients', html: `${head('history', 'Client history', '')}${empty({ title: 'This client is not here', text: 'They may have been deleted, or they are saved in a different browser.', action: '<a class="btn" href="#/clients/history">Choose another client</a>' })}` };
  const t0 = today();
  const projects = db.projects.filter((p) => p.clientId === id);
  const agreements = db.agreements.filter((a) => a.clientId === id);
  const invoices = db.invoices.filter((i) => i.clientId === id);
  const txns = db.transactions.filter((t) => t.clientId === id);
  const tasks = db.tasks.filter((t) => t.clientId === id).sort((a, b) => (a.status === 'Done') - (b.status === 'Done') || (a.dueDate || '9').localeCompare(b.dueDate || '9'));
  const comps = db.comparisons.filter((x) => x.clientId === id);
  const changes = db.scopeChanges.filter((x) => x.clientId === id);
  const acts = db.activity.filter((a) => a.refs && a.refs.clientId === id).sort((a, b) => b.at.localeCompare(a.at));
  const money = D.clientMoney(db, id, t0);
  const nav = ['overview', 'projects', 'agreements', 'payments', 'tasks', 'activity', 'notes'];
  const label = { overview: 'Overview', projects: 'Projects', agreements: 'Agreements', payments: 'Payments', tasks: 'Tasks', activity: 'Activity', notes: 'Notes' };
  return {
    title: c.name, nav: 'clients',
    html: `${head('history', c.name, [c.company, c.type].filter(Boolean).join(' · '), `<button type="button" class="btn" data-action="client-edit" data-id="${esc(id)}">${icon('edit')}Edit</button><a class="btn" href="#/clients/history">${icon('chevron-left')}All clients</a>`)}
      <nav class="jump" aria-label="On this page">${nav.map((n) => `<a href="#/clients/history/${esc(id)}" data-jump="client-${n}">${label[n]}</a>`).join('')}</nav>
      ${card(`<div class="card-head"><h2 id="client-overview">Overview</h2>${badge(c.status)}</div>
        ${dl([['Email', c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''], ['Phone', esc(c.phone)], ['Address', text(c.address)], ['Client type', esc(c.type)], ['Added', esc(fmt.date(c.createdAt))]])}
        <div class="summary summary-3"><div class="stat"><span class="stat-n">${esc(fmt.money(money.received))}</span><span class="stat-l">Money received</span></div>
        <div class="stat"><span class="stat-n">${esc(fmt.money(money.outstanding))}</span><span class="stat-l">Still owed</span></div>
        <div class="stat"><span class="stat-n">${projects.filter((p) => p.status === 'In Progress').length}</span><span class="stat-l">Projects in progress</span></div></div>
        <div class="card-actions"><a class="btn btn-sm" href="#/projects/new?client=${esc(id)}">${icon('plus')}New project</a>
        <button type="button" class="btn btn-sm" data-action="inv-new" data-client="${esc(id)}">${icon('plus')}New invoice</button>
        <button type="button" class="btn btn-sm" data-action="task-new" data-client="${esc(id)}">${icon('plus')}New task</button>
        <button type="button" class="btn btn-sm" data-action="ai-start" data-client="${esc(id)}">${icon('spark')}Compare a request</button></div>`)}
      ${card(`${sectionHead('Related projects')}<div id="client-projects">${projectTable(db, projects, { client: false })}</div>`)}
      ${card(`${sectionHead('Agreements', '', `<a class="btn btn-sm" href="#/agreements/add?client=${esc(id)}">${icon('plus')}Add agreement</a>`)}<div id="client-agreements">${agreementTable(db, agreements, { client: false })}</div>`)}
      ${card(`${sectionHead('Payments')}<h3>Invoices</h3>${invoiceTable(db, invoices, { client: false })}<h3>Payments received</h3>${transactionTable(db, txns, { client: false })}<span id="client-payments"></span>`)}
      ${card(`${sectionHead('Tasks and deadlines', '', `<button type="button" class="btn btn-sm" data-action="task-new" data-client="${esc(id)}">${icon('plus')}New task</button>`)}<div id="client-tasks">${taskList(db, tasks, { links: true })}</div>`)}
      ${card(`${sectionHead('Scope checks')}<h3>Saved comparisons</h3>${comparisonList(db, comps)}<h3>Scope changes</h3>${changeList(db, changes)}`)}
      ${card(`${sectionHead('Activity timeline')}<div id="client-activity">${activityList(db, acts, { limit: 20 })}</div>`)}
      ${card(`${sectionHead('Notes', '', `<button type="button" class="btn btn-sm" data-action="client-edit" data-id="${esc(id)}">${icon('edit')}Edit notes</button>`)}<div id="client-notes">${c.notes ? text(c.notes) : '<p class="muted">No notes yet.</p>'}</div>`)}`,
  };
}

/* ---------------------------------------- leads ---------------------------------------- */

function leadRows(db, st) {
  return db.leads.filter((l) => (st.status === 'open' ? l.status !== 'Won' && l.status !== 'Lost' : st.status === 'all' || l.status === st.status)
    && D.searchMatch([l.name, l.company, l.email, l.source, l.notes], st.q))
    .sort((a, b) => (a.nextFollowUp || '9999').localeCompare(b.nextFollowUp || '9999') || D.compareText(a.name, b.name));
}

function leadTableHtml() {
  const db = S.data();
  const st = listState('leads', { q: '', status: 'open' });
  const rows = leadRows(db, st);
  return table({
    list: 'leads', rows, caption: 'Leads',
    empty: empty({ title: db.leads.length ? 'No leads match' : 'No leads yet', text: db.leads.length ? 'Try a different search or filter.' : 'Add people who might hire you. When a deal is won, turn the lead into a client in one click.', action: db.leads.length ? '' : '<button type="button" class="btn btn-primary" data-action="lead-new">Add a lead</button>' }),
    cols: [
      { label: 'Lead', cell: (l) => `<strong>${esc(l.name)}</strong>${l.demo ? ' ' + badge('Demo', 'muted') : ''}${l.company ? `<br><span class="small muted">${esc(l.company)}</span>` : ''}` },
      { label: 'Source', cell: (l) => esc(l.source || '—') },
      { label: 'Estimated value', cls: 'num', cell: (l) => (l.estimatedValue === '' ? '<span class="muted">—</span>' : esc(fmt.money(l.estimatedValue))) },
      { label: 'Next follow-up', cell: (l) => (l.status === 'Won' || l.status === 'Lost' ? '<span class="muted">—</span>' : dueBadge(l.nextFollowUp)) },
      { label: 'Stage', cell: (l) => `<label class="sr-only" for="ls-${esc(l.id)}">Stage for ${esc(l.name)}</label><select id="ls-${esc(l.id)}" class="input input-sm" data-role="lead-status" data-id="${esc(l.id)}">${options(D.LEAD_STATUSES, l.status)}</select>` },
      { label: 'Actions', cls: 'actions', cell: (l) => `<div class="row-actions">${l.clientId && D.byId(db.clients, l.clientId) ? `<a class="btn btn-sm" href="#/clients/history/${esc(l.clientId)}">Open client</a>` : l.status === 'Won' ? `<button type="button" class="btn btn-sm btn-primary" data-action="lead-convert" data-id="${esc(l.id)}">Make a client</button>` : ''}<button type="button" class="btn btn-sm" data-action="lead-edit" data-id="${esc(l.id)}">Edit</button>${menu([{ action: 'lead-delete', id: l.id, label: 'Delete…', icon: 'trash', danger: true }], `More actions for ${l.name}`)}</div>` },
    ],
  });
}

function viewLeads() {
  const db = S.data();
  const t0 = today();
  const st = listState('leads', { q: '', status: 'open' });
  const open = db.leads.filter((l) => l.status !== 'Won' && l.status !== 'Lost');
  const overdue = open.filter((l) => l.nextFollowUp && l.nextFollowUp < t0).sort((a, b) => a.nextFollowUp.localeCompare(b.nextFollowUp));
  const soon = open.filter((l) => l.nextFollowUp && l.nextFollowUp >= t0 && l.nextFollowUp <= D.addDays(t0, 14)).sort((a, b) => a.nextFollowUp.localeCompare(b.nextFollowUp));
  const li = (l) => `<li><div class="list-text"><strong>${esc(l.name)}</strong><span class="small muted">${l.company ? esc(l.company) + ' · ' : ''}${esc(l.status)}</span></div><div class="row-actions">${dueBadge(l.nextFollowUp)}<button type="button" class="btn btn-sm" data-action="lead-edit" data-id="${esc(l.id)}">Update</button></div></li>`;
  const statusOpts = [{ value: 'open', label: 'Still open' }, { value: 'all', label: 'Everything' }, ...D.LEAD_STATUSES.map((s) => ({ value: s, label: s }))];
  return {
    title: 'Leads & follow-ups', nav: 'clients',
    html: `${head('leads', 'Leads & follow-ups', 'People who might hire you, before a deal is confirmed.', `<button type="button" class="btn btn-primary" data-action="lead-new">${icon('plus')}Add lead</button>`)}
      <div class="grid-2">
        ${card(`${sectionHead('Overdue follow-ups')}${overdue.length ? `<ul class="plain-list">${overdue.map(li).join('')}</ul>` : '<p class="muted">No follow-ups are overdue.</p>'}`)}
        ${card(`${sectionHead('Coming up in the next 14 days')}${soon.length ? `<ul class="plain-list">${soon.map(li).join('')}</ul>` : '<p class="muted">No follow-ups are planned for the next 14 days.</p>'}`)}
      </div>
      ${db.leads.length ? filterBar('leads', st, { placeholder: 'Search leads', selects: [{ key: 'status', label: 'Show', options: statusOpts }] }) : ''}
      <div id="list-leads" aria-live="polite">${leadTableHtml()}</div>`,
  };
}

/* --------------------------------------- render --------------------------------------- */

export function render(parts) {
  const sub = parts[1];
  if (!sub) return viewAll();
  if (sub === 'add') return viewAdd();
  if (sub === 'history') return parts[2] ? viewProfile(parts[2]) : viewPicker();
  if (sub === 'leads') return viewLeads();
  return null;
}

export const lists = { clients: clientListHtml, leads: leadTableHtml };

/* -------------------------------------- dialogs -------------------------------------- */

/** Opens the "add a client" dialog. Resolves with the new client, or null. Used by other screens for quick add. */
export async function quickAddClient() {
  const res = await formDialog({
    title: 'Add a client', submitLabel: 'Save client', bodyHtml: clientFields(), wide: true,
    onSubmit: async (raw) => {
      const db = S.data();
      const r = D.validateClient(raw, db);
      if (!r.ok) return { errors: r.errors };
      if (r.duplicateName && !(await confirmDialog({ title: 'This may be a duplicate', message: `You already have a client called “${r.duplicateName.name}”${r.duplicateName.company ? ` at ${r.duplicateName.company}` : ''}. Add another one anyway?`, confirmLabel: 'Add anyway' }))) return { errors: { _form: 'Not saved. Use the existing client, or change the details.' } };
      const saved = trySave(() => {
        const c = S.add('clients', { ...r.values, prevStatus: '' });
        S.log('client_created', `Client added: ${c.name}`, { clientId: c.id });
        return c;
      });
      return saved.ok ? saved.out : failForm(saved);
    },
  });
  if (res && res.id) toast('Client added.');
  return res && res.id ? res : null;
}

function linkedCounts(db, id) {
  const n = (c, k = 'clientId') => db[c].filter((x) => x[k] === id).length;
  return [['project', n('projects')], ['agreement', n('agreements')], ['invoice', n('invoices')], ['payment', n('transactions')], ['task', n('tasks')], ['saved comparison', n('comparisons')], ['scope change', n('scopeChanges')]]
    .filter(([, c]) => c > 0).map(([w, c]) => `${c} ${w}${c === 1 ? '' : 's'}`);
}

/* -------------------------------------- handlers -------------------------------------- */

export const actions = {
  'client-edit': async (el) => {
    const db = S.data();
    const c = D.byId(db.clients, el.dataset.id);
    if (!c) return;
    const done = await formDialog({
      title: 'Edit client', submitLabel: 'Save changes', bodyHtml: clientFields(c), wide: true,
      onSubmit: async (raw) => {
        const r = D.validateClient(raw, S.data(), { id: c.id });
        if (!r.ok) return { errors: r.errors };
        if (r.duplicateName && !(await confirmDialog({ title: 'This may be a duplicate', message: `You already have another client called “${r.duplicateName.name}”. Save anyway?`, confirmLabel: 'Save anyway' }))) return { errors: { _form: 'Not saved.' } };
        const saved = trySave(() => {
          const prev = r.values.status === 'Archived' && c.status !== 'Archived' ? c.status : c.prevStatus;
          S.patch('clients', c.id, { ...r.values, prevStatus: prev });
          S.log('client_updated', `Client updated: ${r.values.name}`, { clientId: c.id });
        });
        return saved.ok ? true : failForm(saved);
      },
    });
    if (done) { toast('Client saved.'); refresh(); }
  },

  'client-archive': async (el) => {
    const c = D.byId(S.data().clients, el.dataset.id);
    if (!c) return;
    if (!(await confirmDialog({ title: 'Archive this client?', message: `${c.name} will be hidden from the main list and from pickers. Nothing is deleted, and you can unarchive them any time.`, confirmLabel: 'Archive' }))) return;
    const r = saveWithToast(() => { S.patch('clients', c.id, { status: 'Archived', prevStatus: c.status }); S.log('client_archived', `Client archived: ${c.name}`, { clientId: c.id }); }, 'Client archived.');
    if (r.ok) refresh();
  },
  'client-unarchive': (el) => {
    const c = D.byId(S.data().clients, el.dataset.id);
    if (!c) return;
    const r = saveWithToast(() => { S.patch('clients', c.id, { status: c.prevStatus && c.prevStatus !== 'Archived' ? c.prevStatus : 'Active', prevStatus: '' }); S.log('client_updated', `Client unarchived: ${c.name}`, { clientId: c.id }); }, 'Client restored.');
    if (r.ok) refresh();
  },
  'client-delete': async (el) => {
    const db = S.data();
    const c = D.byId(db.clients, el.dataset.id);
    if (!c) return;
    const linked = linkedCounts(db, c.id);
    if (linked.length) {
      const archive = await confirmDialog({ title: 'This client has linked records', message: `${c.name} has ${linked.join(', ')}. To keep your records safe, ScopeLens will not delete a client that other records depend on. You can archive the client instead.`, confirmLabel: c.status === 'Archived' ? 'OK' : 'Archive instead', cancelLabel: 'Close' });
      if (archive && c.status !== 'Archived') { saveWithToast(() => { S.patch('clients', c.id, { status: 'Archived', prevStatus: c.status }); S.log('client_archived', `Client archived: ${c.name}`, { clientId: c.id }); }, 'Client archived.'); refresh(); }
      return;
    }
    if (!(await confirmDialog({ title: 'Delete this client?', message: `${c.name} will be deleted for good. This cannot be undone.`, confirmLabel: 'Delete client', danger: true }))) return;
    const r = saveWithToast(() => {
      S.drop('clients', c.id);
      for (const l of S.data().leads) if (l.clientId === c.id) l.clientId = '';
      S.log('client_deleted', `Client deleted: ${c.name}`, {});
    }, 'Client deleted.');
    if (r.ok) { if (location.hash.startsWith('#/clients/history/')) go('#/clients'); else refresh(); }
  },

  'lead-new': async () => {
    const done = await formDialog({
      title: 'Add a lead', submitLabel: 'Save lead', bodyHtml: leadFields(), wide: true,
      onSubmit: (raw) => {
        const r = D.validateLead(raw);
        if (!r.ok) return { errors: r.errors };
        const s = trySave(() => { const l = S.add('leads', { ...r.values, clientId: '' }); S.log('lead_created', `Lead added: ${l.name}`, { leadId: l.id }); });
        return s.ok ? true : failForm(s);
      },
    });
    if (done) { toast('Lead added.'); refresh(); }
  },
  'lead-edit': async (el) => {
    const l = D.byId(S.data().leads, el.dataset.id);
    if (!l) return;
    const done = await formDialog({
      title: 'Edit lead', submitLabel: 'Save changes', bodyHtml: leadFields(l), wide: true,
      onSubmit: (raw) => {
        const r = D.validateLead(raw);
        if (!r.ok) return { errors: r.errors };
        const s = trySave(() => { S.patch('leads', l.id, r.values); S.log('lead_updated', `Lead updated: ${r.values.name} (${r.values.status})`, { leadId: l.id }); });
        return s.ok ? true : failForm(s);
      },
    });
    if (done) { toast('Lead saved.'); refresh(); }
  },
  'lead-delete': async (el) => {
    const l = D.byId(S.data().leads, el.dataset.id);
    if (!l) return;
    if (!(await confirmDialog({ title: 'Delete this lead?', message: `${l.name} will be deleted. If you already made them a client, the client stays.`, confirmLabel: 'Delete lead', danger: true }))) return;
    const r = saveWithToast(() => { S.drop('leads', l.id); S.log('lead_deleted', `Lead deleted: ${l.name}`, {}); }, 'Lead deleted.');
    if (r.ok) refresh();
  },
  'lead-convert': async (el) => {
    const db = S.data();
    const l = D.byId(db.leads, el.dataset.id);
    if (!l) return;
    const values = {
      name: l.name, company: l.company, email: l.email, phone: l.phone, address: '', type: l.company ? 'Small business' : 'Individual', status: 'Active',
      notes: [l.notes, l.source ? `Came from: ${l.source}.` : ''].filter(Boolean).join('\n\n'),
    };
    const check = D.validateClient(values, db);
    if (check.errors.email) {
      const other = D.findDuplicateClients(db, values).byEmail;
      if (await confirmDialog({ title: 'This client may already exist', message: `${other.name} already uses the email ${l.email}. Link this lead to that client instead of creating a new one?`, confirmLabel: 'Link to existing client' })) {
        const r = saveWithToast(() => { S.patch('leads', l.id, { clientId: other.id }); S.log('lead_converted', `Lead linked to existing client: ${other.name}`, { leadId: l.id, clientId: other.id }); }, 'Lead linked to the existing client.');
        if (r.ok) refresh();
      }
      return;
    }
    if (check.duplicateName && !(await confirmDialog({ title: 'This may be a duplicate', message: `You already have a client called “${check.duplicateName.name}”. Create another one anyway?`, confirmLabel: 'Create anyway' }))) return;
    const r = saveWithToast(() => {
      const c = S.add('clients', { ...check.values, prevStatus: '' });
      S.patch('leads', l.id, { clientId: c.id });
      S.log('lead_converted', `Lead became a client: ${c.name}`, { leadId: l.id, clientId: c.id });
      return c;
    }, 'Client created from the lead.');
    if (r.ok) go(`#/clients/history/${r.out.id}`);
  },
};

export const changes = {
  'lead-status': (el) => {
    const l = D.byId(S.data().leads, el.dataset.id);
    if (!l || !D.LEAD_STATUSES.includes(el.value) || l.status === el.value) return;
    const r = saveWithToast(() => { S.patch('leads', l.id, { status: el.value }); S.log('lead_updated', `Lead ${l.name} moved to ${el.value}`, { leadId: l.id }); }, el.value === 'Won' ? 'Marked as won. You can now make them a client.' : 'Lead updated.');
    refresh();
    return r;
  },
};

export const forms = {
  'client-add': async (form) => {
    const db = S.data();
    const r = D.validateClient(readForm(form), db);
    if (!r.ok) { showFieldErrors(form, r.errors); return; }
    if (r.duplicateName && !(await confirmDialog({ title: 'This may be a duplicate', message: `You already have a client called “${r.duplicateName.name}”${r.duplicateName.company ? ` at ${r.duplicateName.company}` : ''}. Add another one anyway?`, confirmLabel: 'Add anyway' }))) return;
    const saved = trySave(() => {
      const c = S.add('clients', { ...r.values, prevStatus: '' });
      S.log('client_created', `Client added: ${c.name}`, { clientId: c.id });
      return c;
    });
    if (!saved.ok) { showFieldErrors(form, { _form: saved.message }); return; }
    toast('Client added.');
    go(`#/clients/history/${saved.out.id}`);
  },
};

export { truncate };
