// ws/projects.js — Projects tab: All projects, Create project, Project board, Project details.

import {
  esc, icon, fmt, field, row2, formError, pageHead, tabsNav, sectionHead, empty, card, menu, table, badge, filterBar, listState,
  options, dl, text, clientLink, agreementLink, clientOptions, agreementOptions, progressBar,
} from './ui.js';
import * as D from '../domain.js';
import * as S from '../store.js';
import {
  toast, confirmDialog, formDialog, showFieldErrors, readForm, trySave, saveWithToast, failForm, go, refresh, today,
} from './core.js';
import {
  taskList, activityList, invoiceTable, comparisonList, changeList, dueBadge, agreementTable,
} from './parts.js';
import { quickAddClient } from './clients.js';

const TABS = [
  { key: 'all', label: 'All projects', href: '#/projects' },
  { key: 'new', label: 'Create project', href: '#/projects/new' },
  { key: 'board', label: 'Project board', href: '#/projects/board' },
  { key: 'details', label: 'Project details', href: '#/projects/details' },
];
const head = (active, title, sub, actions = '') => `${pageHead({ title, sub, actions })}${tabsNav(TABS, active, 'Projects sections')}`;

export function projectFields(db, v = {}) {
  const f = (name, label, o = {}) => field({ id: `pj-${name}`, name, label, value: v[name] ?? '', ...o });
  const agreements = agreementOptions(db, v.clientId || '');
  return `${f('name', 'Project name', { required: true, max: 140 })}
    <div class="field-group">${f('clientId', 'Client', { kind: 'select', required: true, list: clientOptions(db, v.clientId), blank: 'Choose a client…', extra: 'data-role="pj-client"' })}
      <button type="button" class="btn btn-sm" data-action="quick-client">${icon('plus')}Add a new client</button></div>
    ${f('description', 'Description', { kind: 'textarea', rows: 3, max: 5000 })}
    ${row2(f('startDate', 'Start date', { kind: 'date' }), f('dueDate', 'Due date', { kind: 'date' }))}
    ${row2(f('value', 'Project price / value', { kind: 'money', value: v.value === '' ? '' : v.value ?? '', hint: `In ${db.settings.currency}. The total price you agreed.` }), f('progress', 'Progress (%)', { kind: 'number', value: v.progress ?? 0, hint: 'A whole number from 0 to 100.' }))}
    ${row2(f('status', 'Status', { kind: 'select', list: D.PROJECT_STATUSES, value: v.status || 'Not Started' }), f('agreementId', 'Linked agreement', { kind: 'select', list: agreements, blank: agreements.length ? 'No agreement' : 'No agreements for this client yet', value: v.agreementId }))}
    ${f('notes', 'Notes', { kind: 'textarea', rows: 3, max: 5000 })}`;
}

/* --------------------------------------- shared --------------------------------------- */

/** Changes a project's status. Moving to Completed also sets progress to 100 and says so. */
export function setStatus(id, status) {
  const db = S.data();
  const p = D.byId(db.projects, id);
  if (!p || !D.PROJECT_STATUSES.includes(status) || p.status === status) return { ok: true, same: true };
  const setsProgress = status === 'Completed' && p.progress < 100;
  const r = saveWithToast(() => {
    S.patch('projects', id, { status, ...(setsProgress ? { progress: 100 } : {}) });
    S.log('project_status', `Project “${p.name}” moved from ${p.status} to ${status}${setsProgress ? ' (progress set to 100%)' : ''}`, { projectId: id, clientId: p.clientId });
  }, `Moved to ${status}.${setsProgress ? ' Progress set to 100%.' : ''}`);
  return r;
}

const SORTS = { 'due-asc': 'Due date (soonest first)', 'due-desc': 'Due date (latest first)', client: 'Client (A to Z)', status: 'Status', newest: 'Newest first' };
const STATUS_ORDER = Object.fromEntries(D.PROJECT_STATUSES.map((s, i) => [s, i]));

