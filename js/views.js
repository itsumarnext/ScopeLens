// views.js — render functions. Each returns an HTML string (all user text is escaped).
// Wording rule: short, everyday words. Add one small line of help only where a term needs it.

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
  const tag = required ? '<span class="req"> (required)</span>' : optionalLabel ? '<span class="opt"> (optional)</span>' : '';
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
  return `<div class="field"><label for="${id}">${esc(label)}${tag}</label>${hint ? `<p class="hint" id="${id}-hint">${esc(hint)}</p>` : ''}${control}${dl}<p class="field-error" id="${id}-error" data-error-for="${name}"></p></div>`;
}

export function projectFields(v = {}) {
  return [
    field({ id: 'pf-name', name: 'name', label: 'Project name', required: true, value: v.name, attrs: 'maxlength="120" autocomplete="off" autofocus' }),
    field({ id: 'pf-client', name: 'client', label: 'Client name', value: v.client, attrs: 'maxlength="120" autocomplete="off"' }),
    field({ id: 'pf-description', name: 'description', label: 'About this project', type: 'textarea', rows: 3, value: v.description, hint: 'A line or two is enough.', attrs: 'maxlength="1000"' }),
    field({ id: 'pf-start', name: 'startDate', label: 'Start date', type: 'date', value: v.startDate }),
    `<div class="field-row">
      ${field({ id: 'pf-budget', name: 'budget', label: 'Agreed price', type: 'text', value: v.budget ?? '', hint: 'Numbers only. Example: 45000', attrs: 'inputmode="decimal" autocomplete="off"' })}
      ${field({ id: 'pf-currency', name: 'currency', label: 'Currency', value: v.currency || 'INR', options: CURRENCIES.map((c) => ({ value: c, label: c })), optionalLabel: false })}
    </div>`,
  ].join('');
}

export function requestFields(v = {}) {
  return [
    field({ id: 'rf-text', name: 'text', label: 'What did the client ask for?', type: 'textarea', rows: 6, required: true, value: v.text, hint: 'Paste their message, or write it in your own words. Only paste things you are allowed to keep.', attrs: 'maxlength="8000"' }),
    `<div class="field-row">
      ${field({ id: 'rf-date', name: 'date', label: 'Date received', type: 'date', required: true, value: v.date || todayDate(), hint: 'The day the client sent it.' })}
      ${field({ id: 'rf-source', name: 'source', label: 'How did it arrive?', value: v.source, hint: 'For example: email, chat or call.', datalist: { id: 'rf-source-list', items: SOURCE_SUGGESTIONS }, attrs: 'maxlength="80" autocomplete="off"' })}
    </div>`,
    field({ id: 'rf-reference', name: 'reference', label: 'Subject or topic', value: v.reference, hint: 'For example an email subject or meeting name.', attrs: 'maxlength="300" autocomplete="off"' }),
    field({ id: 'rf-notes', name: 'notes', label: 'Your notes', type: 'textarea', rows: 3, value: v.notes, attrs: 'maxlength="3000"' }),
  ].join('');
}

/* -------------------------------- chrome -------------------------------- */

function pageHead(title, { sub = '', actions = '', back = null } = {}) {
  return `<header class="page-head">
    ${back ? `<a class="back-link" href="${esc(back.href)}">${icon('chevron-left')}${esc(back.label)}</a>` : ''}
    <div class="page-head-row"><div class="page-head-text"><h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${actions ? `<div class="head-actions">${actions}</div>` : ''}</div>
  </header>`;
}

function sectionHead(title, sub = '', actions = '') {
  return `<div class="section-head"><div class="section-head-text"><h2>${esc(title)}</h2>${sub ? `<p class="muted">${sub}</p>` : ''}</div>${actions ? `<div class="head-actions">${actions}</div>` : ''}</div>`;
}

function emptyState({ title, text, action = '' }) {
  return `<div class="empty"><div class="empty-mark">${icon('compare')}</div><h2>${esc(title)}</h2><p>${text}</p>${action}</div>`;
}

const TABS = [
  ['', 'Overview', 'folder'],
  ['scope', 'Agreement', 'file'],
  ['requests', 'Requests', 'list'],
  ['compare', 'Compare', 'compare'],
  ['history', 'History', 'clock'],
];

