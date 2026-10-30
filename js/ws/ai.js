// ws/ai.js — WorkSphare AI tab: Compare a request, Comparison history, Scope change tracker, Classic projects.
//
// The check runs locally with word-matching rules (see ../ai.js). It is not a live AI model, and every screen says so.

import {
  esc, icon, fmt, field, row2, formError, pageHead, tabsNav, sectionHead, empty, card, menu, table, badge, filterBar, listState,
  options, dl, text, clientLink, projectLink, agreementLink, clientOptions, projectOptions, agreementOptions,
} from './ui.js';
import * as D from '../domain.js';
import * as S from '../store.js';
import * as Engine from '../ai.js';
import { truncate, copyToClipboard } from '../utils.js';
import {
  toast, confirmDialog, formDialog, showFieldErrors, readForm, trySave, saveWithToast, failForm, go, refresh, today,
} from './core.js';

const TABS = [
  { key: 'compare', label: 'Compare a request', href: '#/ai' },
  { key: 'history', label: 'Comparison history', href: '#/ai/history' },
  { key: 'changes', label: 'Scope change tracker', href: '#/ai/changes' },
  { key: 'classic', label: 'Classic projects', href: '#/ai/classic' },
];
export const aiTabs = (active) => `<div class="page-head"><div class="page-head-row"><div class="page-head-text"><h1>WorkSphare AI</h1><p class="sub">Check a client request against what you agreed. Rule-based and local. Not a live AI model.</p></div></div></div>${tabsNav(TABS, active, 'WorkSphare AI sections')}`;
const head = (active, extra = '') => `${aiTabs(active)}${extra}`;
const engineNote = `<p class="note">${icon('info')}<span>${esc(Engine.ENGINE_NOTE)}</span></p>`;

/* ------------------------------------- draft (sessionStorage) ------------------------------------- */

const DRAFT0 = { clientId: '', agreementId: '', manualTitle: '', manualText: '', requestText: '', context: '', constraints: '', projectId: '' };
const getDraft = () => ({ ...DRAFT0, ...(S.session.get('ai-draft', {}) || {}) });
const setDraft = (patch) => S.session.set('ai-draft', { ...getDraft(), ...patch });

const agreementHasText = (a) => !!(a.scope.trim() || a.deliverables.trim() || a.exclusions.trim());

function agreementSelect(db, clientId, selected) {
  const list = db.agreements.filter((a) => a.clientId === clientId && a.status !== 'Archived');
  const opts = list.map((a) => ({ value: a.id, label: agreementHasText(a) ? a.title : `${a.title} (no text saved)` }));
  opts.push({ value: 'manual', label: 'Paste an agreement instead' });
  return { list, opts };
}

/* --------------------------------------------- compare --------------------------------------------- */

