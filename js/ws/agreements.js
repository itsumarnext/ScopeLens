// ws/agreements.js — Agreements tab: All agreements, Add agreement, Agreement details, Renewals & expiring.

import {
  esc, icon, fmt, field, row2, formError, pageHead, tabsNav, sectionHead, empty, card, menu, table, badge, filterBar, listState,
  options, dl, text, clientLink, projectLink, clientOptions, projectOptions,
} from './ui.js';
import * as D from '../domain.js';
import * as S from '../store.js';
import { uid, downloadBlob } from '../utils.js';
import * as Files from '../files.js';
import {
  toast, confirmDialog, formDialog, showFieldErrors, readForm, trySave, saveWithToast, failForm, go, refresh, today,
} from './core.js';
import { dueBadge, invoiceTable, comparisonList, changeList, activityList } from './parts.js';

const TABS = [
  { key: 'all', label: 'All agreements', href: '#/agreements' },
  { key: 'add', label: 'Add agreement', href: '#/agreements/add' },
  { key: 'details', label: 'Agreement details', href: '#/agreements/details' },
  { key: 'renewals', label: 'Renewals & expiring', href: '#/agreements/renewals' },
];
const head = (active, title, sub, actions = '') => `${pageHead({ title, sub, actions })}${tabsNav(TABS, active, 'Agreements sections')}`;

const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function agreementFields(db, v = {}) {
  const f = (name, label, o = {}) => field({ id: `ag-${name}`, name, label, value: v[name] ?? '', ...o });
  const manual = [{ value: 'Draft', label: 'Draft' }, { value: 'Active', label: 'Active' }, { value: 'Completed', label: 'Completed' }, { value: 'Archived', label: 'Archived' }];
  return `${f('title', 'Agreement title', { required: true, max: 160, placeholder: 'For example: Website design agreement' })}
    <div class="field-group">${f('clientId', 'Client', { kind: 'select', required: true, list: clientOptions(db, v.clientId), blank: 'Choose a client…', extra: 'data-role="ag-client"' })}
      <button type="button" class="btn btn-sm" data-action="quick-client">${icon('plus')}Add a new client</button></div>
    ${f('projectId', 'Linked project', { kind: 'select', list: projectOptions(db, v.clientId, v.projectId), blank: 'No project', value: v.projectId })}
    ${f('scope', 'Agreed scope of work', { kind: 'textarea', rows: 8, max: 60000, hint: 'Type or paste the agreement text. This is what ScopeLens compares client requests against. One point per line works best.' })}
    ${f('deliverables', 'Deliverables', { kind: 'textarea', rows: 3, max: 10000, hint: 'One item per line, like “5-page website”.' })}
    ${f('exclusions', 'Exclusions (not included)', { kind: 'textarea', rows: 3, max: 10000, hint: 'One item per line, like “online ordering”.' })}
    ${row2(f('revisions', 'Revision limit', { max: 400, placeholder: 'For example: Up to 2 rounds of revisions' }), f('status', 'Status', { kind: 'select', list: manual, value: v.status || 'Draft', hint: 'Expiring Soon and Expired are worked out from the end date.' }))}
    ${f('conditions', 'Other important conditions', { kind: 'textarea', rows: 3, max: 10000, hint: 'Payment terms, ownership, deadlines… one per line.' })}
    ${row2(f('startDate', 'Start date', { kind: 'date' }), f('endDate', 'End date', { kind: 'date' }))}
    ${f('value', 'Agreement value', { kind: 'money', value: v.value === '' ? '' : v.value ?? '', hint: `In ${db.settings.currency}.` })}
    <div class="field"><label for="ag-file">Agreement file<span class="opt"> (optional)</span></label>
      <p class="hint" id="ag-file-hint">${v.file ? `Saved file: ${esc(v.file.name)} (${fmtSize(v.file.size)}). Choose a new file to replace it.` : 'Text files (.txt, .md) are read into the box above. PDF, Word and image files are saved on this device only, up to 5 MB.'}</p>
      <input id="ag-file" name="file" class="input" type="file" accept="${Files.ACCEPTED}" data-role="ag-file" aria-describedby="ag-file-hint ag-file-note">
      <p class="hint" id="ag-file-note" aria-live="polite"></p><p class="field-error" data-error-for="file"></p>
      ${v.file ? '<label class="choice inline"><input type="checkbox" name="removeFile" value="1"><span>Remove the saved file</span></label>' : ''}</div>
    ${f('notes', 'Notes', { kind: 'textarea', rows: 3, max: 5000 })}`;
}

