// views.js — render functions. Each returns an HTML string (all user text is escaped).

import { esc, fmtDate, fmtDateTime, truncate, formatMoney, plural, todayDate } from './utils.js';
import { icon } from './ui.js';
import {
  TYPE_LABELS, STATUS_LABELS, summarizeFindings, collapseChunks, diffText,
} from './comparison.js';
import {
  sortedRequests, CURRENCIES, SOURCE_SUGGESTIONS, projectStatusLine, comparisonSummaryText, historyLabel,
} from './projects.js';
import { effectiveMessage } from './report.js';

/* ------------------------------ form pieces ------------------------------ */

function field({ id, name, label, type = 'text', value = '', required = false, hint = '', rows = 4, options = null, datalist = null, attrs = '', optionalLabel = true }) {
  const tag = (required ? '<span class="req"> (required)</span>' : optionalLabel ? '<span class="opt"> (optional)</span>' : '');
  const describedBy = `${hint ? `${id}-hint ` : ''}${id}-error`;
  const common = `id="${id}" name="${name}" aria-describedby="${describedBy}" ${required ? 'aria-required="true"' : ''} ${attrs}`;
  let control;
  if (options) {
    control = `<select class="input" ${common}>${options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
  } else if (type === 'textarea') {
    control = `<textarea class="input" rows="${rows}" ${common}>${esc(value)}</textarea>`;
  } else {
    control = `<input class="input" type="${type}" value="${esc(value)}" ${datalist ? `list="${datalist.id}"` : ''} ${common}>`;
  }
  const dl = datalist ? `<datalist id="${datalist.id}">${datalist.items.map((i) => `<option value="${esc(i)}"></option>`).join('')}</datalist>` : '';
  return `<div class="field"><label for="${id}">${esc(label)}${tag}</label>${control}${dl}${hint ? `<p class="hint" id="${id}-hint">${esc(hint)}</p>` : ''}<p class="field-error" id="${id}-error" data-error-for="${name}"></p></div>`;
}

export function projectFields(v = {}) {
  return [
    field({ id: 'pf-name', name: 'name', label: 'Project name', required: true, value: v.name, attrs: 'maxlength="120" autocomplete="off" autofocus' }),
    field({ id: 'pf-client', name: 'client', label: 'Client name', value: v.client, attrs: 'maxlength="120" autocomplete="off"' }),
    field({ id: 'pf-description', name: 'description', label: 'Short description', type: 'textarea', rows: 3, value: v.description, attrs: 'maxlength="1000"' }),
    field({ id: 'pf-start', name: 'startDate', label: 'Project start date', type: 'date', value: v.startDate }),
    `<div class="field-row">
      ${field({ id: 'pf-budget', name: 'budget', label: 'Agreed budget', type: 'text', value: v.budget ?? '', hint: 'Numbers only, for example 45000.', attrs: 'inputmode="decimal" autocomplete="off"' })}
      ${field({ id: 'pf-currency', name: 'currency', label: 'Currency', value: v.currency || 'INR', options: CURRENCIES.map((c) => ({ value: c, label: c })), optionalLabel: false })}
    </div>`,
  ].join('');
}

export function requestFields(v = {}) {
  return [
    field({ id: 'rf-text', name: 'text', label: 'Request text', type: 'textarea', rows: 6, required: true, value: v.text, hint: 'Paste the message or type the request as it was made. Only paste information you are allowed to store.', attrs: 'maxlength="8000"' }),
    `<div class="field-row">
      ${field({ id: 'rf-date', name: 'date', label: 'Date received', type: 'date', required: true, value: v.date || todayDate(), hint: 'The date the client sent it, as you know it.' })}
      ${field({ id: 'rf-source', name: 'source', label: 'Source', value: v.source, datalist: { id: 'rf-source-list', items: SOURCE_SUGGESTIONS }, attrs: 'maxlength="80" autocomplete="off"' })}
    </div>`,
    field({ id: 'rf-reference', name: 'reference', label: 'Reference or context', value: v.reference, hint: 'For example an email subject or a meeting name.', attrs: 'maxlength="300" autocomplete="off"' }),
    field({ id: 'rf-notes', name: 'notes', label: 'Notes', type: 'textarea', rows: 3, value: v.notes, attrs: 'maxlength="3000"' }),
  ].join('');
}

/* -------------------------------- chrome -------------------------------- */

function pageHead(title, { sub = '', actions = '', back = null } = {}) {
  return `<header class="page-head">
    ${back ? `<a class="back-link" href="${esc(back.href)}">${icon('chevron-left')}${esc(back.label)}</a>` : ''}
    <div class="page-head-row"><div><h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${actions ? `<div class="head-actions">${actions}</div>` : ''}</div>
  </header>`;
}

function emptyState({ title, text, action = '' }) {
  return `<div class="empty"><div class="empty-mark">${icon('compare')}</div><h2>${esc(title)}</h2><p>${text}</p>${action}</div>`;
}

const TABS = [
  ['', 'Overview', 'folder'],
  ['scope', 'Original scope', 'file'],
  ['requests', 'Requests', 'list'],
  ['compare', 'Compare', 'compare'],
  ['history', 'History', 'clock'],
];

export function projectHeader(p, active) {
  const meta = [p.client, p.startDate ? `Started ${fmtDate(p.startDate)}` : '', p.budget !== '' && p.budget != null ? formatMoney(p.budget, p.currency) : ''].filter(Boolean);
  return `<header class="project-head">
    <a class="back-link" href="#/">${icon('chevron-left')}All projects</a>
    <div class="page-head-row">
      <div>
        <h1>${esc(p.name)} ${p.archived ? '<span class="chip">Archived</span>' : ''} ${p.isDemo ? '<span class="chip">Demo data</span>' : ''}</h1>
        ${meta.length ? `<p class="sub">${meta.map(esc).join(' · ')}</p>` : ''}
      </div>
    </div>
    <nav class="tabs" aria-label="Project sections">
      ${TABS.map(([slug, label, ic]) => `<a class="tab" href="#/p/${esc(p.id)}${slug ? '/' + slug : ''}" ${active === slug ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></a>`).join('')}
    </nav>
  </header>`;
}

/* ------------------------------- dashboard ------------------------------- */

export function projectListHtml(projects, query, showArchived) {
  if (!projects.length) {
    if (query) return emptyState({ title: 'No matching projects', text: `Nothing matches “${esc(query)}”. Try a project or client name.` });
    if (showArchived) return emptyState({ title: 'No archived projects', text: 'Projects you archive will be kept here.' });
    return emptyState({
      title: 'Create your first project',
      text: 'A project holds the original agreement, the requests that come later, and every comparison between them. Start by creating one, paste the agreed scope as the baseline, then log requests as they arrive.',
      action: `<a class="btn btn-primary" href="#/new">${icon('plus')}Create project</a>`,
    });
  }
  return `<ul class="project-list">${projects.map((p) => `
    <li class="project-row">
      <a class="project-link" href="#/p/${esc(p.id)}">
        <span class="project-name">${esc(p.name)} ${p.isDemo ? '<span class="chip">Demo data</span>' : ''}</span>
        <span class="project-meta">${p.client ? `${esc(p.client)} · ` : ''}Updated ${esc(fmtDate(p.updatedAt))}</span>
        <span class="project-status">${esc(projectStatusLine(p))}</span>
      </a>
      <details class="menu">
        <summary class="icon-btn" aria-label="Actions for ${esc(p.name)}">${icon('more')}</summary>
        <div class="menu-list" role="group" aria-label="Actions for ${esc(p.name)}">
          <a class="menu-item" href="#/p/${esc(p.id)}">${icon('folder')}Open</a>
          <button type="button" class="menu-item" data-action="project-rename" data-id="${esc(p.id)}">${icon('edit')}Rename</button>
          <button type="button" class="menu-item" data-action="${p.archived ? 'project-restore' : 'project-archive'}" data-id="${esc(p.id)}">${icon('archive')}${p.archived ? 'Restore from archive' : 'Archive'}</button>
          <button type="button" class="menu-item danger" data-action="project-delete" data-id="${esc(p.id)}">${icon('trash')}Delete…</button>
        </div>
      </details>
    </li>`).join('')}</ul>`;
}

export function viewDashboard({ all, query, showArchived, storageBanner, showBackupNote }) {
  const active = all.filter((p) => !p.archived);
  const archived = all.filter((p) => p.archived);
  const list = (showArchived ? archived : active).filter((p) => `${p.name} ${p.client}`.toLowerCase().includes(query.trim().toLowerCase()));
  list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return `
    ${pageHead('Projects', { sub: 'Compare what was agreed with what is being asked for.', actions: `<a class="btn btn-primary" href="#/new">${icon('plus')}Create project</a>` })}
    ${storageBanner ? `<div class="banner" role="alert">${esc(storageBanner)}</div>` : ''}
    ${showBackupNote ? `<div class="banner" id="backup-note"><p><strong>Your projects live only in this browser.</strong> Clearing browser data, switching browsers or losing this device can remove them, and browser storage is not an encrypted backup. Export a backup from <a href="#/data">Backup &amp; import</a> now and then.</p><button type="button" class="btn btn-sm" data-action="dismiss-backup-note">Got it</button></div>` : ''}
    <div class="toolbar">
      <div class="search">${icon('search')}<label class="sr-only" for="project-search">Search projects by project or client name</label>
        <input id="project-search" class="input" type="search" placeholder="Search projects or clients" value="${esc(query)}" autocomplete="off" data-role="project-search"></div>
      <div class="segmented" role="group" aria-label="Project list">
        <button type="button" class="seg" data-action="list-filter" data-value="active" aria-pressed="${!showArchived}">Active (${active.length})</button>
        <button type="button" class="seg" data-action="list-filter" data-value="archived" aria-pressed="${showArchived}">Archived (${archived.length})</button>
      </div>
    </div>
    <div id="project-list">${projectListHtml(list, query, showArchived)}</div>`;
}

/* ------------------------------ create project ------------------------------ */

export function viewNewProject() {
  return `${pageHead('Create project', { sub: 'Only the name is required. You can add the rest later.', back: { href: '#/', label: 'All projects' } })}
    <form class="card form" data-form="new-project" novalidate>
      <p class="form-error" data-form-error role="alert" tabindex="-1"></p>
      ${projectFields({ currency: 'INR' })}
      <div class="form-actions"><a class="btn" href="#/">Cancel</a><button class="btn btn-primary" type="submit">Create project</button></div>
    </form>`;
}

/* -------------------------------- overview -------------------------------- */

export function viewOverview(p) {
  const latest = p.comparisons[p.comparisons.length - 1];
  const reviewed = latest ? summarizeFindings(latest.findings) : null;
  const steps = [
    { done: true, label: 'Create the project', text: 'Done.', href: '' },
    { done: !!p.baseline, label: 'Save the original scope as the baseline', text: p.baseline ? `Saved ${fmtDate(p.baseline.updatedAt)}.` : 'Paste what was agreed.', href: `#/p/${p.id}/scope` },
    { done: p.requests.length > 0, label: 'Log client requests', text: p.requests.length ? `${plural(p.requests.length, 'request')} logged.` : 'Add requests as they arrive.', href: `#/p/${p.id}/requests` },
    { done: p.comparisons.length > 0, label: 'Compare', text: p.comparisons.length ? `${plural(p.comparisons.length, 'comparison')} saved.` : 'Compare the baseline with the requests.', href: `#/p/${p.id}/compare` },
    { done: !!reviewed && reviewed.flagged > 0 && reviewed.pending === 0, label: 'Review the findings', text: reviewed ? `${reviewed.reviewed} of ${reviewed.flagged} reviewed.` : 'Mark each finding after a comparison.', href: latest ? `#/p/${p.id}/c/${latest.id}` : `#/p/${p.id}/compare` },
    { done: !!latest && latest.exports.length > 0, label: 'Export a change report', text: latest && latest.exports.length ? 'Exported.' : 'Share it with your client.', href: latest ? `#/p/${p.id}/c/${latest.id}/report` : `#/p/${p.id}/compare` },
  ];
  const next = steps.findIndex((s) => !s.done);
  return `${projectHeader(p, '')}
    <div class="grid-2">
      <section class="card" aria-labelledby="wf">
        <h2 id="wf">Workflow</h2>
        <ol class="steps">${steps.map((s, i) => `<li class="step ${s.done ? 'done' : ''} ${i === next ? 'next' : ''}"><span class="step-mark" aria-hidden="true">${s.done ? icon('check') : i + 1}</span><div><a href="${esc(s.href || '#/p/' + p.id)}"><strong>${esc(s.label)}</strong></a><p>${esc(s.text)}${s.done ? ' <span class="sr-only">(completed)</span>' : i === next ? ' <span class="chip">Next</span>' : ''}</p></div></li>`).join('')}</ol>
      </section>
      <section class="card" aria-labelledby="pd">
        <div class="card-head"><h2 id="pd">Details</h2><button type="button" class="btn btn-sm" data-action="project-edit" data-id="${esc(p.id)}">${icon('edit')}Edit details</button></div>
        <dl class="kv">
          <dt>Client</dt><dd>${esc(p.client) || '<span class="muted">Not set</span>'}</dd>
          <dt>Start date</dt><dd>${p.startDate ? esc(fmtDate(p.startDate)) : '<span class="muted">Not set</span>'}</dd>
          <dt>Agreed budget</dt><dd>${p.budget !== '' && p.budget != null ? esc(formatMoney(p.budget, p.currency)) : '<span class="muted">Not set</span>'}</dd>
          <dt>Description</dt><dd>${p.description ? esc(p.description) : '<span class="muted">Not set</span>'}</dd>
          <dt>Created</dt><dd>${esc(fmtDateTime(p.createdAt))}</dd>
        </dl>
        <div class="card-actions">
          <button type="button" class="btn btn-sm" data-action="project-export" data-id="${esc(p.id)}">${icon('download')}Export project data</button>
          <button type="button" class="btn btn-sm" data-action="${p.archived ? 'project-restore' : 'project-archive'}" data-id="${esc(p.id)}">${icon('archive')}${p.archived ? 'Restore' : 'Archive'}</button>
          <button type="button" class="btn btn-sm btn-danger-outline" data-action="project-delete" data-id="${esc(p.id)}">${icon('trash')}Delete…</button>
        </div>
      </section>
    </div>
    ${latest ? `<section class="card" aria-labelledby="lc"><h2 id="lc">Latest comparison</h2>
      <p>${esc(fmtDateTime(latest.createdAt))} · ${esc(comparisonSummaryText(latest))}</p>
      <div class="card-actions"><a class="btn btn-sm btn-primary" href="#/p/${esc(p.id)}/c/${esc(latest.id)}">Open results</a><a class="btn btn-sm" href="#/p/${esc(p.id)}/c/${esc(latest.id)}/report">${icon('report')}Report</a></div></section>` : ''}`;
}