function filtered(db, st) {
  return db.projects.filter((p) => {
    if (st.status === 'open' && p.archived) return false;
    if (st.status === 'archived' && !p.archived) return false;
    if (!['open', 'all', 'archived'].includes(st.status) && (p.status !== st.status || p.archived)) return false;
    if (st.client !== 'all' && p.clientId !== st.client) return false;
    return D.searchMatch([p.name, p.description, D.clientName(db, p.clientId)], st.q);
  }).sort({
    'due-asc': (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'),
    'due-desc': (a, b) => (b.dueDate || '').localeCompare(a.dueDate || ''),
    client: (a, b) => D.compareText(D.clientName(db, a.clientId), D.clientName(db, b.clientId)),
    status: (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
    newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
  }[st.sort] || (() => 0));
}

const defaults = { q: '', status: 'open', client: 'all', sort: 'due-asc' };

function listHtml() {
  const db = S.data();
  const st = listState('projects', defaults);
  const rows = filtered(db, st);
  if (!db.projects.length) return empty({ title: 'No projects yet', text: 'A project is the work you deliver to a client. Create one and link it to a client.', action: '<a class="btn btn-primary" href="#/projects/new">Create a project</a>' });
  return table({
    list: 'projects', rows, caption: 'Projects', empty: empty({ title: 'No projects match', text: 'Try a different search or filter.' }),
    cols: [
      { label: 'Project', cell: (p) => `<a href="#/projects/details/${esc(p.id)}"><strong>${esc(p.name)}</strong></a>${p.demo ? ' ' + badge('Demo', 'muted') : ''}${p.archived ? ' ' + badge('Archived') : ''}` },
      { label: 'Client', cell: (p) => clientLink(db, p.clientId) },
      { label: 'Start', cell: (p) => (p.startDate ? esc(fmt.date(p.startDate)) : '<span class="muted">—</span>') },
      { label: 'Due', cell: (p) => dueBadge(p.dueDate, p.status === 'Completed' || p.status === 'Cancelled') },
      { label: 'Value', cls: 'num', cell: (p) => (p.value === '' ? '<span class="muted">—</span>' : esc(fmt.money(p.value))) },
      { label: 'Progress', cell: (p) => progressBar(p.progress) },
      { label: 'Status', cell: (p) => badge(p.status) },
      { label: 'Actions', cls: 'actions', cell: (p) => `<div class="row-actions"><a class="btn btn-sm" href="#/projects/details/${esc(p.id)}">Open</a><button type="button" class="btn btn-sm" data-action="proj-edit" data-id="${esc(p.id)}">Edit</button>${menu([
        { action: p.archived ? 'proj-unarchive' : 'proj-archive', id: p.id, label: p.archived ? 'Unarchive' : 'Archive', icon: 'archive' },
        { action: 'proj-delete', id: p.id, label: 'Delete…', icon: 'trash', danger: true },
      ], `More actions for ${p.name}`)}</div>` },
    ],
  });
}

function viewAll() {
  const db = S.data();
  const st = listState('projects', defaults);
  const statusOpts = [{ value: 'open', label: 'All except archived' }, { value: 'all', label: 'Everything' }, ...D.PROJECT_STATUSES.map((s) => ({ value: s, label: s })), { value: 'archived', label: 'Archived' }];
  const clientOpts = [{ value: 'all', label: 'All clients' }, ...clientOptions(db)];
  return {
    title: 'Projects', nav: 'projects',
    html: `${head('all', 'Projects', 'The work you deliver to each client.', `<a class="btn btn-primary" href="#/projects/new">${icon('plus')}Create project</a>`)}
      ${db.projects.length ? filterBar('projects', st, { placeholder: 'Search projects or clients', selects: [{ key: 'status', label: 'Show', options: statusOpts }, { key: 'client', label: 'Client', options: clientOpts }, { key: 'sort', label: 'Sort by', options: Object.entries(SORTS).map(([value, label]) => ({ value, label })) }] }) : ''}
      <div id="list-projects" aria-live="polite">${listHtml()}</div>`,
  };
}

function viewNew(query) {
  const db = S.data();
  if (!db.clients.length) {
    return { title: 'Create project', nav: 'projects', html: `${head('new', 'Create a project', 'A project always belongs to a client.')}${empty({ title: 'Add a client first', text: 'Every project is linked to a client. You can add one now and come straight back.', action: '<button type="button" class="btn btn-primary" data-action="quick-client-then-project">Add a client</button>' })}` };
  }
  const v = { clientId: D.byId(db.clients, query.client) ? query.client : '', startDate: today(), status: 'Not Started', progress: 0 };
  return {
    title: 'Create project', nav: 'projects',
    html: `${head('new', 'Create a project', 'Name it, link it to a client, and add dates and a price if you know them.')}
      <form class="form card" data-form="proj-add" novalidate>${formError()}${projectFields(db, v)}
        <div class="form-actions"><a class="btn" href="#/projects">Cancel</a><button class="btn btn-primary" type="submit">Create project</button></div></form>`,
  };
}

function boardHtml() {
  const db = S.data();
  const st = listState('board', { client: 'all' });
  const projects = db.projects.filter((p) => !p.archived && (st.client === 'all' || p.clientId === st.client));
  if (!db.projects.length) return empty({ title: 'No projects to show', text: 'Create a project and it will appear on the board.', action: '<a class="btn btn-primary" href="#/projects/new">Create a project</a>' });
  return `<div class="board" role="list">${D.PROJECT_STATUSES.map((s) => {
    const items = projects.filter((p) => p.status === s).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
    return `<section class="board-col" role="listitem" data-drop="${esc(s)}" data-drop-kind="board" aria-label="${esc(s)}"><h3>${esc(s)} <span class="count">${items.length}</span></h3>
      ${items.map((p) => `<article class="board-card" draggable="true" data-drag="${esc(p.id)}"><a href="#/projects/details/${esc(p.id)}"><strong>${esc(p.name)}</strong></a>
        <span class="small muted">${esc(D.clientName(db, p.clientId))}</span>
        <span class="small">${dueBadge(p.dueDate, s === 'Completed' || s === 'Cancelled')}</span>
        ${p.value !== '' ? `<span class="small">${esc(fmt.money(p.value))}</span>` : ''}
        ${progressBar(p.progress)}
        <label class="small" for="mv-${esc(p.id)}">Move to</label><select id="mv-${esc(p.id)}" class="input input-sm" data-role="proj-move" data-id="${esc(p.id)}">${options(D.PROJECT_STATUSES, p.status)}</select></article>`).join('') || '<p class="small muted board-empty">Nothing here. Drag a project here, or use “Move to” on a card.</p>'}</section>`;
  }).join('')}</div>`;
}

function viewBoard() {
  const db = S.data();
  const st = listState('board', { client: 'all' });
  return {
    title: 'Project board', nav: 'projects',
    html: `${head('board', 'Project board', 'See every project by status. Drag a card to another column, or use “Move to” on the card.')}
      ${db.projects.length ? filterBar('board', st, { placeholder: 'Search is not needed here', selects: [{ key: 'client', label: 'Client', options: [{ value: 'all', label: 'All clients' }, ...clientOptions(db)] }] }).replace(/<div class="search">.*?<\/div>/s, '') : ''}
      <div id="list-board" aria-live="polite">${boardHtml()}</div>`,
  };
}

function viewPicker() {
  const db = S.data();
  if (!db.projects.length) return { title: 'Project details', nav: 'projects', html: `${head('details', 'Project details', 'Open a project to see everything linked to it.')}${empty({ title: 'No projects yet', text: 'Create a project first.', action: '<a class="btn btn-primary" href="#/projects/new">Create a project</a>' })}` };
  return {
    title: 'Project details', nav: 'projects',
    html: `${head('details', 'Project details', 'Choose a project to see its tasks, payments, dates, activity and scope checks.')}
      <ul class="project-list">${[...db.projects].sort((a, b) => D.compareText(a.name, b.name)).map((p) => `<li class="project-row"><a class="project-link" href="#/projects/details/${esc(p.id)}"><span class="project-name">${esc(p.name)}</span><span class="project-meta">${esc(D.clientName(db, p.clientId))} · ${esc(p.status)}${p.archived ? ' · Archived' : ''}</span></a></li>`).join('')}</ul>`,
  };
}

function viewDetails(id) {
  const db = S.data();
  const p = D.byId(db.projects, id);
  if (!p) return { title: 'Project not found', nav: 'projects', html: `${head('details', 'Project details', '')}${empty({ title: 'This project is not here', text: 'It may have been deleted.', action: '<a class="btn" href="#/projects/details">Choose another project</a>' })}` };
  const t0 = today();
  const money = D.projectMoney(db, id, t0);
  const agreement = D.byId(db.agreements, p.agreementId);
  const tasks = db.tasks.filter((t) => t.projectId === id).sort((a, b) => (a.status === 'Done') - (b.status === 'Done') || (a.dueDate || '9').localeCompare(b.dueDate || '9'));
  const invoices = db.invoices.filter((i) => i.projectId === id);
  const acts = db.activity.filter((a) => a.refs && a.refs.projectId === id).sort((a, b) => b.at.localeCompare(a.at));
  const days = p.dueDate ? D.daysBetween(t0, p.dueDate) : null;
  const done = p.status === 'Completed' || p.status === 'Cancelled';
  return {
    title: p.name, nav: 'projects',
    html: `${head('details', p.name, `${D.clientName(db, p.clientId) || 'Client removed'}${p.archived ? ' · Archived' : ''}`, `<button type="button" class="btn" data-action="proj-edit" data-id="${esc(id)}">${icon('edit')}Edit</button><a class="btn" href="#/projects/details">${icon('chevron-left')}All projects</a>`)}
      ${card(`<div class="card-head"><h2>Overview</h2>${badge(p.status)}</div>
        ${dl([['Client', clientLink(db, p.clientId)], ['Description', text(p.description)], ['Project value', p.value === '' ? '' : esc(fmt.money(p.value))], ['Progress', progressBar(p.progress)]])}
        <div class="field" style="max-width:320px"><label for="det-status">Change status</label><select id="det-status" class="input" data-role="proj-move" data-id="${esc(id)}">${options(D.PROJECT_STATUSES, p.status)}</select></div>`)}
      <div class="grid-2">
        ${card(`<h2>Important dates</h2>${dl([['Start date', p.startDate ? esc(fmt.date(p.startDate)) : ''], ['Due date', p.dueDate ? `${esc(fmt.date(p.dueDate))}${!done && days !== null ? ` <span class="small muted">(${days < 0 ? `${-days} day${days === -1 ? '' : 's'} late` : days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`})</span>` : ''}` : ''], ['Agreement ends', agreement && agreement.endDate ? esc(fmt.date(agreement.endDate)) : ''], ['Added to ScopeLens', esc(fmt.date(p.createdAt))]])}`)}
        ${card(`<h2>Linked agreement</h2>${agreement ? `<p>${agreementLink(db, agreement.id)} ${badge(D.agreementView(agreement, t0, db.settings.expiryWarnDays).status)}</p><p class="small muted">${agreement.startDate ? esc(fmt.date(agreement.startDate)) : '—'} to ${agreement.endDate ? esc(fmt.date(agreement.endDate)) : '—'}</p>` : '<p class="muted">No agreement is linked yet.</p>'}<div class="card-actions"><a class="btn btn-sm" href="#/agreements/add?client=${esc(p.clientId)}&project=${esc(id)}">${icon('plus')}Add agreement</a></div>`)}
      </div>
      ${card(`${sectionHead('Tasks', '', `<button type="button" class="btn btn-sm" data-action="task-new" data-client="${esc(p.clientId)}" data-project="${esc(id)}">${icon('plus')}Add task</button>`)}${taskList(db, tasks, { links: false })}`)}
      ${card(`${sectionHead('Payment summary', 'Figures come from invoices and payments linked to this project.', `<button type="button" class="btn btn-sm" data-action="inv-new" data-client="${esc(p.clientId)}" data-project="${esc(id)}">${icon('plus')}New invoice</button>`)}
        <div class="summary summary-3"><div class="stat"><span class="stat-n">${esc(fmt.money(money.invoiced))}</span><span class="stat-l">Invoiced (issued)</span></div><div class="stat"><span class="stat-n">${esc(fmt.money(money.received))}</span><span class="stat-l">Money received</span></div><div class="stat"><span class="stat-n">${esc(fmt.money(money.outstanding))}</span><span class="stat-l">Still owed</span></div></div>
        ${invoiceTable(db, invoices, { client: false })}`)}
      ${card(`${sectionHead('Scope comparison history', '', `<button type="button" class="btn btn-sm" data-action="ai-start" data-client="${esc(p.clientId)}" data-project="${esc(id)}" data-agreement="${esc(p.agreementId || '')}">${icon('spark')}Compare a request</button>`)}${comparisonList(db, db.comparisons.filter((c) => c.projectId === id))}<h3>Scope changes</h3>${changeList(db, db.scopeChanges.filter((c) => c.projectId === id))}`)}
      ${card(`${sectionHead('Activity history')}${activityList(db, acts, { limit: 20 })}`)}
      ${card(`${sectionHead('Notes')}${p.notes ? text(p.notes) : '<p class="muted">No notes yet.</p>'}`)}`,
  };
}

export function render(parts, query) {
  const sub = parts[1];
  if (!sub) return viewAll();
  if (sub === 'new') return viewNew(query);
  if (sub === 'board') return viewBoard();
  if (sub === 'details') return parts[2] ? viewDetails(parts[2]) : viewPicker();
  return null;
}

export const lists = { projects: listHtml, board: boardHtml };

/* -------------------------------------- handlers -------------------------------------- */

function unlinkProject(id) {
  const db = S.data();
  for (const c of ['invoices', 'tasks', 'agreements', 'transactions', 'comparisons', 'scopeChanges']) for (const r of db[c]) if (r.projectId === id) r.projectId = '';
}

export const actions = {
  'quick-client': async (el) => {
    const c = await quickAddClient();
    if (!c) return;
    const form = el.closest('form');
    const sel = form && form.querySelector('select[name="clientId"]');
    if (!sel) { refresh(); return; }
    sel.insertAdjacentHTML('beforeend', `<option value="${esc(c.id)}">${esc(c.company ? `${c.name} — ${c.company}` : c.name)}</option>`);
    sel.value = c.id;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    sel.focus();
  },
  'quick-client-then-project': async () => {
    const c = await quickAddClient();
    if (c) go(`#/projects/new?client=${c.id}`);
  },

  'proj-edit': async (el) => {
    const db = S.data();
    const p = D.byId(db.projects, el.dataset.id);
    if (!p) return;
    const done = await formDialog({
      title: 'Edit project', submitLabel: 'Save changes', bodyHtml: projectFields(db, p), wide: true,
      onSubmit: (raw) => {
        const r = D.validateProject(raw, S.data());
        if (!r.ok) return { errors: r.errors };
        const s = trySave(() => {
          S.patch('projects', p.id, r.values);
          S.log(r.values.status !== p.status ? 'project_status' : 'project_updated', r.values.status !== p.status ? `Project “${r.values.name}” moved from ${p.status} to ${r.values.status}` : `Project updated: ${r.values.name}`, { projectId: p.id, clientId: r.values.clientId });
        });
        return s.ok ? true : failForm(s);
      },
    });
    if (done) { toast('Project saved.'); refresh(); }
  },
  'proj-archive': async (el) => {
    const p = D.byId(S.data().projects, el.dataset.id);
    if (!p) return;
    if (!(await confirmDialog({ title: 'Archive this project?', message: `“${p.name}” will be hidden from the main lists and the board. Nothing is deleted, and you can unarchive it any time.`, confirmLabel: 'Archive' }))) return;
    const r = saveWithToast(() => { S.patch('projects', p.id, { archived: true }); S.log('project_updated', `Project archived: ${p.name}`, { projectId: p.id, clientId: p.clientId }); }, 'Project archived.');
    if (r.ok) refresh();
  },
  'proj-unarchive': (el) => {
    const p = D.byId(S.data().projects, el.dataset.id);
    if (!p) return;
    const r = saveWithToast(() => { S.patch('projects', p.id, { archived: false }); S.log('project_updated', `Project unarchived: ${p.name}`, { projectId: p.id, clientId: p.clientId }); }, 'Project restored.');
    if (r.ok) refresh();
  },
  'proj-delete': async (el) => {
    const db = S.data();
    const p = D.byId(db.projects, el.dataset.id);
    if (!p) return;
    const links = ['invoices', 'tasks', 'agreements', 'transactions', 'comparisons', 'scopeChanges'].reduce((n, c) => n + db[c].filter((r) => r.projectId === p.id).length, 0);
    if (!(await confirmDialog({ title: 'Delete this project?', message: `“${p.name}” will be deleted for good.${links ? ` ${links} linked record${links === 1 ? '' : 's'} (invoices, tasks, agreements, payments or saved checks) will be kept, but no longer linked to a project.` : ''} This cannot be undone.`, confirmLabel: 'Delete project', danger: true }))) return;
    const r = saveWithToast(() => { unlinkProject(p.id); S.drop('projects', p.id); S.log('project_deleted', `Project deleted: ${p.name}`, { clientId: p.clientId }); }, 'Project deleted.');
    if (r.ok) { if (location.hash.startsWith('#/projects/details/')) go('#/projects'); else refresh(); }
  },
};

export const changes = {
  'pj-client': (el) => {
    const form = el.closest('form');
    const sel = form && form.querySelector('select[name="agreementId"]');
    if (!sel) return;
    const list = agreementOptions(S.data(), el.value);
    sel.innerHTML = `<option value="">${list.length ? 'No agreement' : 'No agreements for this client yet'}</option>${options(list, '')}`;
  },
  'proj-move': (el) => { const r = setStatus(el.dataset.id, el.value); if (!r.same) refresh(); },
};

export const drops = { board: (id, status) => { const r = setStatus(id, status); if (!r.same) refresh(); } };

export const forms = {
  'proj-add': async (form) => {
    const r = D.validateProject(readForm(form), S.data());
    if (!r.ok) { showFieldErrors(form, r.errors); return; }
    const saved = trySave(() => {
      const p = S.add('projects', { ...r.values, archived: false });
      S.log('project_created', `Project created: ${p.name}`, { projectId: p.id, clientId: p.clientId });
      return p;
    });
    if (!saved.ok) { showFieldErrors(form, { _form: saved.message }); return; }
    toast('Project created.');
    go(`#/projects/details/${saved.out.id}`);
  },
};

export { agreementTable };