/* ------------------------------------------- list ------------------------------------------- */

const DEFAULTS = { q: '', status: 'open', client: 'all', sort: 'end' };
const SORTS = { end: 'End date (soonest first)', newest: 'Newest first', title: 'Title (A to Z)', value: 'Value (largest first)' };

function listHtml() {
  const db = S.data();
  const st = listState('agreements', DEFAULTS);
  const t0 = today();
  const warn = db.settings.expiryWarnDays;
  const rows = db.agreements.map((a) => ({ a, v: D.agreementView(a, t0, warn) })).filter(({ a, v }) => {
    if (st.status === 'open' ? v.status === 'Archived' : st.status !== 'all' && v.status !== st.status) return false;
    if (st.client !== 'all' && a.clientId !== st.client) return false;
    return D.searchMatch([a.title, a.scope, D.clientName(db, a.clientId)], st.q);
  }).sort({
    end: (x, y) => (x.a.endDate || '9999').localeCompare(y.a.endDate || '9999'),
    newest: (x, y) => y.a.createdAt.localeCompare(x.a.createdAt),
    title: (x, y) => D.compareText(x.a.title, y.a.title),
    value: (x, y) => (y.a.value || 0) - (x.a.value || 0),
  }[st.sort] || (() => 0));
  if (!db.agreements.length) return empty({ title: 'No agreements yet', text: 'Store what you agreed with a client. ScopeLens can then check new requests against it.', action: '<a class="btn btn-primary" href="#/agreements/add">Add an agreement</a>' });
  return table({
    list: 'agreements', rows, caption: 'Agreements', empty: empty({ title: 'No agreements match', text: 'Try a different search or filter.' }),
    cols: [
      { label: 'Agreement', cell: ({ a }) => `<a href="#/agreements/details/${esc(a.id)}"><strong>${esc(a.title)}</strong></a>${a.demo ? ' ' + badge('Demo', 'muted') : ''}${a.file ? ` <span class="small muted">${icon('file')}file</span>` : ''}` },
      { label: 'Client', cell: ({ a }) => clientLink(db, a.clientId) },
      { label: 'Project', cell: ({ a }) => projectLink(db, a.projectId) },
      { label: 'Start', cell: ({ a }) => (a.startDate ? esc(fmt.date(a.startDate)) : '<span class="muted">—</span>') },
      { label: 'End', cell: ({ a, v }) => (a.endDate ? dueBadge(a.endDate, v.status !== 'Active' && v.status !== 'Expiring Soon') : '<span class="muted">—</span>') },
      { label: 'Value', cls: 'num', cell: ({ a }) => (a.value === '' ? '<span class="muted">—</span>' : esc(fmt.money(a.value))) },
      { label: 'Status', cell: ({ v }) => `${badge(v.status)}${v.renewed ? ' ' + badge('Renewed', 'muted') : ''}` },
      { label: 'Actions', cls: 'actions', cell: ({ a }) => `<div class="row-actions"><a class="btn btn-sm" href="#/agreements/details/${esc(a.id)}">View</a><button type="button" class="btn btn-sm" data-action="agr-edit" data-id="${esc(a.id)}">Edit</button>${menu([
        a.status === 'Archived' ? { action: 'agr-unarchive', id: a.id, label: 'Unarchive', icon: 'archive' } : { action: 'agr-archive', id: a.id, label: 'Archive', icon: 'archive' },
        { action: 'agr-delete', id: a.id, label: 'Delete…', icon: 'trash', danger: true },
      ], `More actions for ${a.title}`)}</div>` },
    ],
  });
}

