// app.js — router, state and event handling. Everything runs locally in the browser.

import * as storage from './storage.js';
import * as P from './projects.js';
import {
  esc, slugify, todayDate, downloadFile, copyToClipboard, plural, fmtDate,
} from './utils.js';
import {
  toast, confirmDialog, infoDialog, formDialog, showFieldErrors, readForm, icon,
} from './ui.js';
import * as V from './views.js';
import * as WS from './ws/index.js';
import * as Auth from './auth/index.js';
import { aiTabs } from './ws/ai.js';
import {
  buildReportBody, buildReportDocument, buildReportJSON, effectiveMessage, REPORT_CSS,
} from './report.js';

const view = document.getElementById('view');

const state = {
  all: [],
  query: '',
  showArchived: false,
  project: null,
  comparison: null,
  editingScope: false,
  compareForm: { mode: 'requests', selected: null, manualText: '' },
  results: { cid: null, tab: 'findings', type: 'changes', status: 'all', showAllText: false },
  importResult: '',
  storageBanner: '',
};

/* ------------------------------ plumbing ------------------------------ */

function injectReportCss() {
  if (document.getElementById('report-css')) return;
  const s = document.createElement('style');
  s.id = 'report-css';
  s.textContent = REPORT_CSS;
  document.head.appendChild(s);
}