export function projectHeader(p, active) {
  const meta = [p.client, p.startDate ? `Started ${fmtDate(p.startDate)}` : '', p.budget !== '' && p.budget != null ? formatMoney(p.budget, p.currency) : ''].filter(Boolean);
  return `<header class="project-head">
    <a class="back-link" href="#/ai/classic">${icon('chevron-left')}All classic projects</a>
    <div class="project-title">
      <h1>${esc(p.name)}</h1>
      ${p.archived || p.isDemo ? `<div class="chips">${p.archived ? '<span class="chip">Archived</span>' : ''}${p.isDemo ? '<span class="chip">Sample project</span>' : ''}</div>` : ''}
      ${meta.length ? `<p class="sub">${meta.map(esc).join(' · ')}</p>` : ''}
    </div>
    <nav class="tabs" aria-label="Project sections">
      ${TABS.map(([slug, label, ic]) => `<a class="tab" href="#/p/${esc(p.id)}${slug ? '/' + slug : ''}" ${active === slug ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></a>`).join('')}
    </nav>
  </header>`;
}

/* ------------------------------- dashboard ------------------------------- */

export function projectListHtml(projects, query, showArchived) {
  if (!projects.length) {
    if (query) return emptyState({ title: 'No matching projects', text: `Nothing matches “${esc(query)}”. Try a project name or a client name.` });
    if (showArchived) return emptyState({ title: 'No archived projects', text: 'Projects you archive will be kept here.' });
    return emptyState({
      title: 'No projects yet',
      text: 'Create your first project to get started.',
      action: `<a class="btn btn-primary" href="#/new">${icon('plus')}Create project</a>`,
    });
  }
  return `<ul class="project-list">${projects.map((p) => `
    <li class="project-row">
      <a class="project-link" href="#/p/${esc(p.id)}">
        <span class="project-name">${esc(p.name)}${p.isDemo ? ' <span class="chip">Sample project</span>' : ''}</span>
        <span class="project-meta">${p.client ? `${esc(p.client)} · ` : ''}Updated ${esc(fmtDate(p.updatedAt))}</span>
        <span class="project-status">${esc(projectStatusLine(p))}</span>
      </a>
      <details class="menu">
        <summary class="icon-btn" aria-label="More actions for ${esc(p.name)}">${icon('more')}</summary>
        <div class="menu-list" role="group" aria-label="Actions for ${esc(p.name)}">
          <a class="menu-item" href="#/p/${esc(p.id)}">${icon('folder')}Open</a>
          <button type="button" class="menu-item" data-action="project-rename" data-id="${esc(p.id)}">${icon('edit')}Rename</button>
          <button type="button" class="menu-item" data-action="${p.archived ? 'project-restore' : 'project-archive'}" data-id="${esc(p.id)}">${icon('archive')}${p.archived ? 'Move back to projects' : 'Archive'}</button>
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
    ${pageHead('Your projects', { sub: 'Keep each client’s agreed work and new requests in one place.', actions: `<a class="btn btn-primary" href="#/new">${icon('plus')}Create project</a>` })}
    ${storageBanner ? `<div class="banner" role="alert"><p>${esc(storageBanner)}</p></div>` : ''}
    ${showBackupNote ? `<div class="banner" id="backup-note"><p><strong>Your projects are saved only in this browser.</strong> If you clear your browser data or lose this device, they can be lost. Now and then, download a backup on the <a href="#/data">Backups</a> page.</p><button type="button" class="btn btn-sm" data-action="dismiss-backup-note">Got it</button></div>` : ''}
    <div class="toolbar">
      <div class="search">${icon('search')}<label class="sr-only" for="project-search">Search by project or client name</label>
        <input id="project-search" class="input" type="search" placeholder="Search by project or client" value="${esc(query)}" autocomplete="off" data-role="project-search"></div>
      <div class="segmented" role="group" aria-label="Which projects to show">
        <button type="button" class="seg" data-action="list-filter" data-value="active" aria-pressed="${!showArchived}">Active (${active.length})</button>
        <button type="button" class="seg" data-action="list-filter" data-value="archived" aria-pressed="${showArchived}">Archived (${archived.length})</button>
      </div>
    </div>
    <div id="project-list">${projectListHtml(list, query, showArchived)}</div>`;
}

/* ------------------------------ create project ------------------------------ */

export function viewNewProject() {
  return `${pageHead('Create a project', { sub: 'Only the name is needed. You can add the rest later.', back: { href: '#/', label: 'All projects' } })}
    <form class="card form" data-form="new-project" novalidate>
      <p class="form-error" data-form-error role="alert" tabindex="-1"></p>
      ${projectFields({ currency: 'INR' })}
      <div class="form-actions"><a class="btn" href="#/ai/classic">Cancel</a><button class="btn btn-primary" type="submit">Create project</button></div>
    </form>`;
}

/* -------------------------------- overview -------------------------------- */

export function viewOverview(p) {
  const latest = p.comparisons[p.comparisons.length - 1];
  const rs = latest ? summarizeFindings(latest.findings) : null;
  const L = latest ? `#/p/${p.id}/c/${latest.id}` : `#/p/${p.id}/compare`;
  const steps = [
    { done: true, label: 'Create a project', text: 'Done.', title: '', cta: '', href: `#/p/${p.id}` },
    {
      done: !!p.baseline, label: 'Add the original agreement', text: p.baseline ? `Saved ${fmtDate(p.baseline.updatedAt)}.` : 'What you and your client agreed to do.',
      title: 'Add the original agreement', help: 'Paste what you and your client agreed to do. ScopeLens checks new requests against it.', cta: 'Add agreement', href: `#/p/${p.id}/scope`,
    },
    {
      done: p.requests.length > 0, label: 'Add client requests', text: p.requests.length ? `${plural(p.requests.length, 'request')} added.` : 'Add each new thing your client asks for.',
      title: 'Add a client request', help: 'Paste or type what your client asked for, with the date they asked.', cta: 'Add a client request', href: `#/p/${p.id}/requests`,
    },
    {
      done: p.comparisons.length > 0, label: 'Compare', text: p.comparisons.length ? `${plural(p.comparisons.length, 'comparison')} saved.` : 'Check the requests against the agreement.',
      title: 'Compare the requests with the agreement', help: 'ScopeLens points out what may be new, changed or unclear.', cta: 'Compare now', href: `#/p/${p.id}/compare`,
    },
    {
      done: !!rs && rs.pending === 0, label: 'Review the results', text: rs ? `${rs.reviewed} of ${rs.flagged} reviewed.` : 'Mark each result and add notes.',
      title: 'Review the results', help: 'For each result, say if it is a real change, not a change, or something to ask your client.', cta: 'Review results', href: L,
    },
    {
      done: !!latest && latest.exports.length > 0, label: 'Create a report', text: latest && latest.exports.length ? 'Report saved or shared.' : 'Share it with your client to talk it through.',
      title: 'Create a report for your client', help: 'A clean page you can print, save as PDF, or send.', cta: 'Create report', href: latest ? `${L}/report` : `#/p/${p.id}/compare`,
    },
  ];
  const next = steps.findIndex((s) => !s.done);
  const nextCard = next === -1
    ? `<section class="card card-next"><p class="eyebrow">All steps done</p><h2>You are up to date</h2><p class="muted">When your client asks for something new, add it and compare again.</p><div class="card-actions"><a class="btn btn-primary" href="#/p/${esc(p.id)}/requests">Add a client request</a></div></section>`
    : `<section class="card card-next" aria-labelledby="nx"><p class="eyebrow">Next step</p><h2 id="nx">${esc(steps[next].title)}</h2><p class="muted">${esc(steps[next].help)}</p><div class="card-actions"><a class="btn btn-primary" href="${esc(steps[next].href)}">${esc(steps[next].cta)}</a></div></section>`;
  return `${projectHeader(p, '')}
    ${nextCard}
    <div class="grid-2">
      <section class="card" aria-labelledby="wf">
        <h2 id="wf">Your steps</h2>
        <ol class="steps">${steps.map((s, i) => `<li class="step ${s.done ? 'done' : ''} ${i === next ? 'next' : ''}"><span class="step-mark" aria-hidden="true">${s.done ? icon('check') : i + 1}</span><div class="step-text"><a href="${esc(s.href)}"><strong>${esc(s.label)}</strong></a><p>${esc(s.text)}${s.done ? ' <span class="sr-only">(done)</span>' : ''}</p></div></li>`).join('')}</ol>
      </section>
      <section class="card" aria-labelledby="pd">
        <div class="card-head"><h2 id="pd">Project details</h2><button type="button" class="btn btn-sm" data-action="project-edit" data-id="${esc(p.id)}">${icon('edit')}Edit</button></div>
        <dl class="kv">
          <dt>Client</dt><dd>${esc(p.client) || '<span class="muted">Not added</span>'}</dd>
          <dt>Start date</dt><dd>${p.startDate ? esc(fmtDate(p.startDate)) : '<span class="muted">Not added</span>'}</dd>
          <dt>Agreed price</dt><dd>${p.budget !== '' && p.budget != null ? esc(formatMoney(p.budget, p.currency)) : '<span class="muted">Not added</span>'}</dd>
          <dt>About</dt><dd>${p.description ? esc(p.description) : '<span class="muted">Not added</span>'}</dd>
          <dt>Created</dt><dd>${esc(fmtDateTime(p.createdAt))}</dd>
        </dl>
        <div class="card-actions">
          <button type="button" class="btn btn-sm" data-action="project-export" data-id="${esc(p.id)}">${icon('download')}Download project backup</button>
          <button type="button" class="btn btn-sm" data-action="${p.archived ? 'project-restore' : 'project-archive'}" data-id="${esc(p.id)}">${icon('archive')}${p.archived ? 'Move back to projects' : 'Archive'}</button>
          <button type="button" class="btn btn-sm btn-danger-outline" data-action="project-delete" data-id="${esc(p.id)}">${icon('trash')}Delete…</button>
        </div>
      </section>
    </div>
    ${latest ? `<section class="card" aria-labelledby="lc"><h2 id="lc">Latest results</h2>
      <p>${esc(fmtDateTime(latest.createdAt))}</p><p class="muted">${esc(comparisonSummaryText(latest))}</p>
      <div class="card-actions"><a class="btn btn-sm btn-primary" href="#/p/${esc(p.id)}/c/${esc(latest.id)}">Open results</a><a class="btn btn-sm" href="#/p/${esc(p.id)}/c/${esc(latest.id)}/report">${icon('report')}Create report</a></div></section>` : ''}`;
}

/* ------------------------------ original agreement ------------------------------ */

export function scopeFormHtml(p, values = null) {
  const b = p.baseline;
  const v = values || (b ? { title: b.title, date: b.date, text: b.text } : { title: 'Original agreement', date: '', text: '' });
  return `<form class="card form" data-form="scope" novalidate>
    <h2>${b ? 'Change the original agreement' : 'Add the original agreement'}</h2>
    ${b ? '<div class="banner"><p><strong>You are changing the agreement ScopeLens compares against.</strong> New comparisons will use this text. Comparisons you already made keep the old text, and the old version is saved as an earlier version.</p></div>' : ''}
    <p class="form-error" data-form-error role="alert" tabindex="-1"></p>
    ${field({ id: 'sf-title', name: 'title', label: 'Title', value: v.title, attrs: 'maxlength="120" autocomplete="off"' })}
    ${field({ id: 'sf-date', name: 'date', label: 'Date agreed', type: 'date', value: v.date })}
    ${field({ id: 'sf-text', name: 'text', label: 'Agreement text', type: 'textarea', rows: 14, required: true, value: v.text, hint: 'Paste it from your proposal, contract, email or meeting notes. Put each item on its own line for the best results.', attrs: 'maxlength="60000" spellcheck="true"' })}
    <p class="note">${icon('shield')}<span>Only paste things you are allowed to keep. They stay in this browser, are not locked with a password, and are never sent anywhere.</span></p>
    <div class="form-actions">${b ? '<button type="button" class="btn" data-action="scope-cancel">Cancel</button>' : ''}<button class="btn btn-primary" type="submit">${b ? 'Save changes' : 'Save agreement'}</button></div>
  </form>`;
}

export function viewScope(p, editing) {
  const b = p.baseline;
  let body;
  if (!b || editing) body = scopeFormHtml(p);
  else {
    body = `<section class="card">
      <div class="card-head"><div><h2>${esc(b.title)}</h2><p class="muted">${b.date ? `Agreed ${esc(fmtDate(b.date))} · ` : ''}Saved ${esc(fmtDateTime(b.createdAt))}${b.updatedAt !== b.createdAt ? ` · Last changed ${esc(fmtDateTime(b.updatedAt))}` : ''}</p></div>
      <button type="button" class="btn btn-sm" data-action="scope-edit">${icon('edit')}Change</button></div>
      <pre class="scope-text" tabindex="0" aria-label="Original agreement text">${esc(b.text)}</pre>
      <p class="note">${icon('shield')}<span>Saved only in this browser. Not locked with a password.</span></p>
    </section>
    ${p.baselineRevisions.length ? `<section class="card"><div><h2>Earlier versions</h2><p class="muted">Older copies of this agreement. Comparisons you already made do not change.</p></div><ul class="plain-list">${[...p.baselineRevisions].map((r, i) => ({ r, i })).reverse().map(({ r, i }) => `<li><span>Version ${i + 1} · saved ${esc(fmtDateTime(r.savedAt))}${r.title ? ` · ${esc(r.title)}` : ''}</span><button type="button" class="btn btn-sm" data-action="revision-view" data-index="${i}">View</button></li>`).join('')}</ul></section>` : ''}`;
  }
  return `${projectHeader(p, 'scope')}
    ${sectionHead('Original agreement', 'What you and your client agreed to do.')}
    ${body}`;
}

/* ------------------------------ client requests ------------------------------ */

export function viewRequests(p) {
  const list = sortedRequests(p);
  const body = list.length
    ? `<ol class="request-list">${list.map((r) => `
      <li class="request">
        <div class="request-top">
          <p class="request-when"><strong>Received ${esc(fmtDate(r.date))}</strong>${r.source ? ` · ${esc(r.source)}` : ''}</p>
          <div class="row-actions">
            <button type="button" class="btn btn-sm" data-action="request-edit" data-id="${esc(r.id)}">${icon('edit')}Edit</button>
            <button type="button" class="btn btn-sm btn-danger-outline" data-action="request-delete" data-id="${esc(r.id)}">${icon('trash')}Delete…</button>
          </div>
        </div>
        <p class="request-text">${esc(r.text)}</p>
        ${r.reference || r.notes ? `<div class="request-extra">${r.reference ? `<p><span class="label-inline">Subject:</span> ${esc(r.reference)}</p>` : ''}${r.notes ? `<p><span class="label-inline">Your notes:</span> ${esc(r.notes)}</p>` : ''}</div>` : ''}
        <p class="stamp">Added to ScopeLens ${esc(fmtDateTime(r.createdAt))}${r.updatedAt !== r.createdAt ? ` · changed ${esc(fmtDateTime(r.updatedAt))}` : ''}</p>
      </li>`).join('')}</ol>`
    : emptyState({
      title: 'No client requests yet',
      text: 'Add a new request when your client asks for something.',
      action: `<button type="button" class="btn btn-primary" data-action="request-add">${icon('plus')}Add a client request</button>`,
    });
  return `${projectHeader(p, 'requests')}
    ${sectionHead('Client requests', 'Everything your client has asked for, oldest first. The dates are the ones you typed in. ScopeLens cannot check them with your email or chat app.',
      list.length ? `<button type="button" class="btn btn-primary" data-action="request-add">${icon('plus')}Add a client request</button>` : '')}
    ${body}`;
}

/* --------------------------------- compare --------------------------------- */

export function viewCompare(p, form = {}) {
  const reqs = sortedRequests(p);
  const mode = form.mode || 'requests';
  const selected = form.selected || new Set(reqs.map((r) => r.id));
  let body;
  if (!p.baseline) {
    body = emptyState({ title: 'Add the original agreement first', text: 'ScopeLens needs it to check new requests against.', action: `<a class="btn btn-primary" href="#/p/${esc(p.id)}/scope">Add agreement</a>` });
  } else {
    body = `<form class="card form" data-form="compare" novalidate>
      <h2>Start a comparison</h2>
      <p class="form-error" data-form-error role="alert" tabindex="-1"></p>
      <fieldset class="field"><legend>What do you want to compare?</legend>
        <div class="choices">
          <label class="choice"><input type="radio" name="mode" value="requests" ${mode === 'requests' ? 'checked' : ''}><span><strong>The agreement and some client requests</strong><span class="choice-help">Best for work that keeps changing. You pick the requests.</span></span></label>
          <label class="choice"><input type="radio" name="mode" value="manual" ${mode === 'manual' ? 'checked' : ''}><span><strong>A new version of the agreement</strong><span class="choice-help">Best if your client sent a changed document. You paste it in.</span></span></label>
        </div>
      </fieldset>
      <div data-section="requests" ${mode === 'requests' ? '' : 'hidden'}>
        ${reqs.length ? `<fieldset class="field"><legend>Which requests should we check?</legend>
          <div class="inline-actions"><button type="button" class="btn btn-sm" data-action="select-all-requests">Select all</button><button type="button" class="btn btn-sm" data-action="select-no-requests">Clear</button></div>
          <ul class="check-list">${reqs.map((r) => `<li><label class="choice"><input type="checkbox" name="requestIds" value="${esc(r.id)}" ${selected.has(r.id) ? 'checked' : ''}><span><strong>${esc(fmtDate(r.date))}${r.source ? ` · ${esc(r.source)}` : ''}</strong><span class="choice-help">${esc(truncate(r.text, 140))}</span></span></label></li>`).join('')}</ul>
          <p class="field-error" data-error-for="requests"></p></fieldset>`
        : `<div class="banner"><p>No client requests yet. <a href="#/p/${esc(p.id)}/requests">Add a client request</a> first, or choose “A new version of the agreement”.</p></div>`}
      </div>
      <div data-section="manual" ${mode === 'manual' ? '' : 'hidden'}>
        ${field({ id: 'cf-manual', name: 'manualText', label: 'New version of the agreement', type: 'textarea', rows: 10, value: form.manualText || '', required: true, hint: 'Paste the whole new version. ScopeLens compares it with the original, point by point.', attrs: 'maxlength="60000"' })}
      </div>
      <p class="note">${icon('info')}<span>ScopeLens looks for matching words and a few simple clues. It cannot read meaning, so treat the results as hints, not answers.</span></p>
      <div class="form-actions"><button class="btn btn-primary" type="submit">${icon('compare')}Compare</button></div>
    </form>`;
  }

  const prev = [...p.comparisons].reverse();
  const prevHtml = prev.length ? `<section class="card"><h2>Earlier comparisons</h2><ul class="plain-list">${prev.map((c) => `
    <li><div class="list-text"><strong>${esc(fmtDateTime(c.createdAt))}</strong><span class="muted">${esc(c.mode === 'manual' ? 'New version of the agreement' : plural(c.requests.length, 'client request'))} · ${esc(comparisonSummaryText(c))}</span></div>
    <div class="row-actions"><a class="btn btn-sm" href="#/p/${esc(p.id)}/c/${esc(c.id)}">Open</a><button type="button" class="btn btn-sm btn-danger-outline" data-action="comparison-delete" data-id="${esc(c.id)}" aria-label="Delete the comparison from ${esc(fmtDateTime(c.createdAt))}">${icon('trash')}Delete…</button></div></li>`).join('')}</ul></section>` : '';
  return `${projectHeader(p, 'compare')}
    ${sectionHead('Compare', 'Check new requests against the original agreement.')}
    ${body}${prevHtml}`;
}

/* --------------------------------- results --------------------------------- */

export const TYPE_FILTERS = [
  ['changes', 'All changes'],
  ['new', TYPE_LABELS.new],
  ['modified', TYPE_LABELS.modified],
  ['removed', TYPE_LABELS.removed],
  ['ambiguous', TYPE_LABELS.ambiguous],
  ['duplicate', TYPE_LABELS.duplicate],
  ['unchanged', TYPE_LABELS.unchanged],
  ['all', 'Everything'],
];
export const STATUS_FILTERS = [['all', 'Any'], ['pending', STATUS_LABELS.pending], ['relevant', STATUS_LABELS.relevant], ['irrelevant', STATUS_LABELS.irrelevant], ['clarify', STATUS_LABELS.clarify]];

export function summaryHtml(findings) {
  const s = summarizeFindings(findings);
  const tile = (n, label) => `<div class="stat"><div class="stat-n">${n}</div><div class="stat-l">${label}</div></div>`;
  return `<div class="summary" role="group" aria-label="Summary of results">
    ${tile(s.additions, 'May be new work')}${tile(s.modified, 'May change agreed work')}${tile(s.removals, 'May be removed')}${tile(s.clarify, 'Need clarification')}
  </div>
  <p class="muted small">${s.reviewed} of ${s.flagged} results reviewed${s.duplicates ? ` · ${s.duplicates} possibly already included` : ''}${s.unchanged ? ` · ${plural(s.unchanged, 'point')} with no change` : ''}</p>`;
}

export function filterFindings(findings, type, status) {
  return findings.filter((f) => {
    if (type === 'changes' && f.type === 'unchanged') return false;
    if (!['changes', 'all'].includes(type) && f.type !== type) return false;
    if (status !== 'all' && f.status !== status) return false;
    return true;
  });
}

const CONF = { high: 'High', medium: 'Medium', low: 'Low' };

function inlineDiff(chunks) {
  return chunks.map((c) => (c.type === 'add' ? `<ins>${esc(c.text)}</ins>` : c.type === 'del' ? `<del>${esc(c.text)}</del>` : esc(c.text))).join('');
}

export function findingCard(f, mode = 'requests') {
  const reviewable = f.type !== 'unchanged';
  const dec = (status, label) => `<button type="button" class="btn btn-sm decision" data-action="finding-status" data-fid="${esc(f.id)}" data-status="${status}" aria-pressed="${f.status === status}">${label}</button>`;
  const askLabel = mode === 'manual' ? 'New version' : 'What the client asked for';
  const askEmpty = mode === 'manual' ? 'Not in the new version' : 'Not mentioned';
  return `<article class="finding" id="finding-${esc(f.id)}" data-status="${esc(f.status)}" data-type="${esc(f.type)}" aria-labelledby="ft-${esc(f.id)}">
    <div class="finding-top"><span class="chip chip-type">${esc(TYPE_LABELS[f.type])}</span>
      ${reviewable ? `<span class="chip chip-status s-${esc(f.status)}">${esc(STATUS_LABELS[f.status])}</span>` : ''}</div>
    <h3 id="ft-${esc(f.id)}">${esc(f.title)}</h3>
    <div class="pair">
      <div class="col"><h4>${askLabel}</h4><p>${f.updated ? esc(f.updated) : `<span class="muted">${askEmpty}</span>`}</p></div>
      <div class="col"><h4>Original agreement</h4><p>${f.original ? esc(f.original) : '<span class="muted">Nothing in the agreement matches</span>'}</p></div>
    </div>
    ${f.diff && f.original && f.updated && f.source === null ? `<p class="inline-diff"><span class="label-inline">What changed:</span> ${inlineDiff(f.diff)}</p>` : ''}
    <div class="why-box">
      <p class="why"><span class="label-inline">Why we flagged this:</span> ${esc(f.reason)}</p>
      ${f.flags && f.flags.length ? `<ul class="flag-list">${f.flags.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${f.related ? `<p class="why"><span class="label-inline">The agreement may say this is not included:</span> ${esc(f.related.text)}</p>` : ''}
      ${f.closest && !f.original && !(f.related && f.related.text === f.closest.text) ? `<p class="why muted"><span class="label-inline">Closest part of the agreement (about ${Math.round(f.closest.similarity * 100)}% match):</span> ${esc(f.closest.text)}</p>` : ''}
    </div>
    <p class="meta-line">${f.source && f.source.label ? `${esc(f.source.label)} · ` : ''}Match strength: ${esc(CONF[f.confidence] || 'Medium')}<span class="sr-only">. This only shows how many words match. It is not a judgement.</span></p>
    ${reviewable ? `<div class="decision-block"><p class="decision-label" id="dl-${esc(f.id)}">What do you think?</p>
      <div class="decision-row" role="group" aria-labelledby="dl-${esc(f.id)}">${dec('relevant', 'Real change')}${dec('irrelevant', 'Not a change')}${dec('clarify', 'Ask the client')}</div></div>
      <details class="note-details" ${f.note ? 'open' : ''}><summary>${f.note ? 'Your note' : 'Add a note'}</summary>
        <div class="note-box"><label for="note-${esc(f.id)}" class="sr-only">Your note about “${esc(truncate(f.title, 60))}”</label>
        <textarea id="note-${esc(f.id)}" class="input" rows="3" maxlength="5000" data-role="note" data-fid="${esc(f.id)}" placeholder="For example: already included in my price, or agreed an extra fee on 12 Oct">${esc(f.note)}</textarea>
        <div><button type="button" class="btn btn-sm" data-action="note-save" data-fid="${esc(f.id)}">Save note</button></div></div></details>` : ''}
  </article>`;
}

export function findingsListHtml(findings, type, status, mode = 'requests') {
  const list = filterFindings(findings, type, status);
  if (!list.length) {
    const flagged = findings.filter((f) => f.type !== 'unchanged').length;
    if (!flagged && type === 'changes' && status === 'all') {
      return emptyState({ title: 'No changes found', text: 'Nothing here seems to go beyond the original agreement. ScopeLens only matches words, so it can miss a request that uses different words. Read the requests yourself too.' });
    }
    return emptyState({ title: 'Nothing to show', text: 'No results match these choices. Try changing “Show” or “Review”.' });
  }
  return `<div class="findings">${list.map((f) => findingCard(f, mode)).join('')}</div><p class="muted small" aria-live="polite">${plural(list.length, 'result')} shown.</p>`;
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
  return `<div class="stack">
    <div class="legend" aria-label="Key"><span><ins>Added words</ins></span><span><del>Removed words</del></span><span>Same words</span></div>
    <p class="muted small">${plural(s.added, 'word')} added · ${plural(s.removed, 'word')} removed · ${s.similarity}% of the words are the same. Capital letters, punctuation and line breaks are ignored.${s.approximate ? ' These texts are very long, so the middle part is shown as replaced.' : ''}</p>
    ${c.mode === 'requests' ? '<p class="muted small">Here the new text is the agreement followed by the requests you picked, so you will mostly see added words. To see removed or reworded parts, compare with a new version of the agreement.</p>' : ''}
    ${d.identical ? '<div class="empty-inline">The words are the same. Only capital letters, punctuation or spacing are different.</div>' : ''}
    <label class="choice inline"><input type="checkbox" data-role="show-all-text" ${showAll ? 'checked' : ''}><span>Show all the unchanged text too</span></label>
    <div class="diff" tabindex="0" aria-label="Word changes">${html}</div></div>`;
}

export function messageCardHtml(p, c) {
  return `<section class="card" aria-labelledby="msg-h"><div><h2 id="msg-h">Message to your client</h2>
    <p class="muted">A polite message based on your results. Change it however you like, then copy it. It does not say that any payment is owed.</p></div>
    <label class="sr-only" for="client-message">Message to your client</label>
    <textarea id="client-message" class="input message" rows="12" data-role="message">${esc(effectiveMessage(p, c))}</textarea>
    <div class="card-actions"><button type="button" class="btn btn-primary btn-sm" data-action="message-copy">${icon('copy')}Copy message</button><button type="button" class="btn btn-sm" data-action="message-reset">${icon('rotate')}Reset message</button></div></section>`;
}

export function viewResults(p, c, ui) {
  const modeLabel = c.mode === 'manual' ? 'Compared with a new version of the agreement' : `Checked ${plural(c.requests.length, 'client request')}`;
  return `${projectHeader(p, 'compare')}
    ${sectionHead('Results', `${esc(fmtDateTime(c.createdAt))} · ${esc(modeLabel)} · “${esc(c.baseline.title)}”${c.baseline.revision > 1 ? ` (version ${c.baseline.revision})` : ''}`,
      `<a class="btn btn-primary" href="#/p/${esc(p.id)}/c/${esc(c.id)}/report">${icon('report')}Create report</a>`)}
    <div class="banner"><p><strong>These results are hints, not answers.</strong> A request may already be included in your agreement, or in changes you already agreed. You decide what is extra work.</p></div>
    <div id="summary">${summaryHtml(c.findings)}</div>
    <div class="tabs tabs-inner" role="tablist" aria-label="Ways to see the results">
      <button type="button" role="tab" class="tab" data-action="results-tab" data-tab="findings" aria-selected="${ui.tab === 'findings'}">${icon('list')}<span>Results</span></button>
      <button type="button" role="tab" class="tab" data-action="results-tab" data-tab="text" aria-selected="${ui.tab === 'text'}">${icon('compare')}<span>Word changes</span></button>
    </div>
    <div id="panel-findings" class="stack" ${ui.tab === 'findings' ? '' : 'hidden'}>
      <div class="filters">
        <div class="field"><label for="filter-type">Show</label><select id="filter-type" class="input" data-role="filter-type">${TYPE_FILTERS.map(([v, l]) => `<option value="${v}" ${ui.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label for="filter-status">Review</label><select id="filter-status" class="input" data-role="filter-status">${STATUS_FILTERS.map(([v, l]) => `<option value="${v}" ${ui.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div id="findings-list" class="stack">${findingsListHtml(c.findings, ui.type, ui.status, c.mode)}</div>
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
      ? `<p class="muted small">The client sent it on ${esc(fmtDate(m.receivedDate))}${m.source ? ` (${esc(m.source)})` : ''}, as you entered it. Added to ScopeLens ${esc(fmtDateTime(e.at))}.</p>` : '';
    return `<li><span class="tl-mark" aria-hidden="true"></span><div class="tl-body"><p class="tl-title"><strong>${esc(historyLabel(e.type))}</strong> <span class="muted small">${esc(fmtDateTime(e.at))}</span></p><p>${esc(e.text)}</p>${extra}</div></li>`;
  }).join('')}</ol></section>`).join('') : emptyState({ title: 'No history yet', text: 'What happens in this project will be listed here.' });
  return `${projectHeader(p, 'history')}
    ${sectionHead('History', 'Everything that happened in this project, newest first. Times come from this device. Dates for client requests are the ones you typed in. ScopeLens cannot check them.')}${body}`;
}

/* ---------------------------------- report ---------------------------------- */

export function viewReportShell(p, c, reportHtml) {
  return `<div class="no-print stack">${projectHeader(p, 'compare')}
    ${sectionHead('Report for your client', 'A clean page you can share. To save a PDF, tap Print and choose “Save as PDF”.',
      `<a class="btn btn-sm" href="#/p/${esc(p.id)}/c/${esc(c.id)}">${icon('chevron-left')}Back to results</a>`)}
    <div class="toolbar report-tools">
      <button type="button" class="btn btn-primary" data-action="report-print">${icon('report')}Print or save as PDF</button>
      <button type="button" class="btn" data-action="report-download-html">${icon('download')}Download as web page</button>
      <button type="button" class="btn" data-action="report-download-json">${icon('download')}Download data (JSON)</button>
    </div></div>
    <div class="report-frame">${reportHtml}</div>`;
}

/* ---------------------------------- backups ---------------------------------- */

export function viewData({ count, hasDemo, mode, modeError, persist, importResult }) {
  const fmtBytes = (n) => (n == null ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  return `${pageHead('Backups', { sub: 'Your projects are saved only in this browser. Download a backup so you can restore them later.' })}
    <section class="card"><div><h2>Download a backup</h2>
      <p class="muted">Saves all your projects (${count}) in one file. Keep the file somewhere private. It is plain text and is not locked with a password.</p></div>
      <div class="card-actions"><button type="button" class="btn btn-primary" data-action="export-all" ${count ? '' : 'disabled'}>${icon('download')}Download all projects</button></div>
      ${count ? '' : '<p class="muted small">You have no projects to download yet.</p>'}</section>
    <section class="card"><div><h2>Restore a backup</h2>
      <p class="muted">Choose a ScopeLens backup file. It is checked first. Nothing you already have is replaced. If a project is already here, the restored one is added as a copy.</p></div>
      <div class="field"><label for="import-file">Backup file (.json)</label><input id="import-file" class="input" type="file" accept=".json,application/json" data-role="import-file"></div>
      <div id="import-result" aria-live="polite">${importResult || ''}</div></section>
    <section class="card"><h2>Where your projects are kept</h2>
      <ul class="plain-bullets">
        <li>${mode === 'indexeddb' ? 'Your projects are saved in this browser. They are still here after you refresh or restart.' : `<strong>Your projects are only held in memory right now.</strong> Your browser did not allow saving${modeError ? ` (${esc(modeError)})` : ''}, so they will disappear when you close or refresh this page. Download a backup often.`}</li>
        <li>Clearing browser data, private browsing, or losing this device can delete your projects. Browser storage is not a safe backup.</li>
        <li>Nothing you type is sent to any server. There are no trackers.</li>
      </ul>
      ${persist.supported ? `<p>Extra protection from the browser: <strong>${persist.persisted ? 'on' : 'off'}</strong>${persist.usage != null ? ` · using ${esc(fmtBytes(persist.usage))}` : ''}</p>
        ${persist.persisted ? '' : '<div class="card-actions"><button type="button" class="btn btn-sm" data-action="persist-request">Ask the browser to keep my projects</button></div>'}` : '<p class="muted">This browser does not say whether it will keep your projects.</p>'}</section>
    <section class="card"><div><h2>Sample project</h2>
      <p class="muted">Try ScopeLens with a made-up project. It is labelled “Sample project” and kept apart from your real work. You can remove it in one tap.</p></div>
      <div class="card-actions"><button type="button" class="btn" data-action="demo-load">Add the sample project</button>
        <button type="button" class="btn btn-danger-outline" data-action="demo-remove" ${hasDemo ? '' : 'disabled'}>${icon('trash')}Remove the sample project…</button></div></section>`;
}

/* ---------------------------------- about ---------------------------------- */

export function viewAbout() {
  return `${pageHead('How it works', { sub: 'What ScopeLens does, how it finds changes, and where it can be wrong.' })}
    <section class="card"><h2>Six simple steps</h2>
      <ol class="plain-bullets"><li>Create a project.</li><li>Add the original agreement: what you and your client agreed to do.</li><li>Add each new request from your client.</li><li>Compare the requests with the agreement.</li><li>Review the results. Say if each one is a real change, not a change, or something to ask your client.</li><li>Create a report to talk it through with your client.</li></ol></section>
    <section class="card"><h2>How ScopeLens finds changes</h2>
      <p class="muted">Everything happens in your browser, with fixed rules. There is no AI, and no project data is uploaded.</p>
      <ul class="plain-bullets">
        <li><strong>Word changes</strong> compares the words in two texts. It ignores capital letters, punctuation and line breaks, so a tidy-up is not counted as a change.</li>
        <li><strong>Results</strong> split the agreement and the requests into separate points, then match points that share many key words.</li>
        <li>Words like “remove”, “drop”, “change to” and “instead of” help link a request to the part of the agreement it may affect.</li>
        <li>Vague words like “etc”, “as needed” or “improve” are marked as unclear.</li>
        <li>If a request mentions something your agreement says is <em>not</em> included, ScopeLens shows that sentence next to it.</li>
      </ul></section>
    <section class="card"><h2>What ScopeLens cannot do</h2>
      <ul class="plain-bullets">
        <li>It matches words, not meaning. Different words for the same thing can look new. Similar words for different things can look the same.</li>
        <li>If one sentence holds several requests, it is treated as one.</li>
        <li>“Match strength” only shows how many words match. It is not a judgement.</li>
        <li>A result never means your client is wrong, or that extra payment is owed. A request may already be included in the agreement. You decide.</li>
        <li>It cannot check when a message was really sent. Dates are the ones you type in.</li>
      </ul></section>
    <section class="card"><h2>Privacy</h2>
      <p>Your projects are saved only in this browser. The page is blocked from talking to other websites. Only paste things you are allowed to keep. Browser storage is not locked with a password, so download backups and keep them private.</p></section>`;
}

export function viewNotFound(text = 'That page or project could not be found.') {
  return `${pageHead('Page not found')}${emptyState({ title: 'We could not find that', text: esc(text), action: `<a class="btn btn-primary" href="#/">Back to the dashboard</a>` })}`;
}