/* ------------------------------ original scope ------------------------------ */

export function scopeFormHtml(p, values = null) {
  const b = p.baseline;
  const v = values || (b ? { title: b.title, date: b.date, text: b.text } : { title: 'Original scope', date: '', text: '' });
  return `<form class="card form" data-form="scope" novalidate>
    <h2>${b ? 'Edit original scope' : 'Add the original scope'}</h2>
    ${b ? '<div class="banner"><p><strong>You are editing the baseline.</strong> New comparisons will use this text. Earlier comparisons keep the version they were run against, and the previous version is saved as a revision.</p></div>' : ''}
    <p class="form-error" data-form-error role="alert" tabindex="-1"></p>
    ${field({ id: 'sf-title', name: 'title', label: 'Scope title', value: v.title, attrs: 'maxlength="120" autocomplete="off"' })}
    ${field({ id: 'sf-date', name: 'date', label: 'Agreement date', type: 'date', value: v.date })}
    ${field({ id: 'sf-text', name: 'text', label: 'Original scope text', type: 'textarea', rows: 14, required: true, value: v.text, hint: 'Paste it from the proposal, contract, email or meeting notes. Use one requirement per line or sentence for the best results.', attrs: 'maxlength="60000" spellcheck="true"' })}
    <p class="note">${icon('shield')}<span>Only paste information you are permitted to store. It stays in this browser. It is not encrypted and is never sent to any server.</span></p>
    <div class="form-actions">${b ? '<button type="button" class="btn" data-action="scope-cancel">Cancel</button>' : ''}<button class="btn btn-primary" type="submit">${b ? 'Save changes to baseline' : 'Save as baseline'}</button></div>
  </form>`;
}