function viewAll() {
  const db = S.data();
  const st = listState('agreements', DEFAULTS);
  const statusOpts = [{ value: 'open', label: 'All except archived' }, { value: 'all', label: 'Everything' }, ...D.AGREEMENT_STATUSES.map((s) => ({ value: s, label: s }))];
  return {
    title: 'Agreements', nav: 'agreements',
    html: `${head('all', 'Agreements', 'Proposals, contracts and scope notes for each client.', `<a class="btn btn-primary" href="#/agreements/add">${icon('plus')}Add agreement</a>`)}
      ${db.agreements.length ? filterBar('agreements', st, { placeholder: 'Search title, text or client', selects: [{ key: 'status', label: 'Status', options: statusOpts }, { key: 'client', label: 'Client', options: [{ value: 'all', label: 'All clients' }, ...clientOptions(db)] }, { key: 'sort', label: 'Sort by', options: Object.entries(SORTS).map(([value, label]) => ({ value, label })) }] }) : ''}
      <div id="list-agreements" aria-live="polite">${listHtml()}</div>`,
  };
}

function viewAdd(query) {
  const db = S.data();
  if (!db.clients.length) return { title: 'Add agreement', nav: 'agreements', html: `${head('add', 'Add an agreement', 'An agreement always belongs to a client.')}${empty({ title: 'Add a client first', text: 'Every agreement is linked to a client. Add one now and come straight back.', action: '<a class="btn btn-primary" href="#/clients/add">Add a client</a>' })}` };
  const proj = D.byId(db.projects, query.project);
  const clientId = D.byId(db.clients, query.client) ? query.client : proj ? proj.clientId : '';
  return {
    title: 'Add agreement', nav: 'agreements',
    html: `${head('add', 'Add an agreement', 'Everything you type here is saved as you entered it. ScopeLens does not check it against any contract template.')}
      <form class="form card" data-form="agr-add" novalidate>${formError()}${agreementFields(db, { clientId, projectId: proj ? proj.id : '', status: 'Active', startDate: today() })}
        <div class="form-actions"><a class="btn" href="#/agreements">Cancel</a><button class="btn btn-primary" type="submit">Save agreement</button></div></form>`,
  };
}

function viewPicker() {
  const db = S.data();
  if (!db.agreements.length) return { title: 'Agreement details', nav: 'agreements', html: `${head('details', 'Agreement details', 'Open an agreement to read it in full.')}${empty({ title: 'No agreements yet', text: 'Add an agreement first.', action: '<a class="btn btn-primary" href="#/agreements/add">Add an agreement</a>' })}` };
  const t0 = today();
  return {
    title: 'Agreement details', nav: 'agreements',
    html: `${head('details', 'Agreement details', 'Choose an agreement to read its full text, terms, payments and scope checks.')}
      <ul class="project-list">${[...db.agreements].sort((a, b) => D.compareText(a.title, b.title)).map((a) => `<li class="project-row"><a class="project-link" href="#/agreements/details/${esc(a.id)}"><span class="project-name">${esc(a.title)}</span><span class="project-meta">${esc(D.clientName(db, a.clientId))} · ${esc(D.agreementView(a, t0, db.settings.expiryWarnDays).status)}</span></a></li>`).join('')}</ul>`,
  };
}

