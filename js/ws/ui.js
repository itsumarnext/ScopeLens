// ws/ui.js — shared building blocks for the workspace screens: fields, tables, badges, tabs, menus, links.

import { esc } from '../utils.js';
import { icon } from '../ui.js';
import { byId } from '../domain.js';
import { session } from '../store.js';
import * as fmt from '../fmt.js';

export { esc, icon, fmt };

/* ---------------------------- screen state (sessionStorage) ---------------------------- */

/** Search text, filters and sort order for a list. Kept for this browser tab only. */
export function listState(name, defaults = {}) {
  return { ...defaults, ...((session.get('lists', {}) || {})[name] || {}) };
}
export function setListState(name, patch) {
  const all = session.get('lists', {}) || {};
  all[name] = { ...(all[name] || {}), ...patch };
  session.set('lists', all);
}

/* --------------------------------------- forms --------------------------------------- */

export const options = (list, selected = '') => list.map((o) => {
  const v = typeof o === 'string' ? o : o.value;
  const l = typeof o === 'string' ? o : o.label;
  return `<option value="${esc(v)}"${String(v) === String(selected) ? ' selected' : ''}>${esc(l)}</option>`;
}).join('');

/**
 * One labelled form field with its hint above the control and its error below it.
 * kind: text | email | tel | date | money | number | textarea | select
 */
export function field({ id, name, label, kind = 'text', value = '', required = false, hint = '', placeholder = '', list = [], rows = 3, max, extra = '', blank = null, tag = '' }) {
  const fid = id || `f-${name}`;
  const described = `${fid}-error${hint ? ` ${fid}-hint` : ''}`;
  const common = `id="${fid}" name="${name}" class="input" aria-describedby="${described}"${required ? ' aria-required="true"' : ''}`;
  let control;
  if (kind === 'textarea') control = `<textarea ${common} rows="${rows}"${max ? ` maxlength="${max}"` : ''}${placeholder ? ` placeholder="${esc(placeholder)}"` : ''} ${extra}>${esc(value)}</textarea>`;
  else if (kind === 'select') control = `<select ${common} ${extra}>${blank !== null ? `<option value="">${esc(blank)}</option>` : ''}${options(list, value)}</select>`;
  else {
    const type = { money: 'text', email: 'email', tel: 'tel', date: 'date', number: 'text' }[kind] || 'text';
    const mode = kind === 'money' ? ' inputmode="decimal"' : kind === 'number' ? ' inputmode="numeric"' : '';
    control = `<input ${common} type="${type}"${mode} value="${esc(value)}"${max ? ` maxlength="${max}"` : ''}${placeholder ? ` placeholder="${esc(placeholder)}"` : ''} autocomplete="off" ${extra}>`;
  }
  return `<div class="field"><label for="${fid}">${esc(label)}${required ? '<span class="req"> (required)</span>' : '<span class="opt"> (optional)</span>'}${tag}</label>${hint ? `<p class="hint" id="${fid}-hint">${esc(hint)}</p>` : ''}${control}<p class="field-error" id="${fid}-error" data-error-for="${name}"></p></div>`;
}

export const formError = () => '<p class="form-error" data-form-error role="alert" tabindex="-1"></p>';
export const row2 = (a, b) => `<div class="field-row">${a}${b}</div>`;

/* -------------------------------------- display -------------------------------------- */

const TONES = {
  Overdue: 'alert', Expired: 'alert', Lost: 'muted', Cancelled: 'muted', Draft: 'muted', Archived: 'muted', Inactive: 'muted', Rejected: 'muted',
  Paid: 'done', Completed: 'done', Done: 'done', Won: 'done', Approved: 'done',
  'Partially Paid': 'accent', Active: 'accent', 'In Progress': 'accent', Discussing: 'accent', Contacted: 'accent', 'Proposal Sent': 'accent', Negotiation: 'accent',
  'Expiring Soon': 'warn', 'Needs Review': 'warn', 'On Hold': 'warn', High: 'alert',
};
export const badge = (text, tone) => `<span class="badge badge-${tone || TONES[text] || 'plain'}">${esc(text)}</span>`;

export function pageHead({ title, sub = '', actions = '' }) {
  return `<div class="page-head"><div class="page-head-row"><div class="page-head-text"><h1>${esc(title)}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}</div>${actions ? `<div class="head-actions">${actions}</div>` : ''}</div></div>`;
}

export function tabsNav(tabs, active, label = 'Sections') {
  return `<nav class="tabs" aria-label="${esc(label)}">${tabs.map((t) => `<a class="tab" href="${t.href}"${t.key === active ? ' aria-current="page"' : ''}>${t.icon ? icon(t.icon) : ''}${esc(t.label)}</a>`).join('')}</nav>`;
}

export const sectionHead = (title, sub = '', actions = '') =>
  `<div class="section-head"><div class="section-head-text"><h2>${esc(title)}</h2>${sub ? `<p class="muted">${esc(sub)}</p>` : ''}</div>${actions ? `<div class="card-actions">${actions}</div>` : ''}</div>`;

export const empty = ({ title, text = '', action = '' }) =>
  `<div class="empty"><h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}${action}</div>`;

export const card = (inner, cls = '') => `<section class="card ${cls}">${inner}</section>`;