export function viewScope(p, editing) {
  const b = p.baseline;
  let body;
  if (!b || editing) body = scopeFormHtml(p);
  else {
    body = `<section class="card">
      <div class="card-head"><div><h2>${esc(b.title)}</h2><p class="muted">${b.date ? `Agreed ${esc(fmtDate(b.date))} · ` : ''}Saved ${esc(fmtDateTime(b.createdAt))}${b.updatedAt !== b.createdAt ? ` · Last edited ${esc(fmtDateTime(b.updatedAt))}` : ''}</p></div>
      <button type="button" class="btn btn-sm" data-action="scope-edit">${icon('edit')}Edit baseline</button></div>
      <pre class="scope-text" tabindex="0" aria-label="Original scope text">${esc(b.text)}</pre>
      <p class="note">${icon('shield')}<span>Stored only in this browser. Not encrypted.</span></p>
    </section>
    ${p.baselineRevisions.length ? `<section class="card"><h2>Earlier versions</h2><p class="muted">Kept for your records. Comparisons already run are not changed.</p><ul class="plain-list">${[...p.baselineRevisions].map((r, i) => ({ r, i })).reverse().map(({ r, i }) => `<li><span>Revision ${i + 1} · saved ${esc(fmtDateTime(r.savedAt))}${r.title ? ` · ${esc(r.title)}` : ''}</span><button type="button" class="btn btn-sm" data-action="revision-view" data-index="${i}">View</button></li>`).join('')}</ul></section>` : ''}`;
  }
  return `${projectHeader(p, 'scope')}${body}`;
}