const lines = (s) => String(s || '').split(/\n+/).map((l) => l.replace(/^[\s\-*•]+/, '').trim()).filter(Boolean);
const bullets = (s) => (lines(s).length ? `<ul class="plain-bullets">${lines(s).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="muted">Nothing entered.</p>');

function viewDetails(id) {
  const db = S.data();
  const a = D.byId(db.agreements, id);
  if (!a) return { title: 'Agreement not found', nav: 'agreements', html: `${head('details', 'Agreement details', '')}${empty({ title: 'This agreement is not here', text: 'It may have been deleted.', action: '<a class="btn" href="#/agreements/details">Choose another agreement</a>' })}` };
  const t0 = today();
  const v = D.agreementView(a, t0, db.settings.expiryWarnDays);
  const invoices = a.projectId ? db.invoices.filter((i) => i.projectId === a.projectId) : db.invoices.filter((i) => i.clientId === a.clientId);
  const acts = db.activity.filter((x) => x.refs && x.refs.agreementId === id).sort((x, y) => y.at.localeCompare(x.at));
  const renewedTo = D.byId(db.agreements, a.renewedToId);
  const renewalOf = D.byId(db.agreements, a.renewalOfId);
  return {
    title: a.title, nav: 'agreements',
    html: `${head('details', a.title, `${D.clientName(db, a.clientId) || 'Client removed'}`, `<button type="button" class="btn" data-action="agr-edit" data-id="${esc(id)}">${icon('edit')}Edit</button><a class="btn" href="#/agreements/details">${icon('chevron-left')}All agreements</a>`)}
      <p class="note">${icon('info')}<span>Everything below was typed, pasted or read from a text file by you. ScopeLens does not read PDF or Word files and does not check this against a contract.</span></p>
      ${card(`<div class="card-head"><h2>Summary</h2><div class="chips">${badge(v.status)}${v.renewed ? badge('Renewed', 'muted') : ''}</div></div>
        ${dl([['Client', clientLink(db, a.clientId)], ['Linked project', a.projectId ? projectLink(db, a.projectId) : ''], ['Start date', a.startDate ? esc(fmt.date(a.startDate)) : ''], ['End date', a.endDate ? `${esc(fmt.date(a.endDate))}${v.daysLeft !== null && a.status === 'Active' ? ` <span class="small muted">(${v.daysLeft < 0 ? `ended ${-v.daysLeft} day${v.daysLeft === -1 ? '' : 's'} ago` : v.daysLeft === 0 ? 'today' : `in ${v.daysLeft} day${v.daysLeft === 1 ? '' : 's'}`})</span>` : ''}` : ''], ['Value', a.value === '' ? '' : esc(fmt.money(a.value))], ['Renewal', renewedTo ? `Renewed as <a href="#/agreements/details/${esc(renewedTo.id)}">${esc(renewedTo.title)}</a>` : renewalOf ? `Renewal of <a href="#/agreements/details/${esc(renewalOf.id)}">${esc(renewalOf.title)}</a>` : v.renewed ? 'Marked as renewed' : '']])}
        <div class="card-actions"><button type="button" class="btn btn-sm" data-action="agr-renew" data-id="${esc(id)}">${icon('rotate')}Create renewal</button>${v.renewed ? '' : `<button type="button" class="btn btn-sm" data-action="agr-markrenewed" data-id="${esc(id)}">Mark as renewed</button>`}<button type="button" class="btn btn-sm" data-action="ai-start" data-client="${esc(a.clientId)}" data-agreement="${esc(id)}" data-project="${esc(a.projectId || '')}">${icon('spark')}Compare a request</button>
        ${a.status === 'Archived' ? `<button type="button" class="btn btn-sm" data-action="agr-unarchive" data-id="${esc(id)}">Unarchive</button>` : `<button type="button" class="btn btn-sm" data-action="agr-archive" data-id="${esc(id)}">${icon('archive')}Archive</button>`}</div>`)}
      ${card(`${sectionHead('Agreement text', 'Entered by you.')}${a.scope ? `<pre class="scope-text">${esc(a.scope)}</pre>` : '<p class="muted">No text was entered. Edit the agreement and paste it, so requests can be compared against it.</p>'}
        ${a.file ? `<p class="small">${icon('file')} Saved file: <strong>${esc(a.file.name)}</strong> (${fmtSize(a.file.size)}). It is kept in this browser only. <button type="button" class="link-btn" data-action="agr-download" data-id="${esc(id)}">Download it</button></p>` : ''}`)}
      <div class="grid-2">
        ${card(`<h2>Deliverables</h2>${bullets(a.deliverables)}<h3>Exclusions (not included)</h3>${bullets(a.exclusions)}`)}
        ${card(`<h2>Revisions and conditions</h2>${dl([['Revision limit', esc(a.revisions)]])}<h3>Other conditions</h3>${bullets(a.conditions)}`)}
      </div>
      ${card(`${sectionHead('Related payment records', a.projectId ? 'Invoices for the linked project.' : 'No project is linked, so these are all of this client’s invoices.')}${invoiceTable(db, invoices, { client: false })}`)}
      ${card(`${sectionHead('Scope comparison history')}${comparisonList(db, db.comparisons.filter((c) => c.agreementId === id))}<h3>Scope changes</h3>${changeList(db, db.scopeChanges.filter((c) => c.agreementId === id))}`)}
      ${card(`${sectionHead('Activity')}${activityList(db, acts, { limit: 15 })}`)}
      ${card(`${sectionHead('Notes')}${a.notes ? text(a.notes) : '<p class="muted">No notes yet.</p>'}`)}`,
  };
}

function viewRenewals() {
  const db = S.data();
  const t0 = today();
  const warn = db.settings.expiryWarnDays;
  const all = db.agreements.map((a) => ({ a, v: D.agreementView(a, t0, warn) }));
  const soon = all.filter(({ v }) => v.status === 'Expiring Soon' && !v.renewed).sort((x, y) => x.a.endDate.localeCompare(y.a.endDate));
  const expired = all.filter(({ v }) => v.status === 'Expired' && !v.renewed).sort((x, y) => y.a.endDate.localeCompare(x.a.endDate));
  const renewed = all.filter(({ v }) => v.renewed).sort((x, y) => (y.a.renewedAt || '').localeCompare(x.a.renewedAt || '')).slice(0, 10);
  const row = ({ a, v }, kind) => `<li><div class="list-text"><a href="#/agreements/details/${esc(a.id)}"><strong>${esc(a.title)}</strong></a><span class="small muted">${esc(D.clientName(db, a.clientId))} · ${kind === 'renewed' ? `renewed ${esc(fmt.date(a.renewedAt))}` : `ends ${esc(fmt.date(a.endDate))} (${v.daysLeft < 0 ? `${-v.daysLeft} day${v.daysLeft === -1 ? '' : 's'} ago` : v.daysLeft === 0 ? 'today' : `in ${v.daysLeft} day${v.daysLeft === 1 ? '' : 's'}`})`}</span></div>${kind === 'renewed' ? (a.renewedToId && D.byId(db.agreements, a.renewedToId) ? `<a class="btn btn-sm" href="#/agreements/details/${esc(a.renewedToId)}">Open renewal</a>` : '') : `<div class="row-actions"><button type="button" class="btn btn-sm btn-primary" data-action="agr-renew" data-id="${esc(a.id)}">Create renewal</button><button type="button" class="btn btn-sm" data-action="agr-markrenewed" data-id="${esc(a.id)}">Mark as renewed</button></div>`}</li>`;
  return {
    title: 'Renewals & expiring', nav: 'agreements',
    html: `${head('renewals', 'Renewals & expiring agreements', 'Active agreements that are about to end, or already have.')}
      ${card(`<div class="field" style="max-width:320px"><label for="warn-days">Warn me this many days before an agreement ends</label><select id="warn-days" class="input" data-role="warn-days">${options(D.WARN_PERIODS.map((n) => ({ value: n, label: `${n} days` })), warn)}</select></div><p class="small muted">This is also your default in Settings.</p>`)}
      ${card(`${sectionHead(`Expiring within ${warn} days`)}${soon.length ? `<ul class="plain-list">${soon.map((x) => row(x)).join('')}</ul>` : '<p class="muted">No active agreements are about to end.</p>'}`)}
      ${card(`${sectionHead('Already expired')}${expired.length ? `<ul class="plain-list">${expired.map((x) => row(x)).join('')}</ul>` : '<p class="muted">No active agreements have passed their end date.</p>'}`)}
      ${card(`${sectionHead('Recently renewed')}${renewed.length ? `<ul class="plain-list">${renewed.map((x) => row(x, 'renewed')).join('')}</ul>` : '<p class="muted">Nothing has been renewed yet.</p>'}`)}
      <p class="note">${icon('info')}<span>“Create renewal” makes a new agreement from the old one. The old agreement is never changed or overwritten.</span></p>`,
  };
}

export function render(parts, query) {
  const sub = parts[1];
  if (!sub) return viewAll();
  if (sub === 'add') return viewAdd(query);
  if (sub === 'details') return parts[2] ? viewDetails(parts[2]) : viewPicker();
  if (sub === 'renewals') return viewRenewals();
  return null;
}

export const lists = { agreements: listHtml };

/* -------------------------------------- saving -------------------------------------- */

const fileInput = (root) => root.querySelector('input[type="file"][name="file"]');

/** Saves the chosen file (if any) after the record exists. Returns a warning text, or ''. */
async function storeFile(agreementId, file, previous) {
  if (!file) return '';
  const bad = Files.checkFile(file);
  if (bad) return bad;
  const fid = uid();
  try {
    await Files.saveFile(fid, file);
  } catch (e) {
    return `The agreement was saved, but the file could not be stored: ${e.message || 'the browser refused it'}.`;
  }
  const r = trySave(() => S.patch('agreements', agreementId, { file: { id: fid, name: file.name, type: file.type, size: file.size } }));
  if (!r.ok) { Files.deleteFile(fid).catch(() => {}); return r.message; }
  if (previous) Files.deleteFile(previous.id).catch(() => {});
  return '';
}

async function removeFileOf(a) {
  if (a.file) { try { await Files.deleteFile(a.file.id); } catch { /* the record is what matters */ } }
}

export const forms = {
  'agr-add': async (form) => {
    const raw = readForm(form);
    const file = fileInput(form)?.files?.[0] || null;
    const r = D.validateAgreement(raw, S.data());
    const errors = { ...r.errors };
    if (file) { const bad = Files.checkFile(file); if (bad) errors.file = bad; }
    if (Object.keys(errors).length) { showFieldErrors(form, errors); return; }
    const saved = trySave(() => {
      const a = S.add('agreements', { ...r.values, prevStatus: '', renewedAt: '', renewedToId: '', renewalOfId: '' });
      S.log('agreement_created', `Agreement added: ${a.title}`, { agreementId: a.id, clientId: a.clientId, projectId: a.projectId });
      if (a.projectId && !D.byId(S.data().projects, a.projectId).agreementId) S.patch('projects', a.projectId, { agreementId: a.id });
      return a;
    });
    if (!saved.ok) { showFieldErrors(form, { _form: saved.message }); return; }
    const warn = await storeFile(saved.out.id, file, null);
    toast(warn || 'Agreement saved.', { error: !!warn });
    go(`#/agreements/details/${saved.out.id}`);
  },
};

