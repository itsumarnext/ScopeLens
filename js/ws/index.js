// ws/index.js — the workspace: routing, event wiring and the header. Loaded by app.js.

import * as S from '../store.js';
import { esc, icon } from './ui.js';
import { refresh, takeKeepScroll, toast } from './core.js';
import * as dashboard from './dashboard.js';
import * as clients from './clients.js';
import * as projects from './projects.js';
import * as payments from './payments.js';
import * as agreements from './agreements.js';
import * as tasks from './tasks.js';
import * as ai from './ai.js';
import * as settings from './settings.js';
import * as help from './help.js';

const MODULES = { clients, projects, payments, agreements, tasks, ai, settings, help };
const ROUTES = { '': dashboard, ...MODULES };

const merged = (key) => Object.assign({}, dashboard[key], ...Object.values(MODULES).map((m) => m[key] || {}));
const ACTIONS = { ...merged('actions'), 'ws-dismiss-banner': () => { S.session.set('banner-dismissed', true); document.getElementById('ws-banner')?.remove(); } };
const FORMS = merged('forms');
const LISTS = merged('lists');
const CHANGES = merged('changes');
const INPUTS = merged('inputs');
const DROPS = merged('drops');

/* ------------------------------------- routing ------------------------------------- */

export function owns(parts) {
  const first = (parts[0] || '').split('?')[0];
  if (!first) return true;
  if (first === 'ai' && (parts[1] || '').split('?')[0] === 'classic') return false;
  return first in ROUTES || first === 'settings' || first === 'help' || first === 'ai';
}

function parseHash() {
  const raw = (location.hash || '#/').replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  return { parts: path.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(qs)) };
}

function banner() {
  const h = S.storageHealth();
  if (!h.message || S.session.get('banner-dismissed', false)) return '';
  return `<div class="banner" id="ws-banner" role="alert"><p>${esc(h.message)}</p><button type="button" class="btn btn-sm" data-action="ws-dismiss-banner">Dismiss</button></div>`;
}

export async function render() {
  const { parts, query } = parseHash();
  const mod = parts.length ? ROUTES[parts[0]] : dashboard;
  let out = null;
  if (mod) out = await mod.render(parts, query);
  if (!out) return { html: `<div class="page-head"><h1>Page not found</h1></div><div class="empty"><h2>We could not find that page</h2><p>The link may be old, or the record may have been deleted.</p><a class="btn" href="#/">Go to the dashboard</a></div>`, title: 'Not found', nav: '', keepScroll: false };
  return { ...out, html: `${banner()}${out.html}`, keepScroll: takeKeepScroll() };
}

/* ------------------------------------- header ------------------------------------- */

export const quickItems = [
  { label: 'Add client', href: '#/clients/add', icon: 'users' },
  { label: 'Create project', href: '#/projects/new', icon: 'briefcase' },
  { label: 'Record payment', action: 'txn-new', icon: 'wallet' },
  { label: 'Add agreement', href: '#/agreements/add', icon: 'file' },
  { label: 'Create task', action: 'task-new', icon: 'tasks' },
  { label: 'Compare client request', href: '#/ai', icon: 'spark' },
];

function drawHeader() {
  const host = document.getElementById('quick-add');
  if (host) {
    host.innerHTML = `<details class="menu quick"><summary class="btn btn-primary btn-sm" aria-label="Quick add">${icon('plus')}<span>Quick add</span></summary><div class="menu-list">${quickItems.map((i) => (i.href
      ? `<a class="menu-item" href="${i.href}">${icon(i.icon)}${esc(i.label)}</a>`
      : `<button type="button" class="menu-item" data-action="${i.action}">${icon(i.icon)}${esc(i.label)}</button>`)).join('')}</div></details>`;
  }
  const chip = document.getElementById('storage-chip');
  if (chip) {
    const h = S.storageHealth();
    chip.textContent = h.mode === 'memory' ? 'Not saved (private mode)' : 'Saved in this browser';
    chip.classList.toggle('chip-warn', h.mode === 'memory');
  }
}

/* ------------------------------------ events ------------------------------------ */

function wire() {
  document.addEventListener('click', async (e) => {
    const dlgLink = e.target.closest('dialog a[href^="#/"]');
    if (dlgLink) dlgLink.closest('dialog').close();
    const jump = e.target.closest('[data-jump]');
    if (jump) { e.preventDefault(); document.getElementById(jump.dataset.jump)?.scrollIntoView({ block: 'start' }); return; }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = ACTIONS[el.dataset.action];
    if (!fn) return;
    if (el.tagName === 'A') e.preventDefault();
    const dlg = el.closest('dialog');
    if (dlg && el.dataset.action !== 'copy-text') dlg.close();
    document.querySelectorAll('details.menu[open]').forEach((d) => { d.open = false; });
    try { await fn(el, e); } catch (err) { console.error(err); toast('Something went wrong. Please try again.', { error: true }); }
  });

  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-form]');
    const fn = form && FORMS[form.dataset.form];
    if (!fn) return;
    e.preventDefault();
    try { await fn(form); } catch (err) { console.error(err); toast('Something went wrong. Please try again.', { error: true }); }
  });

  const filterEvent = (e) => {
    const t = e.target;
    if (t.matches && t.matches('[data-role="filter"]')) {
      import('./ui.js').then(({ setListState }) => {
        setListState(t.dataset.list, { [t.dataset.key]: t.value });
        const region = document.getElementById(`list-${t.dataset.list}`);
        if (region && LISTS[t.dataset.list]) region.innerHTML = LISTS[t.dataset.list]();
      });
      return true;
    }
    return false;
  };
  document.addEventListener('input', async (e) => {
    if (filterEvent(e)) return;
    const fn = e.target.dataset && INPUTS[e.target.dataset.role];
    if (fn) { try { await fn(e.target, e); } catch (err) { console.error(err); } }
  });
  document.addEventListener('change', async (e) => {
    const fn = e.target.dataset && CHANGES[e.target.dataset.role];
    if (fn) { try { await fn(e.target, e); } catch (err) { console.error(err); toast('Something went wrong. Please try again.', { error: true }); } }
  });

  // Drag and drop (the project board also has a "Move to" menu on every card, so dragging is optional).
  document.addEventListener('dragstart', (e) => {
    const d = e.target.closest && e.target.closest('[data-drag]');
    if (!d) return;
    e.dataTransfer.setData('text/plain', d.dataset.drag);
    e.dataTransfer.effectAllowed = 'move';
  });
  document.addEventListener('dragover', (e) => {
    const z = e.target.closest && e.target.closest('[data-drop]');
    if (!z) return;
    e.preventDefault();
    z.classList.add('drop-over');
  });
  document.addEventListener('dragleave', (e) => { e.target.closest && e.target.closest('[data-drop]')?.classList.remove('drop-over'); });
  document.addEventListener('drop', async (e) => {
    const z = e.target.closest && e.target.closest('[data-drop]');
    if (!z) return;
    e.preventDefault();
    z.classList.remove('drop-over');
    const fn = DROPS[z.dataset.dropKind];
    if (fn) await fn(e.dataTransfer.getData('text/plain'), z.dataset.drop);
  });

  // Another browser tab saved something: reload so this tab never overwrites it with stale data.
  window.addEventListener('storage', (e) => {
    if (e.key === S.DATA_KEY || e.key === null) { S.init(); refresh(); drawHeader(); }
  });
}

export function init() {
  const health = S.init();
  drawHeader();
  wire();
  return health;
}

export { refresh };