/* ------------------------------ requests log ------------------------------ */

export function viewRequests(p) {
  const list = sortedRequests(p);
  const body = list.length
    ? `<ol class="request-list">${list.map((r) => `
      <li class="request">
        <div class="request-top">
          <div><strong>Received ${esc(fmtDate(r.date))}</strong>${r.source ? ` · ${esc(r.source)}` : ''}</div>
          <div class="row-actions">
            <button type="button" class="btn btn-sm" data-action="request-edit" data-id="${esc(r.id)}">${icon('edit')}Edit</button>
            <button type="button" class="btn btn-sm btn-danger-outline" data-action="request-delete" data-id="${esc(r.id)}">${icon('trash')}Delete…</button>
          </div>
        </div>
        <p class="request-text">${esc(r.text)}</p>
        ${r.reference ? `<p class="muted"><span class="label-inline">Reference:</span> ${esc(r.reference)}</p>` : ''}
        ${r.notes ? `<p class="muted"><span class="label-inline">Notes:</span> ${esc(r.notes)}</p>` : ''}
        <p class="stamp">Added to ScopeLens ${esc(fmtDateTime(r.createdAt))}${r.updatedAt !== r.createdAt ? ` · edited ${esc(fmtDateTime(r.updatedAt))}` : ''}</p>
      </li>`).join('')}</ol>`
    : emptyState({
      title: 'No client requests yet',
      text: 'When a client asks for something new or different, paste it here with the date they sent it. ScopeLens never reads your messages. You add each request yourself.',
      action: `<button type="button" class="btn btn-primary" data-action="request-add">${icon('plus')}Add request</button>`,
    });
  return `${projectHeader(p, 'requests')}
    <div class="section-head"><div><h2>Client requests</h2><p class="muted">Oldest first. “Received” is the date you entered. “Added” is when it was recorded here; neither is verified by the messaging platform.</p></div>
    ${list.length ? `<button type="button" class="btn btn-primary" data-action="request-add">${icon('plus')}Add request</button>` : ''}</div>
    ${body}`;
}

/* --------------------------------- compare --------------------------------- */