function setView(html, { title, nav = 'ai', report = false, keepScroll = false } = {}) {
  view.innerHTML = html;
  document.title = title ? `${title} · WorkSphare` : 'WorkSphare';
  document.body.classList.toggle('report-view', report);
  document.querySelectorAll('.sidebar .nav-link').forEach((a) => {
    if (a.dataset.nav === (nav && !nav.startsWith('#') ? nav : 'ai')) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (!keepScroll) {
    window.scrollTo(0, 0);
    view.focus({ preventScroll: true });
  }
}

function closeNav() {
  document.body.classList.remove('nav-open');
  document.getElementById('navToggle')?.setAttribute('aria-expanded', 'false');
  const scrim = document.querySelector('.scrim');
  if (scrim) scrim.hidden = true;
}

function openNav() {
  document.body.classList.add('nav-open');
  document.getElementById('navToggle')?.setAttribute('aria-expanded', 'true');
  const scrim = document.querySelector('.scrim');
  if (scrim) scrim.hidden = false;
  document.querySelector('.sidebar .nav-link')?.focus();
}

async function persist(project) {
  try {
    await storage.saveProject(project);
    return true;
  } catch (e) {
    toast(`Could not save. ${storage.describeError(e)}`, { error: true });
    return false;
  }
}

/** Applies fn to a project, saves it, and re-loads from storage if saving failed. */
async function mutate(project, fn) {
  let out;
  try {
    out = fn(project);
  } catch (e) {
    toast('Something went wrong. Nothing was changed.', { error: true });
    return { ok: false };
  }
  if (!(await persist(project))) {
    await route();
    return { ok: false };
  }
  return { ok: true, out };
}

const go = (hash) => { location.hash = hash; };

/* -------------------------------- routing -------------------------------- */

async function route() {
  closeNav();
  const parts = (location.hash || '#/').replace(/^#\/?/, '').split('/').filter(Boolean);
  const gate = await Auth.guard(parts);
  if (gate && gate.redirect) { if (location.hash !== gate.redirect) location.replace(gate.redirect); return; }
  document.body.classList.toggle('auth-view', !!(gate && gate.auth));
  if (gate && gate.html) {
    setView(gate.html, { title: gate.title, nav: gate.nav || '' });
    Auth.afterRender(parts);
    return;
  }
  try {
    await render(parts);
  } catch (e) {
    console.error(e);
    setView(V.viewNotFound('Something went wrong while opening this page. Your projects have not been changed.'), { title: 'Error' });
  }
}

async function render(parts) {
  if (WS.owns(parts)) {
    const r = await WS.render();
    if (r.report) injectReportCss();
    return setView(r.html, { title: r.title, nav: r.nav, report: !!r.report, keepScroll: r.keepScroll });
  }
  if (parts[0] === 'ai' && parts[1] === 'classic') return renderDashboard();
  if (parts[0] === 'new') return setView(V.viewNewProject(), { title: 'Create a project', nav: '#/new' });
  if (parts[0] === 'data') return renderData();
  if (parts[0] === 'about') return setView(V.viewAbout(), { title: 'How it works', nav: '#/about' });
  if (parts[0] === 'p' && parts[1]) return renderProject(parts);
  return setView(V.viewNotFound(), { title: 'Not found' });
}

async function renderDashboard() {
  state.all = await storage.getAllProjects();
  setView(aiTabs('classic') + V.viewDashboard({
    all: state.all,
    query: state.query,
    showArchived: state.showArchived,
    storageBanner: state.storageBanner,
    showBackupNote: storage.prefs.get('backupNoteDismissed') !== '1',
  }), { title: 'Classic projects', nav: 'ai' });
}

async function renderData() {
  state.all = await storage.getAllProjects();
  const persist = await storage.persistenceInfo();
  setView(V.viewData({
    count: state.all.length,
    hasDemo: state.all.some((p) => p.isDemo),
    mode: storage.storageMode(),
    modeError: storage.storageInitError(),
    persist,
    importResult: state.importResult,
  }), { title: 'Backups', nav: '#/data' });
}

async function renderProject(parts) {
  const project = await storage.getProject(parts[1]);
  if (!project) return setView(V.viewNotFound('This project is not in this browser. It may have been deleted, or it may be saved in a different browser.'), { title: 'Not found' });
  state.project = project;
  const sub = parts[2] || '';
  const title = project.name;
  if (sub === '') return setView(V.viewOverview(project), { title });
  if (sub === 'scope') return setView(V.viewScope(project, state.editingScope), { title: `Agreement · ${title}` });
  if (sub === 'requests') return setView(V.viewRequests(project), { title: `Client requests · ${title}` });
  if (sub === 'history') return setView(V.viewHistory(project), { title: `History · ${title}` });
  if (sub === 'compare') {
    if (!state.compareForm.selected) state.compareForm.selected = new Set(project.requests.map((r) => r.id));
    return setView(V.viewCompare(project, state.compareForm), { title: `Compare · ${title}` });
  }
  if (sub === 'c' && parts[3]) {
    const c = P.getComparison(project, parts[3]);
    if (!c) return setView(V.viewNotFound('That comparison is no longer here.'), { title: 'Not found' });
    state.comparison = c;
    if (state.results.cid !== c.id) state.results = { cid: c.id, tab: 'findings', type: 'changes', status: 'all', showAllText: false };
    if (parts[4] === 'report') {
      injectReportCss();
      return setView(V.viewReportShell(project, c, buildReportBody(project, c)), { title: `Report · ${title}`, report: true });
    }
    return setView(V.viewResults(project, c, state.results), { title: `Results · ${title}` });
  }
  return setView(V.viewNotFound(), { title: 'Not found' });
}

const rerender = () => route();

/* ------------------------------- actions ------------------------------- */

const needProject = () => state.project;

async function projectById(id) {
  if (state.project && state.project.id === id) return state.project;
  return storage.getProject(id);
}

const actions = {
  'toggle-nav': () => (document.body.classList.contains('nav-open') ? closeNav() : openNav()),
  'close-nav': closeNav,

  'dismiss-backup-note': () => {
    storage.prefs.set('backupNoteDismissed', '1');
    document.getElementById('backup-note')?.remove();
  },

  'list-filter': (el) => {
    state.showArchived = el.dataset.value === 'archived';
    renderDashboard();
  },

  /* ---- projects ---- */
  'project-rename': async (el) => {
    const p = await projectById(el.dataset.id);
    if (!p) return;
    const done = await formDialog({
      title: 'Rename this project',
      submitLabel: 'Rename',
      bodyHtml: `<div class="field"><label for="rn-name">Project name<span class="req"> (required)</span></label><input id="rn-name" class="input" name="name" maxlength="120" value="${esc(p.name)}" aria-required="true" aria-describedby="rn-error" autocomplete="off"><p class="field-error" id="rn-error" data-error-for="name"></p></div>`,
      onSubmit: async (v) => {
        const r = P.validateProjectFields({ ...p, name: v.name });
        if (r.errors.name) return { errors: { name: r.errors.name } };
        const res = await mutate(p, (x) => P.applyProjectFields(x, { ...r.values, client: x.client, description: x.description, startDate: x.startDate, budget: x.budget === '' ? '' : String(x.budget), currency: x.currency }));
        if (!res.ok) return { errors: { _form: 'Could not save the new name. Please try again.' } };
        return true;
      },
    });
    if (done) { toast('Project renamed.'); rerender(); }
  },

  'project-edit': async (el) => {
    const p = await projectById(el.dataset.id);
    if (!p) return;
    const done = await formDialog({
      title: 'Edit project details',
      submitLabel: 'Save changes',
      bodyHtml: V.projectFields({ ...p, budget: p.budget === '' ? '' : String(p.budget) }),
      onSubmit: async (v) => {
        const r = P.validateProjectFields(v);
        if (!r.ok) return { errors: r.errors };
        const res = await mutate(p, (x) => P.applyProjectFields(x, r.values));
        if (!res.ok) return { errors: { _form: 'Could not save your changes. Please try again.' } };
        return true;
      },
    });
    if (done) { toast('Changes saved.'); rerender(); }
  },

  'project-archive': async (el) => {
    const p = await projectById(el.dataset.id);
    if (!p) return;
    const res = await mutate(p, (x) => P.setArchived(x, true));
    if (res.ok) { toast('Project archived. You can find it under “Archived”.'); rerender(); }
  },

  'project-restore': async (el) => {
    const p = await projectById(el.dataset.id);
    if (!p) return;
    const res = await mutate(p, (x) => P.setArchived(x, false));
    if (res.ok) { toast('Project moved back to your projects.'); rerender(); }
  },

  'project-delete': async (el) => {
    const p = await projectById(el.dataset.id);
    if (!p) return;
    const ok = await confirmDialog({
      title: `Delete “${p.name}”?`,
      message: 'This deletes the project for good, with its agreement, client requests, results and history. You cannot undo this. Download a backup first if you might need it.',
      confirmLabel: 'Delete project',
      danger: true,
    });
    if (!ok) return;
    try {
      await storage.deleteProject(p.id);
    } catch (e) {
      toast(`Could not delete. ${storage.describeError(e)}`, { error: true });
      return;
    }
    if (state.project && state.project.id === p.id) state.project = null;
    toast('Project deleted.');
    if ((location.hash || '') === '#/ai/classic') rerender(); else go('#/ai/classic');
  },

  'project-export': async (el) => {
    const p = await projectById(el.dataset.id);
    if (!p) return;
    const res = await mutate(p, (x) => P.logDataExport(x));
    if (!res.ok) return;
    downloadFile(`worksphare-${slugify(p.name)}-${todayDate()}.json`, JSON.stringify(P.exportEnvelope([p]), null, 2), 'application/json');
    toast('Project backup downloaded.');
  },

  /* ---- baseline ---- */
  'scope-edit': async () => {
    const ok = await confirmDialog({
      title: 'Change the original agreement?',
      message: 'WorkSphare checks every new request against this agreement. If you change it, new comparisons may give different results. Comparisons you already made keep the old text, and the old version is saved as an earlier version.',
      confirmLabel: 'Yes, change it',
    });
    if (!ok) return;
    state.editingScope = true;
    rerender();
  },
  'scope-cancel': () => { state.editingScope = false; rerender(); },
  'revision-view': (el) => {
    const r = needProject()?.baselineRevisions[Number(el.dataset.index)];
    if (!r) return;
    infoDialog({ title: `Earlier version ${Number(el.dataset.index) + 1}`, wide: true, bodyHtml: `<p class="muted">${esc(r.title)}${r.date ? ` · agreed ${esc(fmtDate(r.date))}` : ''}</p><pre class="scope-text">${esc(r.text)}</pre>` });
  },

  /* ---- requests ---- */
  'request-add': async () => {
    const p = needProject();
    const done = await formDialog({
      title: 'Add a client request',
      submitLabel: 'Add request',
      wide: true,
      bodyHtml: V.requestFields({}),
      onSubmit: async (v) => {
        const r = P.validateRequestFields(v);
        if (!r.ok) return { errors: r.errors };
        const res = await mutate(p, (x) => P.addRequest(x, r.values));
        if (!res.ok) return { errors: { _form: 'Could not save the request. Please try again.' } };
        state.compareForm.selected = null;
        return true;
      },
    });
    if (done) { toast('Client request added.'); rerender(); }
  },
  'request-edit': async (el) => {
    const p = needProject();
    const req = p.requests.find((r) => r.id === el.dataset.id);
    if (!req) return;
    const done = await formDialog({
      title: 'Edit client request',
      submitLabel: 'Save changes',
      wide: true,
      bodyHtml: V.requestFields(req),
      onSubmit: async (v) => {
        const r = P.validateRequestFields(v);
        if (!r.ok) return { errors: r.errors };
        const res = await mutate(p, (x) => P.updateRequest(x, req.id, r.values));
        if (!res.ok) return { errors: { _form: 'Could not save the request. Please try again.' } };
        return true;
      },
    });
    if (done) { toast('Changes saved.'); rerender(); }
  },
  'request-delete': async (el) => {
    const p = needProject();
    const req = p.requests.find((r) => r.id === el.dataset.id);
    if (!req) return;
    const ok = await confirmDialog({
      title: 'Delete this client request?',
      message: 'It will be taken off your list. Comparisons you already made keep their own copy. You cannot undo this.',
      confirmLabel: 'Delete request',
      danger: true,
    });
    if (!ok) return;
    const res = await mutate(p, (x) => P.deleteRequest(x, req.id));
    if (res.ok) { state.compareForm.selected = null; toast('Client request deleted.'); rerender(); }
  },

  /* ---- compare ---- */
  'select-all-requests': () => document.querySelectorAll('input[name="requestIds"]').forEach((c) => { c.checked = true; }),
  'select-no-requests': () => document.querySelectorAll('input[name="requestIds"]').forEach((c) => { c.checked = false; }),
  'comparison-delete': async (el) => {
    const p = needProject();
    const ok = await confirmDialog({
      title: 'Delete this comparison?',
      message: 'This deletes the comparison, with your choices and notes on it. You cannot undo this.',
      confirmLabel: 'Delete comparison',
      danger: true,
    });
    if (!ok) return;
    const res = await mutate(p, (x) => P.deleteComparison(x, el.dataset.id));
    if (res.ok) { toast('Comparison deleted.'); rerender(); }
  },

  /* ---- results ---- */
  'results-tab': (el) => {
    state.results.tab = el.dataset.tab;
    document.getElementById('panel-findings').hidden = state.results.tab !== 'findings';
    document.getElementById('panel-text').hidden = state.results.tab !== 'text';
    document.querySelectorAll('[data-action="results-tab"]').forEach((b) => b.setAttribute('aria-selected', String(b === el)));
    if (state.results.tab === 'text') document.getElementById('panel-text').innerHTML = V.diffPanelHtml(state.comparison, state.results.showAllText);
  },

  'finding-status': async (el) => {
    const p = needProject();
    const c = state.comparison;
    const f = c.findings.find((x) => x.id === el.dataset.fid);
    if (!f) return;
    const next = f.status === el.dataset.status ? 'pending' : el.dataset.status;
    const res = await mutate(p, (x) => P.setFindingStatus(x, P.getComparison(x, c.id) || c, f.id, next));
    if (!res.ok) return;
    refreshFindings();
    const same = document.querySelector(`[data-action="finding-status"][data-fid="${CSS.escape(f.id)}"][data-status="${el.dataset.status}"]`);
    (same || document.getElementById('filter-status'))?.focus();
  },

  'note-save': async (el) => {
    const box = document.getElementById(`note-${el.dataset.fid}`);
    if (box) await saveNote(box);
  },

  'message-copy': async () => {
    const text = document.getElementById('client-message').value;
    const ok = await copyToClipboard(text);
    toast(ok ? 'Message copied.' : 'Could not copy automatically. Select the text and copy it yourself.', { error: !ok });
  },
  'message-reset': async () => {
    const p = needProject();
    const res = await mutate(p, () => P.resetMessage(state.comparison));
    if (!res.ok) return;
    document.getElementById('client-message').value = effectiveMessage(p, state.comparison);
    toast('Message reset.');
  },

  /* ---- report ---- */
  'report-print': async () => {
    const p = needProject();
    await mutate(p, (x) => P.logExport(x, P.getComparison(x, state.comparison.id) || state.comparison, 'print'));
    window.print();
  },
  'report-download-html': async () => {
    const p = needProject();
    const c = state.comparison;
    await mutate(p, (x) => P.logExport(x, P.getComparison(x, c.id) || c, 'html'));
    downloadFile(`worksphare-report-${slugify(p.name)}-${todayDate()}.html`, buildReportDocument(p, c), 'text/html');
    toast('Report downloaded.');
  },
  'report-download-json': async () => {
    const p = needProject();
    const c = state.comparison;
    await mutate(p, (x) => P.logExport(x, P.getComparison(x, c.id) || c, 'json'));
    downloadFile(`worksphare-report-${slugify(p.name)}-${todayDate()}.json`, JSON.stringify(buildReportJSON(p, c), null, 2), 'application/json');
    toast('Report data downloaded.');
  },

  /* ---- data ---- */
  'export-all': async () => {
    const all = await storage.getAllProjects();
    if (!all.length) { toast('You have no projects to download yet.'); return; }
    downloadFile(`worksphare-backup-${todayDate()}.json`, JSON.stringify(P.exportEnvelope(all), null, 2), 'application/json');
    toast(`Downloaded ${plural(all.length, 'project')}.`);
  },
  'persist-request': async () => {
    const granted = await storage.requestPersistentStorage();
    toast(granted ? 'The browser agreed to keep your projects.' : 'The browser said no. Keep downloading backups.', { error: !granted });
    renderData();
  },
  'demo-load': async () => {
    const demo = P.buildDemoProject();
    if (await persist(demo)) { toast('Sample project added.'); go(`#/p/${demo.id}`); }
  },
  'demo-remove': async () => {
    const all = await storage.getAllProjects();
    const demos = all.filter((p) => p.isDemo);
    if (!demos.length) return;
    const ok = await confirmDialog({
      title: 'Remove the sample project?',
      message: `This deletes ${plural(demos.length, 'sample project')}. Your own projects are not touched.`,
      confirmLabel: 'Remove sample project',
      danger: true,
    });
    if (!ok) return;
    try {
      for (const d of demos) await storage.deleteProject(d.id);
    } catch (e) {
      toast(`Could not remove. ${storage.describeError(e)}`, { error: true });
      return;
    }
    toast('Sample project removed.');
    renderData();
  },
};

function refreshFindings() {
  const c = state.comparison;
  const r = state.results;
  const list = document.getElementById('findings-list');
  if (list) list.innerHTML = V.findingsListHtml(c.findings, r.type, r.status, c.mode);
  const sum = document.getElementById('summary');
  if (sum) sum.innerHTML = V.summaryHtml(c.findings);
  const msg = document.getElementById('client-message');
  if (msg && !c.messageEdited) msg.value = effectiveMessage(state.project, c);
}

async function saveNote(box) {
  const p = needProject();
  const c = state.comparison;
  const f = c.findings.find((x) => x.id === box.dataset.fid);
  if (!f) return;
  if (box.value.trim() === f.note) return;
  const res = await mutate(p, (x) => P.setFindingNote(x, P.getComparison(x, c.id) || c, f.id, box.value));
  if (res.ok) toast('Note saved.');
}

/* ------------------------------ form submits ------------------------------ */

const submitHandlers = {
  'new-project': async (form) => {
    const r = P.validateProjectFields(readForm(form));
    if (!r.ok) { showFieldErrors(form, r.errors); return; }
    const p = P.newProject(r.values);
    if (await persist(p)) {
      toast('Project created. Next, add the original agreement.');
      state.editingScope = false;
      go(`#/p/${p.id}/scope`);
    }
  },

  scope: async (form) => {
    const p = needProject();
    const r = P.validateBaselineFields(readForm(form));
    if (!r.ok) { showFieldErrors(form, r.errors); return; }
    const res = await mutate(p, (x) => P.saveBaseline(x, r.values));
    if (!res.ok) return;
    state.editingScope = false;
    toast(res.out.changed ? 'Agreement saved.' : 'Nothing was changed.');
    rerender();
  },

  compare: async (form) => {
    const p = needProject();
    const fd = new FormData(form);
    const mode = fd.get('mode') === 'manual' ? 'manual' : 'requests';
    const requestIds = fd.getAll('requestIds').map(String);
    const manualText = String(fd.get('manualText') || '');
    state.compareForm = { mode, selected: new Set(requestIds), manualText };
    const result = P.runComparison(p, { mode, requestIds, manualText });
    if (!result.ok) {
      // runComparison returns before changing the project when input is invalid.
      const field = result.field || '_form';
      showFieldErrors(form, field === '_form' ? { _form: result.error } : { [field]: result.error, _form: result.error });
      return;
    }
    if (!(await persist(p))) { await rerender(); return; }
    toast(result.carried ? `Comparison done. ${plural(result.carried, 'earlier choice')} kept.` : 'Comparison done.');
    go(`#/p/${p.id}/c/${result.comparison.id}`);
  },
};

/* ------------------------------ event wiring ------------------------------ */

document.addEventListener('click', async (e) => {
  document.querySelectorAll('details.menu[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; });
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  if (el.closest('details.menu')) el.closest('details.menu').open = false;
  try {
    await fn(el, e);
  } catch (err) {
    console.error(err);
    toast('Something went wrong. Please try again.', { error: true });
  }
});

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const fn = submitHandlers[form.dataset.form];
  if (fn) {
    try { await fn(form); } catch (err) { console.error(err); toast('Something went wrong. Please try again.', { error: true }); }
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.matches('[data-role="project-search"]')) {
    state.query = t.value;
    const list = P.searchProjects(state.all.filter((p) => !!p.archived === state.showArchived), state.query);
    document.getElementById('project-list').innerHTML = V.projectListHtml(list, state.query.trim(), state.showArchived);
  }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.matches('input[name="mode"]')) {
    const form = t.closest('form');
    form.querySelector('[data-section="requests"]').hidden = t.value !== 'requests';
    form.querySelector('[data-section="manual"]').hidden = t.value !== 'manual';
    state.compareForm.mode = t.value;
  } else if (t.matches('input[name="requestIds"]')) {
    state.compareForm.selected = new Set([...document.querySelectorAll('input[name="requestIds"]:checked')].map((c) => c.value));
  } else if (t.matches('[data-role="filter-type"]')) {
    state.results.type = t.value;
    refreshFindings();
  } else if (t.matches('[data-role="filter-status"]')) {
    state.results.status = t.value;
    refreshFindings();
  } else if (t.matches('[data-role="show-all-text"]')) {
    state.results.showAllText = t.checked;
    document.getElementById('panel-text').innerHTML = V.diffPanelHtml(state.comparison, state.results.showAllText);
    document.querySelector('[data-role="show-all-text"]')?.focus();
  } else if (t.matches('[data-role="note"]')) {
    await saveNote(t);
  } else if (t.matches('[data-role="message"]')) {
    const p = needProject();
    const c = state.comparison;
    if (t.value !== effectiveMessage(p, c)) {
      const res = await mutate(p, (x) => P.setMessage(x, P.getComparison(x, c.id) || c, t.value));
      if (res.ok) { c.message = t.value; c.messageEdited = true; toast('Message saved.'); }
    }
  } else if (t.matches('[data-role="import-file"]')) {
    await handleImport(t);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (document.body.classList.contains('nav-open')) { closeNav(); document.getElementById('navToggle')?.focus(); }
  document.querySelectorAll('details.menu[open]').forEach((d) => { d.open = false; d.querySelector('summary')?.focus(); });
});

/* --------------------------------- import --------------------------------- */

async function handleImport(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const fail = (lines) => {
    state.importResult = `<div class="banner" role="alert"><div><p><strong>Could not restore this file. Nothing was changed.</strong></p><ul class="plain-bullets">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div></div>`;
    document.getElementById('import-result').innerHTML = state.importResult;
    input.value = '';
  };
  if (file.size > 30 * 1024 * 1024) return fail(['That file is much too big to be a WorkSphare backup.']);
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return fail(['This file could not be read. It may be damaged, or it may not be a WorkSphare backup.']);
  }
  const { projects, errors, warnings } = P.validateImport(data);
  if (errors.length) return fail(errors);
  const existing = new Set((await storage.getAllProjects()).map((p) => p.id));
  let saved = 0;
  try {
    for (const p of projects) {
      await storage.saveProject(P.prepareImported(p, existing));
      saved += 1;
    }
  } catch (e) {
    return fail([`Restoring stopped after ${saved} of ${projects.length} projects. ${storage.describeError(e)}`]);
  }
  state.importResult = `<div class="banner"><div><p><strong>Restored ${plural(saved, 'project')}.</strong> Your other projects were not changed.</p>${warnings.length ? `<ul class="plain-bullets">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}</div></div>`;
  toast(`Restored ${plural(saved, 'project')}.`);
  await renderData();
  state.importResult = '';
}

/* ---------------------------------- boot ---------------------------------- */

async function boot() {
  Auth.bind();
  await Auth.init(route);
  WS.init();
  const mode = await storage.initStorage();
  if (mode === 'memory') {
    state.storageBanner = 'Your browser is not letting WorkSphare save projects (this can happen in private browsing). They will be lost when you close or refresh this page. Download a backup often from the Backups page.';
  }
  window.addEventListener('hashchange', route);
  await route();
}

boot();