export const changes = {
  'ag-client': (el) => {
    const sel = el.closest('form')?.querySelector('select[name="projectId"]');
    if (sel) sel.innerHTML = `<option value="">No project</option>${options(projectOptions(S.data(), el.value, ''), '')}`;
  },
  'ag-file': async (el) => {
    const note = document.getElementById('ag-file-note');
    const form = el.closest('form');
    const file = el.files && el.files[0];
    if (!note) return;
    if (!file) { note.textContent = ''; return; }
    const bad = Files.checkFile(file);
    if (bad) { note.textContent = bad; el.value = ''; return; }
    if (Files.isTextFile(file)) {
      const box = form.querySelector('textarea[name="scope"]');
      try {
        const t = await Files.readText(file);
        if (box && !box.value.trim()) { box.value = t.slice(0, 60000); note.textContent = `Read ${t.length.toLocaleString()} letters from the file into the agreement text box. Please check it.`; }
        else note.textContent = 'The file will be saved. The agreement text box already has text, so it was left as it is.';
      } catch { note.textContent = 'The file could not be read as text. It will still be saved.'; }
    } else {
      note.textContent = 'ScopeLens cannot read the words inside this kind of file. It will be saved on this device. To compare requests against it, paste the text into the agreement text box.';
    }
  },
  'warn-days': (el) => {
    const n = Number(el.value);
    const r = saveWithToast(() => { S.data().settings.expiryWarnDays = n; }, `Warning period set to ${n} days.`);
    if (r.ok) refresh();
  },
};