export function viewCompare(p, form = {}) {
  const reqs = sortedRequests(p);
  const mode = form.mode || 'requests';
  const selected = form.selected || new Set(reqs.map((r) => r.id));
  let body;
  if (!p.baseline) {
    body = emptyState({ title: 'Save the original scope first', text: 'Comparisons need a baseline to compare against.', action: `<a class="btn btn-primary" href="#/p/${esc(p.id)}/scope">Add original scope</a>` });
  } else {
    body = `<form class="card form" data-form="compare" novalidate>
      <h2>New comparison</h2>
      <p class="form-error" data-form-error role="alert" tabindex="-1"></p>
      <fieldset class="field"><legend>What should the original scope be compared with?</legend>
        <label class="choice"><input type="radio" name="mode" value="requests" ${mode === 'requests' ? 'checked' : ''}><span><strong>The original scope plus selected client requests</strong><br><span class="muted">Best for ongoing projects. Each request is checked against the baseline.</span></span></label>
        <label class="choice"><input type="radio" name="mode" value="manual" ${mode === 'manual' ? 'checked' : ''}><span><strong>An updated scope I paste in</strong><br><span class="muted">Best when the client sent a revised document or you rewrote the scope.</span></span></label>
      </fieldset>
      <div data-section="requests" ${mode === 'requests' ? '' : 'hidden'}>
        ${reqs.length ? `<fieldset class="field"><legend>Requests to include</legend>
          <div class="inline-actions"><button type="button" class="btn btn-sm" data-action="select-all-requests">Select all</button><button type="button" class="btn btn-sm" data-action="select-no-requests">Select none</button></div>
          <ul class="check-list">${reqs.map((r) => `<li><label class="choice"><input type="checkbox" name="requestIds" value="${esc(r.id)}" ${selected.has(r.id) ? 'checked' : ''}><span><strong>${esc(fmtDate(r.date))}${r.source ? ` · ${esc(r.source)}` : ''}</strong><br><span class="muted">${esc(truncate(r.text, 140))}</span></span></label></li>`).join('')}</ul>
          <p class="field-error" data-error-for="requests"></p></fieldset>`
        : `<div class="banner"><p>No requests logged yet. <a href="#/p/${esc(p.id)}/requests">Add a client request</a> to compare, or switch to pasting an updated scope.</p></div>`}
      </div>
      <div data-section="manual" ${mode === 'manual' ? '' : 'hidden'}>
        ${field({ id: 'cf-manual', name: 'manualText', label: 'Updated scope text', type: 'textarea', rows: 10, value: form.manualText || '', required: true, hint: 'Paste the full updated scope. ScopeLens compares it with the original statement by statement.', attrs: 'maxlength="60000"' })}
      </div>
      <p class="note">${icon('info')}<span>Detection uses simple, visible rules (keyword overlap, cue words such as “remove” or “change … to”, and a list of vague phrases). It does not understand meaning, so every finding is a prompt for you to review, not a verdict.</span></p>
      <div class="form-actions"><button class="btn btn-primary" type="submit">${icon('compare')}Run comparison</button></div>
    </form>`;
  }

  const prev = [...p.comparisons].reverse();
  const prevHtml = prev.length ? `<section class="card"><h2>Previous comparisons</h2><ul class="plain-list">${prev.map((c) => `
    <li><div><strong>${esc(fmtDateTime(c.createdAt))}</strong><br><span class="muted">${esc(c.mode === 'manual' ? 'Pasted updated scope' : plural(c.requests.length, 'request'))} · ${esc(comparisonSummaryText(c))}</span></div>
    <div class="row-actions"><a class="btn btn-sm" href="#/p/${esc(p.id)}/c/${esc(c.id)}">Open</a><button type="button" class="btn btn-sm btn-danger-outline" data-action="comparison-delete" data-id="${esc(c.id)}" aria-label="Delete comparison from ${esc(fmtDateTime(c.createdAt))}">${icon('trash')}Delete…</button></div></li>`).join('')}</ul></section>` : '';
  return `${projectHeader(p, 'compare')}${body}${prevHtml}`;
}

/* --------------------------------- results --------------------------------- */

export const TYPE_FILTERS = [
  ['changes', 'All changes'],
  ['new', 'Potentially new'],
  ['modified', 'Modified'],
  ['removed', 'Potentially removed'],
  ['ambiguous', 'Ambiguous'],
  ['duplicate', 'Possible duplicates'],
  ['unchanged', 'Unchanged'],
  ['all', 'Everything'],
];
export const STATUS_FILTERS = [['all', 'Any status'], ['pending', 'Not reviewed'], ['relevant', 'Relevant change'], ['irrelevant', 'Not relevant'], ['clarify', 'Needs clarification']];

export function summaryHtml(findings) {
  const s = summarizeFindings(findings);
  const tile = (n, label) => `<div class="stat"><div class="stat-n">${n}</div><div class="stat-l">${label}</div></div>`;
  return `<div class="summary" role="group" aria-label="Comparison summary">
    ${tile(s.additions, 'Potential additions')}${tile(s.removals, 'Potential removals')}${tile(s.modified, 'Modified requirements')}${tile(s.clarify, 'Awaiting clarification')}
  </div>
  <p class="muted small">${s.reviewed} of ${s.flagged} findings reviewed${s.ambiguous ? ` · ${plural(s.ambiguous, 'ambiguous item')}` : ''}${s.duplicates ? ` · ${plural(s.duplicates, 'possible duplicate')}` : ''}${s.unchanged ? ` · ${plural(s.unchanged, 'statement')} appear unchanged` : ''}</p>`;
}

export function filterFindings(findings, type, status) {
  return findings.filter((f) => {
    if (type === 'changes' && f.type === 'unchanged') return false;
    if (!['changes', 'all'].includes(type) && f.type !== type) return false;
    if (status !== 'all' && f.status !== status) return false;
    return true;
  });
}

const CONF = { high: 'High', medium: 'Moderate', low: 'Low' };

function inlineDiff(chunks) {
  return chunks.map((c) => (c.type === 'add' ? `<ins>${esc(c.text)}</ins>` : c.type === 'del' ? `<del>${esc(c.text)}</del>` : esc(c.text))).join('');
}