function viewCompare() {
  const db = S.data();
  const d = getDraft();
  if (!db.clients.length) {
    return { title: 'Compare a request', nav: 'ai', html: `${head('compare')}${engineNote}${empty({ title: 'Add a client first', text: 'A comparison is saved against a client. Add one now, or load demo data to try the tool.', action: '<div class="card-actions"><button type="button" class="btn btn-primary" data-action="quick-client-then-ai">Add a client</button><button type="button" class="btn" data-action="ws-demo-load">Load demo data</button></div>' })}` };
  }
  const client = D.byId(db.clients, d.clientId) ? d.clientId : '';
  const { list, opts } = agreementSelect(db, client, d.agreementId);
  let agreementId = d.agreementId;
  if (agreementId !== 'manual' && !list.some((a) => a.id === agreementId)) agreementId = client && !list.length ? 'manual' : '';
  const manual = agreementId === 'manual';
  const f = (name, label, o = {}) => field({ id: `ai-${name}`, name, label, value: d[name] ?? '', extra: 'data-role="ai-field"', ...o });
  return {
    title: 'Compare a request', nav: 'ai',
    html: `${head('compare')}${engineNote}
      <form class="form card" data-form="ai-compare" novalidate>${formError()}
        <fieldset class="step"><legend><span class="step-no">1</span>Choose the client</legend>
          <div class="field-group">${f('clientId', 'Client', { kind: 'select', required: true, list: clientOptions(db, client), blank: 'Choose a client…', value: client })}
          <button type="button" class="btn btn-sm" data-action="quick-client">${icon('plus')}Add a new client</button></div></fieldset>
        <fieldset class="step"><legend><span class="step-no">2</span>Choose the agreement</legend>
          ${f('agreementId', 'Agreement to check against', { kind: 'select', required: true, list: opts, blank: client ? 'Choose an agreement…' : 'Choose a client first', value: agreementId, hint: client && !list.length ? 'This client has no saved agreements. Paste the agreement text below, or add the agreement first.' : '' })}
          <div data-section="manual"${manual ? '' : ' hidden'}>${f('manualTitle', 'Name for this agreement', { max: 160, hint: 'Optional. Used in the saved comparison.' })}${f('manualText', 'Agreement text', { kind: 'textarea', rows: 8, max: 60000, hint: 'Paste what was agreed. One point per line works best.' })}</div></fieldset>
        <fieldset class="step"><legend><span class="step-no">3</span>Enter the new request</legend>
          ${f('requestText', 'What the client asked for', { kind: 'textarea', rows: 9, required: true, max: 60000, hint: 'Paste their message as they wrote it.' })}
          ${f('context', 'Context or notes', { kind: 'textarea', rows: 2, max: 5000, hint: 'Optional. For example: asked on a call, urgent. Saved with the result, not analysed.' })}
          ${f('constraints', 'Extra limits or rules to check against', { kind: 'textarea', rows: 2, max: 5000, hint: 'Optional. One per line, like “Hosting is not included” or “Maximum 3 pages”.' })}
          ${f('projectId', 'Related project', { kind: 'select', list: projectOptions(db, client, d.projectId), blank: 'No project', value: d.projectId })}</fieldset>
        <fieldset class="step"><legend><span class="step-no">4</span>Compare</legend>
          <p class="muted">The result is saved to your comparison history so you can open it again.</p>
          <div class="form-actions"><button class="btn btn-primary" type="submit">${icon('spark')}Compare request</button></div></fieldset>
      </form>`,
  };
}

/* --------------------------------------------- result --------------------------------------------- */

const SECTIONS = [
  ['covered', 'Appears covered by the agreement', 'These parts look very close to something already agreed. Read the wording to be sure.'],
  ['possible', 'Possible change to agreed work', 'These parts relate to agreed work, but may change it, or may already be included.'],
  ['outside', 'May be outside the agreed scope', 'Nothing in the agreement seems to cover these parts.'],
  ['unclear', 'Unclear: needs clarification', 'These parts are too vague to judge. Ask the client what they mean.'],
];
const SURE = { high: 'High', medium: 'Medium', low: 'Low' };