function addMonths(dateStr, days) { return D.addDays(dateStr, days); }

export const actions = {
  'agr-edit': async (el) => {
    const db = S.data();
    const a = D.byId(db.agreements, el.dataset.id);
    if (!a) return;
    let fileInputEl = null;
    const done = await formDialog({
      title: 'Edit agreement', submitLabel: 'Save changes', bodyHtml: agreementFields(db, a), wide: true,
      onSubmit: async (raw) => {
        fileInputEl = fileInputEl || document.querySelector('dialog[open] input[type="file"][name="file"]');
        const file = fileInputEl?.files?.[0] || null;
        const r = D.validateAgreement(raw, S.data());
        const errors = { ...r.errors };
        if (file) { const bad = Files.checkFile(file); if (bad) errors.file = bad; }
        if (Object.keys(errors).length) return { errors };
        const removing = raw.removeFile === '1' && a.file && !file;
        const s = trySave(() => {
          const changes = { ...r.values };
          if (removing) changes.file = undefined;
          S.patch('agreements', a.id, changes);
          if (removing) delete D.byId(S.data().agreements, a.id).file;
          S.log('agreement_updated', `Agreement updated: ${r.values.title}`, { agreementId: a.id, clientId: r.values.clientId, projectId: r.values.projectId });
        });
        if (!s.ok) return failForm(s);
        if (removing) await removeFileOf(a);
        const warn = await storeFile(a.id, file, a.file);
        return { saved: true, warn };
      },
    });
    if (done) { toast(done.warn || 'Agreement saved.', { error: !!done.warn }); refresh(); }
  },
  'agr-archive': async (el) => {
    const a = D.byId(S.data().agreements, el.dataset.id);
    if (!a) return;
    if (!(await confirmDialog({ title: 'Archive this agreement?', message: `“${a.title}” will be hidden from the main list and from expiry warnings. Nothing is deleted.`, confirmLabel: 'Archive' }))) return;
    const r = saveWithToast(() => { S.patch('agreements', a.id, { status: 'Archived', prevStatus: a.status }); S.log('agreement_updated', `Agreement archived: ${a.title}`, { agreementId: a.id, clientId: a.clientId }); }, 'Agreement archived.');
    if (r.ok) refresh();
  },
  'agr-unarchive': (el) => {
    const a = D.byId(S.data().agreements, el.dataset.id);
    if (!a) return;
    const r = saveWithToast(() => { S.patch('agreements', a.id, { status: a.prevStatus && a.prevStatus !== 'Archived' ? a.prevStatus : 'Draft', prevStatus: '' }); S.log('agreement_updated', `Agreement unarchived: ${a.title}`, { agreementId: a.id, clientId: a.clientId }); }, 'Agreement restored.');
    if (r.ok) refresh();
  },
  'agr-delete': async (el) => {
    const db = S.data();
    const a = D.byId(db.agreements, el.dataset.id);
    if (!a) return;
    const n = db.projects.filter((p) => p.agreementId === a.id).length + db.comparisons.filter((c) => c.agreementId === a.id).length + db.scopeChanges.filter((c) => c.agreementId === a.id).length;
    if (!(await confirmDialog({ title: 'Delete this agreement?', message: `“${a.title}” and its saved file will be deleted for good.${n ? ` ${n} linked project${n === 1 ? '' : 's'}, saved comparison${n === 1 ? '' : 's'} or scope change${n === 1 ? '' : 's'} will be kept but no longer linked. Saved comparisons keep their own copy of the agreement text they used.` : ''} This cannot be undone.`, confirmLabel: 'Delete agreement', danger: true }))) return;
    const r = saveWithToast(() => {
      for (const p of S.data().projects) if (p.agreementId === a.id) p.agreementId = '';
      for (const c of S.data().comparisons) if (c.agreementId === a.id) c.agreementId = '';
      for (const c of S.data().scopeChanges) if (c.agreementId === a.id) c.agreementId = '';
      for (const x of S.data().agreements) { if (x.renewedToId === a.id) x.renewedToId = ''; if (x.renewalOfId === a.id) x.renewalOfId = ''; }
      S.drop('agreements', a.id);
      S.log('agreement_deleted', `Agreement deleted: ${a.title}`, { clientId: a.clientId });
    }, 'Agreement deleted.');
    if (r.ok) { await removeFileOf(a); if (location.hash.startsWith('#/agreements/details/')) go('#/agreements'); else refresh(); }
  },
  'agr-download': async (el) => {
    const a = D.byId(S.data().agreements, el.dataset.id);
    if (!a || !a.file) return;
    let rec = null;
    try { rec = await Files.getFile(a.file.id); } catch { rec = null; }
    if (!rec) { toast('The saved file is not in this browser any more. It may have been cleared with the browser data.', { error: true }); return; }
    downloadBlob(a.file.name, rec.blob);
  },
  'agr-markrenewed': async (el) => {
    const a = D.byId(S.data().agreements, el.dataset.id);
    if (!a) return;
    if (!(await confirmDialog({ title: 'Mark this agreement as renewed?', message: `“${a.title}” keeps its dates and text. It is only flagged as renewed, so it stops appearing in expiry warnings. Use “Create renewal” if you want a new agreement with new dates.`, confirmLabel: 'Mark as renewed' }))) return;
    const r = saveWithToast(() => { S.patch('agreements', a.id, { renewedAt: new Date().toISOString() }); S.log('agreement_updated', `Agreement marked as renewed: ${a.title}`, { agreementId: a.id, clientId: a.clientId }); }, 'Marked as renewed.');
    if (r.ok) refresh();
  },
  'agr-renew': async (el) => {
    const db = S.data();
    const a = D.byId(db.agreements, el.dataset.id);
    if (!a) return;
    const length = a.startDate && a.endDate ? Math.max(1, D.daysBetween(a.startDate, a.endDate)) : 365;
    const start = a.endDate ? addMonths(a.endDate, 1) : today();
    const proposal = { ...a, title: `${a.title} (renewal)`, startDate: start, endDate: addMonths(start, length), status: 'Draft', file: undefined };
    const done = await formDialog({
      title: 'Create a renewal', intro: 'This creates a new agreement. The old one is not changed. Check the dates and the text before saving.', submitLabel: 'Create renewal', bodyHtml: agreementFields(db, proposal), wide: true,
      onSubmit: (raw) => {
        const r = D.validateAgreement(raw, S.data());
        if (!r.ok) return { errors: r.errors };
        const s = trySave(() => {
          const n = S.add('agreements', { ...r.values, prevStatus: '', renewedAt: '', renewedToId: '', renewalOfId: a.id });
          S.patch('agreements', a.id, { renewedToId: n.id, renewedAt: new Date().toISOString() });
          S.log('agreement_created', `Renewal created from “${a.title}”: ${n.title}`, { agreementId: n.id, clientId: n.clientId, projectId: n.projectId });
          return n;
        });
        return s.ok ? s.out : failForm(s);
      },
    });
    if (done && done.id) { toast('Renewal created. The old agreement is unchanged.'); go(`#/agreements/details/${done.id}`); }
  },
};