export function findingCard(f) {
  const reviewable = f.type !== 'unchanged';
  const dec = (status, label) => `<button type="button" class="btn btn-sm decision" data-action="finding-status" data-fid="${esc(f.id)}" data-status="${status}" aria-pressed="${f.status === status}">${label}</button>`;
  return `<article class="finding" id="finding-${esc(f.id)}" data-status="${esc(f.status)}" data-type="${esc(f.type)}" aria-labelledby="ft-${esc(f.id)}">
    <div class="finding-top"><span class="chip chip-type">${esc(TYPE_LABELS[f.type])}</span>
      ${reviewable ? `<span class="chip chip-status s-${esc(f.status)}">${esc(STATUS_LABELS[f.status])}</span>` : ''}</div>
    <h3 id="ft-${esc(f.id)}">${esc(f.title)}</h3>
    <div class="pair">
      <div class="col"><h4>Original</h4><p>${f.original ? esc(f.original) : '<span class="muted">Not in the original scope</span>'}</p></div>
      <div class="col"><h4>${f.type === 'removed' ? 'Request or updated text' : 'New or updated'}</h4><p>${f.updated ? esc(f.updated) : '<span class="muted">Not in the updated text</span>'}</p></div>
    </div>
    ${f.diff && f.original && f.updated && f.source === null ? `<p class="inline-diff"><span class="label-inline">Changes:</span> ${inlineDiff(f.diff)}</p>` : ''}
    <p class="why"><span class="label-inline">Why it was flagged:</span> ${esc(f.reason)}</p>
    ${f.flags && f.flags.length ? `<ul class="flag-list">${f.flags.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${f.related ? `<p class="why"><span class="label-inline">Related exclusion in the original:</span> ${esc(f.related.text)}</p>` : ''}
    ${f.closest && !f.original && !(f.related && f.related.text === f.closest.text) ? `<p class="why muted"><span class="label-inline">Closest original statement (${Math.round(f.closest.similarity * 100)}% keyword overlap):</span> ${esc(f.closest.text)}</p>` : ''}
    <p class="meta-line">${f.source && f.source.label ? `${esc(f.source.label)} · ` : ''}Match confidence: ${esc(CONF[f.confidence] || 'Moderate')}<span class="sr-only">. This reflects keyword overlap only, not a legal or semantic judgement.</span></p>
    ${reviewable ? `<div class="decision-row" role="group" aria-label="Review decision for ${esc(truncate(f.title, 60))}">${dec('relevant', 'Relevant change')}${dec('irrelevant', 'Not relevant')}${dec('clarify', 'Needs clarification')}</div>
      <div class="note-box"><label for="note-${esc(f.id)}">Your note or decision</label>
        <textarea id="note-${esc(f.id)}" class="input" rows="2" maxlength="5000" data-role="note" data-fid="${esc(f.id)}" placeholder="For example: covered by revision allowance; agreed to extra fee on 12 Oct">${esc(f.note)}</textarea>
        <button type="button" class="btn btn-sm" data-action="note-save" data-fid="${esc(f.id)}">Save note</button></div>` : ''}
  </article>`;
}

export function findingsListHtml(findings, type, status) {
  const list = filterFindings(findings, type, status);
  if (!list.length) {
    const flagged = findings.filter((f) => f.type !== 'unchanged').length;
    if (!flagged && type === 'changes' && status === 'all') {
      return emptyState({ title: 'No meaningful changes detected', text: 'Nothing in the selected requests appears to go beyond the original scope. This is a simple text comparison and can miss reworded requests, so read the requests yourself too.' });
    }
    return emptyState({ title: 'Nothing matches these filters', text: 'Change the type or status filter to see other findings.' });
  }
  return `<div class="findings">${list.map(findingCard).join('')}</div><p class="muted small" aria-live="polite">${plural(list.length, 'finding')} shown.</p>`;
}

export function diffPanelHtml(c, showAll) {
  const d = diffText(c.originalText, c.updatedText);
  const chunks = showAll ? d.chunks : collapseChunks(d.chunks, 12);
  const html = chunks.map((x) => {
    if (x.type === 'add') return `<ins><span class="sr-only">[added: </span>${esc(x.text)}<span class="sr-only">]</span></ins>`;
    if (x.type === 'del') return `<del><span class="sr-only">[removed: </span>${esc(x.text)}<span class="sr-only">]</span></del>`;
    if (x.type === 'gap') return `<span class="gap">… ${plural(x.hidden, 'unchanged word')} …</span>`;
    return esc(x.text);
  }).join('');
  const s = d.stats;
  return `<div class="legend" aria-label="Legend"><span><ins>Added text</ins></span><span><del>Removed text</del></span><span>Unchanged text</span></div>
    <p class="muted small">${plural(s.added, 'word')} added · ${plural(s.removed, 'word')} removed · ${s.similarity}% of words unchanged. Case, punctuation and line breaks are ignored.${s.approximate ? ' The texts are very large, so the middle section is shown as replaced.' : ''}</p>
    ${c.mode === 'requests' ? '<p class="muted small">In this mode the updated scope is the original followed by the selected requests, so the text view mostly shows additions. Use “An updated scope I paste in” to see removals and edits.</p>' : ''}
    ${d.identical ? '<div class="empty-inline">No differences in the words. Any differences are formatting, capitalisation or punctuation only.</div>' : ''}
    <label class="choice inline"><input type="checkbox" data-role="show-all-text" ${showAll ? 'checked' : ''}><span>Show all unchanged text</span></label>
    <div class="diff" tabindex="0" aria-label="Text comparison">${html}</div>`;
}

export function messageCardHtml(p, c) {
  return `<section class="card" aria-labelledby="msg-h"><h2 id="msg-h">Suggested message to the client</h2>
    <p class="muted">Built from your findings with a local template. Edit it before you copy it. It does not say that any payment is owed.</p>
    <label class="sr-only" for="client-message">Suggested message to the client</label>
    <textarea id="client-message" class="input message" rows="12" data-role="message">${esc(effectiveMessage(p, c))}</textarea>
    <div class="card-actions"><button type="button" class="btn btn-primary btn-sm" data-action="message-copy">${icon('copy')}Copy message</button><button type="button" class="btn btn-sm" data-action="message-reset">${icon('rotate')}Reset to suggestion</button></div></section>`;
}

export function viewResults(p, c, ui) {
  const modeLabel = c.mode === 'manual' ? 'Compared with a pasted updated scope' : `Compared with ${plural(c.requests.length, 'request')}`;
  return `${projectHeader(p, 'compare')}
    <div class="section-head"><div><h2>Comparison results</h2>
      <p class="muted">${esc(fmtDateTime(c.createdAt))} · ${esc(modeLabel)} · baseline “${esc(c.baseline.title)}”${c.baseline.revision > 1 ? ` (revision ${c.baseline.revision})` : ''}</p></div>
      <a class="btn btn-primary" href="#/p/${esc(p.id)}/c/${esc(c.id)}/report">${icon('report')}Generate report</a></div>
    <div class="banner"><p><strong>These are prompts to review, not conclusions.</strong> A request may already be covered by the original agreement or by an agreed revision allowance. You make the final decision.</p></div>
    <div id="summary">${summaryHtml(c.findings)}</div>
    <div class="tabs tabs-inner" role="tablist" aria-label="Result views">
      <button type="button" role="tab" class="tab" data-action="results-tab" data-tab="findings" aria-selected="${ui.tab === 'findings'}">${icon('list')}<span>Findings</span></button>
      <button type="button" role="tab" class="tab" data-action="results-tab" data-tab="text" aria-selected="${ui.tab === 'text'}">${icon('compare')}<span>Text comparison</span></button>
    </div>
    <div id="panel-findings" ${ui.tab === 'findings' ? '' : 'hidden'}>
      <div class="filters">
        <div class="field"><label for="filter-type">Type</label><select id="filter-type" class="input" data-role="filter-type">${TYPE_FILTERS.map(([v, l]) => `<option value="${v}" ${ui.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label for="filter-status">Review status</label><select id="filter-status" class="input" data-role="filter-status">${STATUS_FILTERS.map(([v, l]) => `<option value="${v}" ${ui.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div id="findings-list">${findingsListHtml(c.findings, ui.type, ui.status)}</div>
    </div>
    <div id="panel-text" ${ui.tab === 'text' ? '' : 'hidden'}>${ui.tab === 'text' ? diffPanelHtml(c, ui.showAllText) : ''}</div>
    ${messageCardHtml(p, c)}`;
}

/* --------------------------------- history --------------------------------- */

export function viewHistory(p) {
  const events = [...p.history].sort((a, b) => b.at.localeCompare(a.at));
  const groups = [];
  for (const e of events) {
    const day = fmtDate(e.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(e); else groups.push({ day, items: [e] });
  }
  const body = groups.length ? groups.map((g) => `<section class="history-day" aria-label="${esc(g.day)}"><h3>${esc(g.day)}</h3><ol class="timeline">${g.items.map((e) => {
    const m = e.meta || {};
    const extra = (e.type === 'request_added' || e.type === 'request_edited') && m.receivedDate
      ? `<p class="muted small">Request dated ${esc(fmtDate(m.receivedDate))}${m.source ? ` via ${esc(m.source)}` : ''} (as entered by you) · entered into ScopeLens ${esc(fmtDateTime(e.at))}</p>` : '';
    return `<li><div class="tl-mark" aria-hidden="true"></div><div><p class="tl-title"><strong>${esc(historyLabel(e.type))}</strong> <span class="muted small">${esc(fmtDateTime(e.at))}</span></p><p>${esc(e.text)}</p>${extra}</div></li>`;
  }).join('')}</ol></section>`).join('') : emptyState({ title: 'No history yet', text: 'Changes to the project will be listed here.' });
  return `${projectHeader(p, 'history')}
    <div class="section-head"><div><h2>Change history</h2><p class="muted">Newest first. Times show when something was recorded in ScopeLens on this device. Request dates are the dates you typed in; ScopeLens cannot verify them against any messaging platform.</p></div></div>${body}`;
}

/* ---------------------------------- report ---------------------------------- */

export function viewReportShell(p, c, reportHtml) {
  return `<div class="no-print">${projectHeader(p, 'compare')}
    <div class="section-head"><div><h2>Change report</h2><p class="muted">A clean report for sharing. To save a PDF, choose Print and then “Save as PDF”.</p></div>
      <a class="btn btn-sm" href="#/p/${esc(p.id)}/c/${esc(c.id)}">${icon('chevron-left')}Back to results</a></div>
    <div class="toolbar report-tools">
      <button type="button" class="btn btn-primary" data-action="report-print">${icon('report')}Print or save as PDF</button>
      <button type="button" class="btn" data-action="report-download-html">${icon('download')}Download HTML</button>
      <button type="button" class="btn" data-action="report-download-json">${icon('download')}Export JSON</button>
    </div></div>
    <div class="report-frame">${reportHtml}</div>`;
}

/* ---------------------------------- data ---------------------------------- */

export function viewData({ count, hasDemo, mode, modeError, persist, importResult }) {
  const fmtBytes = (n) => (n == null ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  return `${pageHead('Backup & import', { sub: 'Your data stays in this browser. Back it up yourself.' })}
    <section class="card"><h2>Export a backup</h2>
      <p>Download every project (${count}) as one JSON file. Keep it somewhere private: the file is plain text and is not encrypted.</p>
      <div class="card-actions"><button type="button" class="btn btn-primary" data-action="export-all" ${count ? '' : 'disabled'}>${icon('download')}Export all projects</button></div>
      ${count ? '' : '<p class="muted small">There is nothing to export yet.</p>'}</section>
    <section class="card"><h2>Import a backup</h2>
      <p>Choose a ScopeLens JSON backup. The file is checked before anything is saved. Imports never overwrite existing projects. If a project already exists, the import is added as a copy.</p>
      <div class="field"><label for="import-file">Backup file (.json)</label><input id="import-file" class="input" type="file" accept=".json,application/json" data-role="import-file"></div>
      <div id="import-result" aria-live="polite">${importResult || ''}</div></section>
    <section class="card"><h2>Storage and privacy</h2>
      <ul class="plain-bullets">
        <li>Projects are saved with ${mode === 'indexeddb' ? 'your browser’s IndexedDB storage' : '<strong>temporary memory only</strong>'}. ${mode === 'memory' ? `Your browser blocked persistent storage${modeError ? ` (${esc(modeError)})` : ''}, so projects will disappear when you close or refresh this page. Export a backup often.` : 'They are still there after a refresh or restart.'}</li>
        <li>Clearing browser data, using private browsing, uninstalling the browser or losing the device can delete your projects. Browser storage is not a secure, encrypted backup.</li>
        <li>No text is sent to any server. There are no analytics, no trackers and no API keys.</li>
      </ul>
      ${persist.supported ? `<p>Persistent storage: <strong>${persist.persisted ? 'granted' : 'not granted'}</strong>${persist.usage != null ? ` · using ${esc(fmtBytes(persist.usage))}` : ''}.</p>
        ${persist.persisted ? '' : '<div class="card-actions"><button type="button" class="btn btn-sm" data-action="persist-request">Ask the browser to keep my data</button></div>'}` : '<p class="muted">This browser does not report persistent-storage status.</p>'}</section>
    <section class="card"><h2>Demo data</h2>
      <p>Load a made-up sample project to try the workflow. It is clearly marked, kept separate from your real projects, and can be removed in one click.</p>
      <div class="card-actions"><button type="button" class="btn" data-action="demo-load">Load demo project</button>
        <button type="button" class="btn btn-danger-outline" data-action="demo-remove" ${hasDemo ? '' : 'disabled'}>${icon('trash')}Remove demo data…</button></div></section>`;
}

/* ---------------------------------- about ---------------------------------- */

export function viewAbout() {
  return `${pageHead('How it works', { sub: 'What ScopeLens does, how it decides, and where it can be wrong.' })}
    <section class="card"><h2>The workflow</h2>
      <ol class="plain-bullets"><li>Create a project.</li><li>Paste the original agreed scope and save it as the baseline.</li><li>Log client requests as they arrive, with the date each was received.</li><li>Compare the baseline with the selected requests, or with an updated scope you paste.</li><li>Review each finding: relevant change, not relevant, or needs clarification. Add notes.</li><li>Generate a report and a neutral message to share with your client.</li></ol></section>
    <section class="card"><h2>How detection works</h2>
      <p>Everything runs in your browser using fixed, visible rules. There is no AI model and nothing is uploaded.</p>
      <ul class="plain-bullets">
        <li><strong>Text comparison</strong> compares words and ignores capitalisation, punctuation and line breaks, so reformatting is not reported as a change.</li>
        <li><strong>Requirement comparison</strong> splits text into sentences and bullet points, reduces each to its key words, and pairs statements that share many of them.</li>
        <li><strong>Request wording</strong> is checked for cues such as “remove”, “drop”, “change … to” and “instead of”, and for vague phrases such as “etc”, “as needed” or “improve”.</li>
        <li>Requests that mention something your original scope explicitly excludes are shown next to that exclusion.</li>
      </ul></section>
    <section class="card"><h2>Limitations</h2>
      <ul class="plain-bullets">
        <li>Matching is by shared keywords, not meaning. Different words for the same thing can look new. Similar words for different things can look the same.</li>
        <li>Sentences that mix several requirements are treated as one statement.</li>
        <li>A finding never means a client is wrong, that a request is outside the agreement, or that payment is owed. Contracts have nuance this tool cannot read.</li>
        <li>Match confidence describes keyword overlap only. Use the notes and decisions to record your own judgement.</li>
        <li>Dates are entered by you. ScopeLens cannot verify when a message was really sent.</li>
      </ul></section>
    <section class="card"><h2>Privacy</h2>
      <p>Projects are saved in this browser only. The page blocks outside network connections. Do not paste information you are not permitted to store. Browser storage is not encrypted, so export backups and keep them private.</p></section>`;
}

export function viewNotFound(text = 'That page or project could not be found.') {
  return `${pageHead('Not found')}${emptyState({ title: 'We could not find that', text: esc(text), action: `<a class="btn btn-primary" href="#/">Back to projects</a>` })}`;
}