function itemHtml(i) {
  return `<li class="ai-item"><p class="ai-req"><span class="label-inline">Client asked:</span> ${esc(i.request)}</p>
    <p><span class="label-inline">Why:</span> ${esc(i.reason)}</p>
    ${i.agreement ? `<p class="quote"><span class="label-inline">Closest agreement wording:</span> “${esc(truncate(i.agreement, 400))}”</p>` : '<p class="muted small">No matching wording found in the agreement.</p>'}
    ${i.exclusion ? `<p class="quote"><span class="label-inline">The agreement may say this is not included:</span> “${esc(truncate(i.exclusion, 400))}”</p>` : ''}
    ${i.flags.length ? `<ul class="flag-list">${i.flags.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <p class="small muted">How sure the word matching is: ${SURE[i.confidence] || 'Low'}. A person should decide.</p></li>`;
}

function viewResult(id) {
  const db = S.data();
  const c = D.byId(db.comparisons, id);
  if (!c) return { title: 'Comparison not found', nav: 'ai', html: `${head('history')}${empty({ title: 'This comparison is not here', text: 'It may have been deleted.', action: '<a class="btn" href="#/ai/history">Back to history</a>' })}` };
  const r = c.result;
  const agreementNow = D.byId(db.agreements, c.agreementId);
  return {
    title: 'Comparison result', nav: 'ai',
    html: `${head('history')}${engineNote}
      <div class="head-actions"><a class="btn" href="#/ai/history">${icon('chevron-left')}All comparisons</a><a class="btn" href="#/ai">New comparison</a><button type="button" class="btn btn-danger-outline" data-action="ai-delete" data-id="${esc(id)}">${icon('trash')}Delete…</button></div>
      ${card(`<h2>Request summary</h2>${dl([['Client', c.clientId ? clientLink(db, c.clientId) : esc(c.clientName)], ['Agreement', agreementNow ? agreementLink(db, agreementNow.id) : `${esc(c.agreementTitle || 'Pasted agreement')} <span class="small muted">${c.manualAgreement ? '(pasted text)' : '(not saved any more)'}</span>`], ['Project', c.projectId ? projectLink(db, c.projectId) : esc(c.projectName)], ['Compared on', esc(fmt.dateTime(c.createdAt))]])}
        <h3>What the client asked for</h3><blockquote class="quote-block">${esc(c.requestText)}</blockquote>${c.context ? `<p><span class="label-inline">Your notes:</span> ${esc(c.context)}</p>` : ''}${c.constraints ? `<p><span class="label-inline">Extra rules used:</span> <span class="pre">${esc(c.constraints)}</span></p>` : ''}
        <p class="result-summary"><strong>Result:</strong> ${esc(r.summary)}</p>`)}
      ${SECTIONS.map(([key, title, sub]) => (r[key].length ? card(`<div class="card-head"><h2>${esc(title)}</h2><span class="count">${r[key].length}</span></div><p class="muted">${esc(sub)}</p><ul class="ai-items">${r[key].map(itemHtml).join('')}</ul>`, `ai-${key}`) : '')).join('')}
      ${r.notes.length ? card(`<h2>Other points to check</h2><ul class="plain-bullets">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`) : ''}
      ${card(`<h2>Suggested next steps</h2><ol class="plain-bullets">${r.nextSteps.map((n) => `<li>${esc(n)}</li>`).join('')}</ol>
        <div class="card-actions"><button type="button" class="btn btn-sm" data-action="ai-to-change" data-id="${esc(id)}">${icon('plus')}Add to scope change tracker</button></div>`)}
      ${card(`<h2>Draft reply to the client</h2><p class="muted">A starting point. Edit it, then copy it and send it yourself. WorkSphare does not send anything.</p>
        <div class="field"><label for="ai-response">Reply${c.responseEdited ? ' (edited by you)' : ''}</label><textarea id="ai-response" class="input" rows="14" data-role="ai-response" data-id="${esc(id)}">${esc(c.response)}</textarea></div>
        <div class="card-actions"><button type="button" class="btn btn-primary" data-action="ai-copy" data-id="${esc(id)}">${icon('copy')}Copy reply</button><button type="button" class="btn" data-action="ai-reset-response" data-id="${esc(id)}">${icon('rotate')}Start again from the generated draft</button></div>`)}`,
  };
}

/* --------------------------------------------- history --------------------------------------------- */

const H_DEFAULTS = { q: '', client: 'all', sort: 'newest' };

function historyHtml() {
  const db = S.data();
  const st = listState('ai-history', H_DEFAULTS);
  if (!db.comparisons.length) return empty({ title: 'No comparisons yet', text: 'Each comparison you run is saved here with the result and your draft reply.', action: '<a class="btn btn-primary" href="#/ai">Compare a request</a>' });
  const rows = db.comparisons.filter((c) => (st.client === 'all' || c.clientId === st.client) && D.searchMatch([c.requestText, c.clientName, c.agreementTitle, c.projectName, c.result.summary], st.q))
    .sort((a, b) => (st.sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)));
  return table({
    list: 'ai-history', rows, caption: 'Saved comparisons', empty: empty({ title: 'No comparisons match', text: 'Try a different search or filter.' }),
    cols: [
      { label: 'Date', cell: (c) => esc(fmt.date(c.createdAt)) },
      { label: 'Client', cell: (c) => (c.clientId ? clientLink(db, c.clientId) : esc(c.clientName)) },
      { label: 'Agreement', cell: (c) => (D.byId(db.agreements, c.agreementId) ? agreementLink(db, c.agreementId) : `<span class="muted">${esc(c.agreementTitle || 'Pasted agreement')}</span>`) },
      { label: 'Project', cell: (c) => (c.projectId ? projectLink(db, c.projectId) : '<span class="muted">—</span>') },
      { label: 'Request', cell: (c) => `<a href="#/ai/result/${esc(c.id)}">${esc(truncate(c.requestText, 90))}</a>${c.demo ? ' ' + badge('Demo', 'muted') : ''}` },
      { label: 'Result', cell: (c) => esc(c.result.summary) },
      { label: 'Actions', cls: 'actions', cell: (c) => `<div class="row-actions"><a class="btn btn-sm" href="#/ai/result/${esc(c.id)}">Open</a><button type="button" class="btn btn-sm" data-action="ai-copy-saved" data-id="${esc(c.id)}">Copy reply</button>${menu([{ action: 'ai-delete', id: c.id, label: 'Delete…', icon: 'trash', danger: true }], 'More actions')}</div>` },
    ],
  });
}

function viewHistory() {
  const db = S.data();
  const st = listState('ai-history', H_DEFAULTS);
  return {
    title: 'Comparison history', nav: 'ai',
    html: `${head('history')}${db.comparisons.length ? filterBar('ai-history', st, { placeholder: 'Search requests, clients or agreements', selects: [{ key: 'client', label: 'Client', options: [{ value: 'all', label: 'All clients' }, ...clientOptions(db)] }, { key: 'sort', label: 'Sort by', options: [{ value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }] }] }) : ''}
      <div id="list-ai-history" aria-live="polite">${historyHtml()}</div>`,
  };
}

/* ------------------------------------------ scope changes ------------------------------------------ */

const C_DEFAULTS = { q: '', status: 'open', client: 'all' };

function changesHtml() {
  const db = S.data();
  const st = listState('changes', C_DEFAULTS);
  if (!db.scopeChanges.length) return empty({ title: 'No scope changes recorded', text: 'Record a change a client asked for, so you can discuss it, price it and track it. Nothing changes in your agreements or projects automatically.', action: '<button type="button" class="btn btn-primary" data-action="chg-new">Record a change</button>' });
  const rows = db.scopeChanges.filter((c) => (st.status === 'open' ? c.status === 'Needs Review' || c.status === 'Discussing' : st.status === 'all' || c.status === st.status)
    && (st.client === 'all' || c.clientId === st.client) && D.searchMatch([c.title, c.description, D.clientName(db, c.clientId)], st.q))
    .sort((a, b) => b.dateRequested.localeCompare(a.dateRequested));
  return table({
    list: 'changes', rows, caption: 'Scope changes', empty: empty({ title: 'No changes match', text: 'Try a different search or filter.' }),
    cols: [
      { label: 'Change', cell: (c) => `<strong>${esc(c.title)}</strong>${c.demo ? ' ' + badge('Demo', 'muted') : ''}${c.description ? `<br><span class="small muted">${esc(truncate(c.description, 120))}</span>` : ''}<details class="mini-details"><summary>History (${c.history.length})</summary><ul class="plain-bullets small">${c.history.map((h) => `<li>${esc(fmt.date(h.at))}: ${esc(h.status)}${h.note ? ` — ${esc(h.note)}` : ''}</li>`).join('')}</ul></details>` },
      { label: 'Linked to', cell: (c) => `${c.clientId ? clientLink(db, c.clientId) : ''}${c.projectId ? `<br>${projectLink(db, c.projectId)}` : ''}${c.agreementId ? `<br>${agreementLink(db, c.agreementId)}` : ''}` },
      { label: 'Requested', cell: (c) => esc(fmt.date(c.dateRequested)) },
      { label: 'Extra price', cls: 'num', cell: (c) => (c.additionalPrice === '' ? '<span class="muted">—</span>' : esc(fmt.money(c.additionalPrice))) },
      { label: 'Status', cell: (c) => badge(c.status) },
      { label: 'Actions', cls: 'actions', cell: (c) => `<div class="row-actions"><button type="button" class="btn btn-sm" data-action="chg-status" data-id="${esc(c.id)}">Update status</button><button type="button" class="btn btn-sm" data-action="chg-edit" data-id="${esc(c.id)}">Edit</button>${menu([{ action: 'chg-delete', id: c.id, label: 'Delete…', icon: 'trash', danger: true }], `More actions for ${c.title}`)}</div>` },
    ],
  });
}

function viewChanges() {
  const db = S.data();
  const st = listState('changes', C_DEFAULTS);
  return {
    title: 'Scope change tracker', nav: 'ai',
    html: `${head('changes', `<div class="head-actions"><button type="button" class="btn btn-primary" data-action="chg-new">${icon('plus')}Record a change</button></div>`)}
      <p class="note">${icon('info')}<span>This list only records changes. WorkSphare never edits an agreement or a project price for you. Do that yourself once you and the client agree.</span></p>
      ${db.scopeChanges.length ? filterBar('changes', st, { placeholder: 'Search changes', selects: [{ key: 'status', label: 'Status', options: [{ value: 'open', label: 'Still open' }, { value: 'all', label: 'Everything' }, ...D.CHANGE_STATUSES.map((s) => ({ value: s, label: s }))] }, { key: 'client', label: 'Client', options: [{ value: 'all', label: 'All clients' }, ...clientOptions(db)] }] }) : ''}
      <div id="list-changes" aria-live="polite">${changesHtml()}</div>`,
  };
}

function changeFields(db, v = {}) {
  const f = (name, label, o = {}) => field({ id: `sc-${name}`, name, label, value: v[name] ?? '', ...o });
  return `${f('title', 'Change title', { required: true, max: 160, placeholder: 'For example: Add an online ordering form' })}
    ${f('description', 'Description', { kind: 'textarea', rows: 3, max: 5000 })}
    ${f('clientId', 'Client', { kind: 'select', list: clientOptions(db, v.clientId), blank: 'Choose a client…', extra: 'data-role="sc-client"' })}
    ${row2(f('projectId', 'Project', { kind: 'select', list: projectOptions(db, v.clientId, v.projectId), blank: 'No project' }), f('agreementId', 'Agreement', { kind: 'select', list: agreementOptions(db, v.clientId), blank: 'No agreement' }))}
    ${row2(f('dateRequested', 'Date requested', { kind: 'date', required: true, value: v.dateRequested || today() }), f('additionalPrice', 'Additional price', { kind: 'money', value: v.additionalPrice === '' ? '' : v.additionalPrice ?? '', hint: 'Optional. Not added to any invoice or project automatically.' }))}
    ${f('status', 'Status', { kind: 'select', list: D.CHANGE_STATUSES, value: v.status || 'Needs Review' })}
    ${f('notes', 'Notes', { kind: 'textarea', rows: 2, max: 5000 })}`;
}

async function openChangeDialog(c, preset = {}) {
  const db = S.data();
  const editing = !!c;
  const v = c || { status: 'Needs Review', ...preset };
  const done = await formDialog({
    title: editing ? 'Edit scope change' : 'Record a scope change', submitLabel: editing ? 'Save changes' : 'Record change', bodyHtml: changeFields(db, v), wide: true,
    onSubmit: (raw) => {
      const r = D.validateScopeChange(raw, S.data());
      if (!r.ok) return { errors: r.errors };
      const s = trySave(() => {
        if (editing) {
          const hist = r.values.status !== c.status ? [...c.history, { at: new Date().toISOString(), status: r.values.status, note: 'Changed while editing' }] : c.history;
          S.patch('scopeChanges', c.id, { ...r.values, history: hist });
          S.log(r.values.status !== c.status ? 'scope_change_status' : 'scope_change_updated', `Scope change “${r.values.title}” ${r.values.status !== c.status ? `moved to ${r.values.status}` : 'updated'}`, { changeId: c.id, clientId: r.values.clientId, projectId: r.values.projectId, agreementId: r.values.agreementId });
          return c;
        }
        const n = S.add('scopeChanges', { ...r.values, history: [{ at: new Date().toISOString(), status: r.values.status, note: 'Recorded' }] });
        S.log('scope_change_created', `Scope change recorded: ${n.title}`, { changeId: n.id, clientId: n.clientId, projectId: n.projectId, agreementId: n.agreementId });
        return n;
      });
      return s.ok ? s.out : failForm(s);
    },
  });
  return done;
}

export function render(parts) {
  const sub = parts[1];
  if (!sub) return viewCompare();
  if (sub === 'result' && parts[2]) return viewResult(parts[2]);
  if (sub === 'history') return viewHistory();
  if (sub === 'changes') return viewChanges();
  return null;
}

export const lists = { 'ai-history': historyHtml, changes: changesHtml };

/* ---------------------------------------------- handlers ---------------------------------------------- */

function readDraftFrom(form) {
  const raw = readForm(form);
  const keep = {};
  for (const k of Object.keys(DRAFT0)) if (k in raw) keep[k] = raw[k];
  return keep;
}

export const inputs = {
  'ai-field': (el) => { const form = el.closest('form'); if (form) setDraft(readDraftFrom(form)); },
};

export const changes = {
  'ai-field': (el) => {
    const form = el.closest('form');
    if (!form) return;
    const db = S.data();
    if (el.name === 'clientId') {
      const { list } = agreementSelect(db, el.value, '');
      const pick = list.find(agreementHasText) || null;
      const agSel = form.querySelector('select[name="agreementId"]');
      const { opts } = agreementSelect(db, el.value, '');
      agSel.innerHTML = `<option value="">${el.value ? 'Choose an agreement…' : 'Choose a client first'}</option>${options(opts, '')}`;
      agSel.value = pick ? pick.id : el.value && !list.length ? 'manual' : '';
      form.querySelector('select[name="projectId"]').innerHTML = `<option value="">No project</option>${options(projectOptions(db, el.value, ''), '')}`;
      const proj = pick && pick.projectId ? pick.projectId : '';
      if (proj) form.querySelector('select[name="projectId"]').value = proj;
    }
    if (el.name === 'agreementId' || el.name === 'clientId') {
      const v = form.querySelector('select[name="agreementId"]').value;
      form.querySelector('[data-section="manual"]').hidden = v !== 'manual';
      const a = D.byId(db.agreements, v);
      if (el.name === 'agreementId' && a && a.projectId) form.querySelector('select[name="projectId"]').value = a.projectId;
    }
    setDraft(readDraftFrom(form));
  },
  'ai-response': async (el) => {
    const c = D.byId(S.data().comparisons, el.dataset.id);
    if (!c || el.value === c.response) return;
    const r = saveWithToast(() => S.patch('comparisons', c.id, { response: el.value.slice(0, 20000), responseEdited: true }), 'Your edits to the reply were saved.');
    return r;
  },
  'sc-client': (el) => {
    const form = el.closest('form');
    form.querySelector('select[name="projectId"]').innerHTML = `<option value="">No project</option>${options(projectOptions(S.data(), el.value, ''), '')}`;
    form.querySelector('select[name="agreementId"]').innerHTML = `<option value="">No agreement</option>${options(agreementOptions(S.data(), el.value), '')}`;
  },
};

export const forms = {
  'ai-compare': async (form) => {
    const db = S.data();
    const raw = readForm(form);
    setDraft(readDraftFrom(form));
    const errors = {};
    const client = D.byId(db.clients, raw.clientId);
    if (!client) errors.clientId = 'Choose a client. You can add a new one first.';
    const manual = raw.agreementId === 'manual';
    const saved = manual ? null : D.byId(db.agreements, raw.agreementId);
    if (!raw.agreementId) errors.agreementId = 'Choose an agreement, or choose “Paste an agreement instead”.';
    else if (!manual && !saved) errors.agreementId = 'This agreement is not saved. Choose another.';
    else if (saved && !agreementHasText(saved)) errors.agreementId = 'This agreement has no text saved. Edit it and add the text, or paste it here instead.';
    if (manual && !String(raw.manualText || '').trim()) errors.manualText = 'Paste the agreement text.';
    if (!String(raw.requestText || '').trim()) errors.requestText = 'Paste or type what the client asked for.';
    const project = raw.projectId ? D.byId(db.projects, raw.projectId) : null;
    if (raw.projectId && !project) errors.projectId = 'This project is not saved. Choose another.';
    else if (project && client && project.clientId !== client.id) errors.projectId = 'This project belongs to a different client.';
    if (Object.keys(errors).length) { showFieldErrors(form, errors); return; }

    const agreement = manual ? { scope: raw.manualText } : saved;
    const out = Engine.analyzeRequest({ agreement, requestText: raw.requestText, constraints: raw.constraints });
    if (!out.ok) { showFieldErrors(form, { [out.field === 'agreement' ? (manual ? 'manualText' : 'agreementId') : out.field]: out.error, _form: out.error }); return; }

    const title = manual ? String(raw.manualTitle || '').trim() || 'Pasted agreement' : saved.title;
    const response = Engine.buildResponseDraft({ business: db.settings.businessName, clientName: client.name, agreementTitle: manual ? '' : title, result: out.result });
    const res = trySave(() => {
      const c = S.add('comparisons', {
        clientId: client.id, clientName: client.name, agreementId: saved ? saved.id : '', agreementTitle: title, projectId: project ? project.id : '', projectName: project ? project.name : '',
        requestText: raw.requestText.trim().slice(0, 60000), context: String(raw.context || '').trim(), constraints: String(raw.constraints || '').trim(),
        agreementText: manual ? Engine.composeAgreementText({ scope: raw.manualText }).slice(0, 60000) : '', manualAgreement: manual, engine: Engine.ENGINE_ID,
        result: out.result, response, responseEdited: false,
      });
      S.log('comparison_saved', `Scope check saved for ${client.name}: ${out.result.summary}`, { comparisonId: c.id, clientId: client.id, projectId: project ? project.id : '', agreementId: saved ? saved.id : '' });
      return c;
    });
    if (!res.ok) { showFieldErrors(form, { _form: res.message }); return; }
    setDraft({ requestText: '', context: '' });
    toast('Comparison done and saved.');
    go(`#/ai/result/${res.out.id}`);
  },
};