export function menu(items, label = 'More actions') {
  return `<details class="menu"><summary class="icon-btn" aria-label="${esc(label)}">${icon('more')}</summary><div class="menu-list">${items.map((i) => (i.href
    ? `<a class="menu-item" href="${i.href}">${i.icon ? icon(i.icon) : ''}${esc(i.label)}</a>`
    : `<button type="button" class="menu-item${i.danger ? ' danger' : ''}" data-action="${i.action}" data-id="${esc(i.id || '')}"${i.extra || ''}>${i.icon ? icon(i.icon) : ''}${esc(i.label)}</button>`)).join('')}</div></details>`;
}

/**
 * A table that turns into stacked cards on phones. cols: [{ key, label, cell(row), sort }]
 * Header buttons for sortable columns use data-action="sort".
 */
export function table({ list, cols, rows, sort, empty: emptyHtml = '', caption = '' }) {
  if (!rows.length) return emptyHtml;
  const head = cols.map((c) => {
    if (!c.sort) return `<th scope="col"${c.cls ? ` class="${c.cls}"` : ''}>${esc(c.label)}</th>`;
    const on = sort && sort.key === c.key;
    return `<th scope="col" aria-sort="${on ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'}"${c.cls ? ` class="${c.cls}"` : ''}><button type="button" class="th-sort" data-action="sort" data-list="${list}" data-key="${c.key}">${esc(c.label)}<span aria-hidden="true">${on ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}</span></button></th>`;
  }).join('');
  const body = rows.map((r) => `<tr>${cols.map((c, i) => `<td data-label="${esc(c.label)}"${c.cls ? ` class="${c.cls}"` : ''}>${c.cell(r)}</td>`).join('')}</tr>`).join('');
  return `<div class="table-wrap"><table class="table">${caption ? `<caption class="sr-only">${esc(caption)}</caption>` : ''}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Applies a saved sort to rows using getters: { key: (row) => comparable } */
export function sortRows(rows, sort, getters) {
  if (!sort || !getters[sort.key]) return rows;
  const g = getters[sort.key];
  const dir = sort.dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = g(a); const y = g(b);
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
    return String(x ?? '').localeCompare(String(y ?? ''), undefined, { sensitivity: 'base', numeric: true }) * dir;
  });
}

export function nextSort(current, key) {
  if (current && current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: 'asc' };
}

/** Search box and filter selects for a list. Changes re-draw only the list region. */
export function filterBar(list, st, { placeholder = 'Search', selects = [], extra = '' } = {}) {
  return `<div class="filter-bar" role="search">
    <div class="search"><label class="sr-only" for="q-${list}">${esc(placeholder)}</label>${icon('search')}<input id="q-${list}" class="input" type="search" data-role="filter" data-list="${list}" data-key="q" value="${esc(st.q || '')}" placeholder="${esc(placeholder)}" autocomplete="off"></div>
    ${selects.map((s) => `<div class="filter-select"><label for="f-${list}-${s.key}">${esc(s.label)}</label><select id="f-${list}-${s.key}" class="input" data-role="filter" data-list="${list}" data-key="${s.key}">${options(s.options, st[s.key] ?? 'all')}</select></div>`).join('')}
    ${extra}</div>`;
}

/* ----------------------------------- links to records ----------------------------------- */

const gone = (what) => `<span class="muted">${what} (deleted)</span>`;
export const clientLink = (db, id) => {
  if (!id) return '<span class="muted">—</span>';
  const c = byId(db.clients, id);
  return c ? `<a href="#/clients/history/${esc(c.id)}">${esc(c.name)}</a>` : gone('Client');
};
export const projectLink = (db, id) => {
  if (!id) return '<span class="muted">—</span>';
  const p = byId(db.projects, id);
  return p ? `<a href="#/projects/details/${esc(p.id)}">${esc(p.name)}</a>` : gone('Project');
};
export const agreementLink = (db, id) => {
  if (!id) return '<span class="muted">—</span>';
  const a = byId(db.agreements, id);
  return a ? `<a href="#/agreements/details/${esc(a.id)}">${esc(a.title)}</a>` : gone('Agreement');
};

/** <option> list of clients (archived ones only when already selected). */
export const clientOptions = (db, selected = '') => db.clients
  .filter((c) => c.status !== 'Archived' || c.id === selected)
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((c) => ({ value: c.id, label: c.company ? `${c.name} — ${c.company}` : c.name }));
export const projectOptions = (db, clientId = '', selected = '') => db.projects
  .filter((p) => (!clientId || p.clientId === clientId) && (!p.archived || p.id === selected))
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((p) => ({ value: p.id, label: p.name }));
export const agreementOptions = (db, clientId = '') => db.agreements
  .filter((a) => !clientId || a.clientId === clientId)
  .sort((a, b) => a.title.localeCompare(b.title))
  .map((a) => ({ value: a.id, label: a.title }));

export const dl = (pairs) => `<dl class="kv">${pairs.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v === '' || v == null ? '<span class="muted">—</span>' : v}</dd>`).join('')}</dl>`;
export const text = (s) => (s ? `<span class="pre">${esc(s)}</span>` : '');
export const progressBar = (n) => `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${n}" aria-label="Progress"><span style="width:${Math.max(0, Math.min(100, n))}%"></span></div><span class="small muted">${n}%</span>`;