export const actions = {
  'ai-start': (el) => {
    const d = el.dataset;
    const db = S.data();
    const a = D.byId(db.agreements, d.agreement);
    setDraft({ ...DRAFT0, clientId: d.client || '', agreementId: a ? a.id : '', projectId: d.project || (a ? a.projectId : '') || '' });
    go('#/ai');
  },
  'quick-client-then-ai': async () => {
    const { quickAddClient } = await import('./clients.js');
    const c = await quickAddClient();
    if (c) { setDraft({ clientId: c.id }); refresh({ keep: false }); }
  },
  'ai-copy': async (el) => {
    const box = document.getElementById('ai-response');
    const c = D.byId(S.data().comparisons, el.dataset.id);
    if (!box || !c) return;
    if (box.value !== c.response) trySave(() => S.patch('comparisons', c.id, { response: box.value.slice(0, 20000), responseEdited: true }));
    const ok = await copyToClipboard(box.value);
    toast(ok ? 'Reply copied. Paste it where you want to send it.' : 'Could not copy automatically. Select the text and copy it yourself.', { error: !ok });
  },
  'ai-copy-saved': async (el) => {
    const c = D.byId(S.data().comparisons, el.dataset.id);
    if (!c) return;
    const ok = await copyToClipboard(c.response);
    toast(ok ? 'Reply copied.' : 'Could not copy automatically. Open the comparison and copy the text yourself.', { error: !ok });
  },
  'ai-reset-response': async (el) => {
    const db = S.data();
    const c = D.byId(db.comparisons, el.dataset.id);
    if (!c) return;
    if (c.responseEdited && !(await confirmDialog({ title: 'Replace your edits?', message: 'Your edited reply will be replaced with a fresh generated draft.', confirmLabel: 'Replace' }))) return;
    const response = Engine.buildResponseDraft({ business: db.settings.businessName, clientName: D.clientName(db, c.clientId) || c.clientName, agreementTitle: c.manualAgreement ? '' : c.agreementTitle, result: c.result });
    const r = saveWithToast(() => S.patch('comparisons', c.id, { response, responseEdited: false }), 'The draft was reset.');
    if (r.ok) refresh();
  },
  'ai-delete': async (el) => {
    const c = D.byId(S.data().comparisons, el.dataset.id);
    if (!c) return;
    if (!(await confirmDialog({ title: 'Delete this comparison?', message: 'The saved result and your draft reply will be deleted. This cannot be undone.', confirmLabel: 'Delete comparison', danger: true }))) return;
    const r = saveWithToast(() => { S.drop('comparisons', c.id); S.log('comparison_deleted', `A saved comparison for ${c.clientName} was deleted`, { clientId: c.clientId }); }, 'Comparison deleted.');
    if (r.ok) { if (location.hash.startsWith('#/ai/result/')) go('#/ai/history'); else refresh(); }
  },
  'ai-to-change': async (el) => {
    const db = S.data();
    const c = D.byId(db.comparisons, el.dataset.id);
    if (!c) return;
    const first = c.result.outside[0] || c.result.possible[0] || c.result.unclear[0];
    const done = await openChangeDialog(null, { title: truncate(first ? first.request : c.requestText, 90), description: truncate(c.requestText, 600), clientId: c.clientId, projectId: c.projectId, agreementId: c.agreementId, dateRequested: c.createdAt.slice(0, 10) });
    if (done) { toast('Added to the scope change tracker.'); go('#/ai/changes'); }
  },

  'chg-new': async () => { const d = await openChangeDialog(null); if (d) { toast('Scope change recorded.'); refresh(); } },
  'chg-edit': async (el) => { const c = D.byId(S.data().scopeChanges, el.dataset.id); if (!c) return; const d = await openChangeDialog(c); if (d) { toast('Scope change saved.'); refresh(); } },
  'chg-status': async (el) => {
    const c = D.byId(S.data().scopeChanges, el.dataset.id);
    if (!c) return;
    const done = await formDialog({
      title: `Update status: ${truncate(c.title, 50)}`, submitLabel: 'Update status',
      bodyHtml: `${field({ id: 'cs-status', name: 'status', label: 'New status', kind: 'select', list: D.CHANGE_STATUSES, value: c.status })}${field({ id: 'cs-note', name: 'note', label: 'Note', kind: 'textarea', rows: 2, max: 600, hint: 'Optional. For example: client agreed to ₹5,000 by email.' })}<p class="small muted">Changing the status does not change any agreement, project or price.</p>`,
      onSubmit: (raw) => {
        if (!D.CHANGE_STATUSES.includes(raw.status)) return { errors: { status: 'Choose a status.' } };
        const s = trySave(() => {
          S.patch('scopeChanges', c.id, { status: raw.status, history: [...c.history, { at: new Date().toISOString(), status: raw.status, note: String(raw.note || '').trim().slice(0, 600) }] });
          S.log('scope_change_status', `Scope change “${c.title}” moved to ${raw.status}`, { changeId: c.id, clientId: c.clientId, projectId: c.projectId, agreementId: c.agreementId });
        });
        return s.ok ? true : failForm(s);
      },
    });
    if (done) { toast('Status updated.'); refresh(); }
  },
  'chg-delete': async (el) => {
    const c = D.byId(S.data().scopeChanges, el.dataset.id);
    if (!c) return;
    if (!(await confirmDialog({ title: 'Delete this scope change?', message: `“${c.title}” and its history will be deleted. Nothing else changes.`, confirmLabel: 'Delete change', danger: true }))) return;
    const r = saveWithToast(() => { S.drop('scopeChanges', c.id); S.log('scope_change_deleted', `Scope change deleted: ${c.title}`, { clientId: c.clientId }); }, 'Scope change deleted.');
    if (r.ok) refresh();
  },
};
