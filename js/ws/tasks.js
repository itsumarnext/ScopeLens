// ws/tasks.js — Activity & Tasks tab: Tasks, Calendar & deadlines, Activity log.

import {
  esc, icon, fmt, field, row2, pageHead, tabsNav, sectionHead, empty, card, menu, table, badge, filterBar, listState, setListState,
  options, clientOptions, projectOptions, clientLink, projectLink,
} from './ui.js';
import * as D from '../domain.js';
import * as S from '../store.js';
import {
  toast, confirmDialog, formDialog, infoDialog, trySave, saveWithToast, failForm, go, refresh, today, activityHref,
} from './core.js';
import { dueBadge } from './parts.js';

const TABS = [
  { key: 'tasks', label: 'Tasks', href: '#/tasks' },
  { key: 'calendar', label: 'Calendar & deadlines', href: '#/tasks/calendar' },
  { key: 'log', label: 'Activity log', href: '#/tasks/log' },
];
const head = (active, title, sub, actions = '') => `${pageHead({ title, sub, actions })}${tabsNav(TABS, active, 'Activity and tasks sections')}`;

export function taskFields(db, v = {}) {
  const f = (name, label, o = {}) => field({ id: `tk-${name}`, name, label, value: v[name] ?? '', ...o });
  return `${f('title', 'Task', { required: true, max: 160, placeholder: 'For example: Send the first draft' })}
    ${f('description', 'Details', { kind: 'textarea', rows: 3, max: 3000 })}
    ${row2(f('dueDate', 'Due date', { kind: 'date' }), f('priority', 'Priority', { kind: 'select', list: D.PRIORITIES, value: v.priority || 'Medium' }))}
    ${row2(f('status', 'Status', { kind: 'select', list: D.TASK_STATUSES, value: v.status || 'To Do' }), f('clientId', 'Client', { kind: 'select', list: clientOptions(db, v.clientId), blank: 'No client', extra: 'data-role="tk-client"' }))}
    ${f('projectId', 'Project', { kind: 'select', list: projectOptions(db, v.clientId, v.projectId), blank: 'No project', value: v.projectId, extra: 'data-role="tk-project"' })}`;
}

/* ---------------------------------------- tasks ---------------------------------------- */

const DEFAULTS = { q: '', status: 'open', priority: 'all', due: 'all', client: 'all', project: 'all', sort: 'due' };
const SORTS = { due: 'Due date (soonest first)', priority: 'Priority (high first)', newest: 'Newest first' };
const PRI = { High: 0, Medium: 1, Low: 2 };

function taskRows(db, st) {
  const t0 = today();
  const week = D.addDays(t0, 7);
  return db.tasks.filter((t) => {
    if (st.status === 'open' ? t.status === 'Done' : st.status !== 'all' && t.status !== st.status) return false;
    if (st.priority !== 'all' && t.priority !== st.priority) return false;
    if (st.client !== 'all' && t.clientId !== st.client) return false;
    if (st.project !== 'all' && t.projectId !== st.project) return false;
    if (st.due === 'overdue' && !(t.dueDate && t.dueDate < t0 && t.status !== 'Done')) return false;
    if (st.due === 'today' && t.dueDate !== t0) return false;
    if (st.due === 'week' && !(t.dueDate && t.dueDate >= t0 && t.dueDate <= week)) return false;
    if (st.due === 'none' && t.dueDate) return false;
    return D.searchMatch([t.title, t.description, D.clientName(db, t.clientId)], st.q);
  }).sort({
    due: (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || PRI[a.priority] - PRI[b.priority],
    priority: (a, b) => PRI[a.priority] - PRI[b.priority] || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'),
    newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
  }[st.sort] || (() => 0));
}

function listHtml() {
  const db = S.data();
  const st = listState('tasks', DEFAULTS);
  if (!db.tasks.length) return empty({ title: 'No tasks yet', text: 'Add things you need to remember: sending a draft, chasing a payment, a client call.', action: '<button type="button" class="btn btn-primary" data-action="task-new">Create a task</button>' });
  const t0 = today();
  return table({
    list: 'tasks', rows: taskRows(db, st), caption: 'Tasks', empty: empty({ title: 'No tasks match', text: 'Try a different search or filter.' }),
    cols: [
      { label: 'Done', cell: (t) => `<button type="button" class="check" data-action="task-toggle" data-id="${esc(t.id)}" aria-pressed="${t.status === 'Done'}" aria-label="${t.status === 'Done' ? 'Mark as not done' : 'Mark as done'}: ${esc(t.title)}">${t.status === 'Done' ? icon('check') : ''}</button>` },
      { label: 'Task', cell: (t) => `<button type="button" class="link-btn${t.status === 'Done' ? ' is-done' : ''}" data-action="task-edit" data-id="${esc(t.id)}"><strong>${esc(t.title)}</strong></button>${t.demo ? ' ' + badge('Demo', 'muted') : ''}${t.description ? `<br><span class="small muted">${esc(t.description.slice(0, 80))}</span>` : ''}` },
      { label: 'Due', cell: (t) => dueBadge(t.dueDate, t.status === 'Done') },
      { label: 'Priority', cell: (t) => badge(t.priority, t.priority === 'High' ? 'alert' : 'plain') },
      { label: 'Status', cell: (t) => badge(t.status) },
      { label: 'Client', cell: (t) => clientLink(db, t.clientId) },
      { label: 'Project', cell: (t) => projectLink(db, t.projectId) },
      { label: 'Actions', cls: 'actions', cell: (t) => `<div class="row-actions"><button type="button" class="btn btn-sm" data-action="task-edit" data-id="${esc(t.id)}">Edit</button>${menu([{ action: 'task-delete', id: t.id, label: 'Delete…', icon: 'trash', danger: true }], `More actions for ${t.title}`)}</div>` },
    ],
  }) + (t0 ? '' : '');
}

function viewTasks() {
  const db = S.data();
  const st = listState('tasks', DEFAULTS);
  const t0 = today();
  const open = db.tasks.filter((t) => t.status !== 'Done');
  const overdue = open.filter((t) => t.dueDate && t.dueDate < t0).length;
  const dueToday = open.filter((t) => t.dueDate === t0).length;
  const soon = open.filter((t) => t.dueDate && t.dueDate > t0 && t.dueDate <= D.addDays(t0, 7)).length;
  return {
    title: 'Tasks', nav: 'tasks',
    html: `${head('tasks', 'Activity & tasks', 'Things to do, with due dates. Overdue tasks are highlighted.', `<button type="button" class="btn btn-primary" data-action="task-new">${icon('plus')}New task</button>`)}
      <div class="summary summary-3"><div class="stat"><span class="stat-n">${overdue}</span><span class="stat-l">Overdue</span></div><div class="stat"><span class="stat-n">${dueToday}</span><span class="stat-l">Due today</span></div><div class="stat"><span class="stat-n">${soon}</span><span class="stat-l">Due in the next 7 days</span></div></div>
      ${db.tasks.length ? filterBar('tasks', st, { placeholder: 'Search tasks', selects: [
        { key: 'status', label: 'Status', options: [{ value: 'open', label: 'Not done yet' }, { value: 'all', label: 'Everything' }, ...D.TASK_STATUSES.map((s) => ({ value: s, label: s }))] },
        { key: 'priority', label: 'Priority', options: [{ value: 'all', label: 'Any priority' }, ...D.PRIORITIES.map((s) => ({ value: s, label: s }))] },
        { key: 'due', label: 'Due', options: [{ value: 'all', label: 'Any date' }, { value: 'overdue', label: 'Overdue' }, { value: 'today', label: 'Today' }, { value: 'week', label: 'Next 7 days' }, { value: 'none', label: 'No date' }] },
        { key: 'client', label: 'Client', options: [{ value: 'all', label: 'All clients' }, ...clientOptions(db)] },
        { key: 'project', label: 'Project', options: [{ value: 'all', label: 'All projects' }, ...projectOptions(db)] },
        { key: 'sort', label: 'Sort by', options: Object.entries(SORTS).map(([value, label]) => ({ value, label })) },
      ] }) : ''}
      <div id="list-tasks" aria-live="polite">${listHtml()}</div>`,
  };
}

/* --------------------------------------- calendar --------------------------------------- */

const CAL_TYPES = Object.entries(D.EVENT_TYPES);
const calState = () => {
  const d = new Date();
  const st = listState('calendar', { y: d.getFullYear(), m: d.getMonth(), view: 'month', hidden: '' });
  return { ...st, hidden: String(st.hidden || '').split(',').filter(Boolean) };
};

function eventHtml(e, compact = false) {
  const inner = `<span class="ev-type">${esc(D.EVENT_TYPES[e.type])}</span> ${esc(e.title)}`;
  const cls = `ev ev-${e.type}${compact ? ' ev-compact' : ''}`;
  return e.open
    ? `<button type="button" class="${cls}" data-action="${e.open}" data-id="${esc(e.id)}">${inner}</button>`
    : `<a class="${cls}" href="${e.href}">${inner}</a>`;
}

function calendarHtml() {
  const db = S.data();
  const st = calState();
  const t0 = today();
  const events = D.calendarEvents(db, t0, db.settings.expiryWarnDays).filter((e) => !st.hidden.includes(e.type));
  if (st.view === 'list') {
    const past = events.filter((e) => e.date < t0).reverse();
    const future = events.filter((e) => e.date >= t0).slice(0, 200);
    const group = (list) => {
      const byDate = new Map();
      for (const e of list) { if (!byDate.has(e.date)) byDate.set(e.date, []); byDate.get(e.date).push(e); }
      return [...byDate].map(([date, items]) => `<section class="cal-day-group"><h3>${esc(fmt.date(date))}${date === t0 ? ' · Today' : ''}</h3><ul class="plain-list">${items.map((e) => `<li><div class="list-text">${eventHtml(e)}<span class="small muted">${esc(e.sub || '')}</span></div></li>`).join('')}</ul></section>`).join('');
    };
    if (!events.length) return empty({ title: 'No dates to show', text: 'Tasks, project due dates, invoice due dates, agreement end dates and lead follow-ups appear here once they have a date.' });
    return `${past.length ? `<h2 class="h-gap">Past due</h2>${group(past)}` : ''}<h2 class="h-gap">Coming up</h2>${future.length ? group(future) : '<p class="muted">Nothing is coming up.</p>'}`;
  }
  const first = new Date(st.y, st.m, 1);
  const lead = (first.getDay() + 6) % 7; // Monday first
  const days = new Date(st.y, st.m + 1, 0).getDate();
  const byDate = new Map();
  for (const e of events) { if (!byDate.has(e.date)) byDate.set(e.date, []); byDate.get(e.date).push(e); }
  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push('<div class="cal-cell cal-blank" aria-hidden="true"></div>');
  for (let d = 1; d <= days; d += 1) {
    const ds = `${st.y}-${String(st.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const items = byDate.get(ds) || [];
    cells.push(`<div class="cal-cell${ds === t0 ? ' cal-today' : ''}${items.length ? ' has-events' : ''}"><button type="button" class="cal-num" data-action="cal-day" data-date="${ds}" aria-label="${esc(fmt.date(ds))}, ${items.length} item${items.length === 1 ? '' : 's'}">${d}${items.length ? `<span class="cal-count">${items.length}</span>` : ''}</button><div class="cal-events">${items.slice(0, 2).map((e) => eventHtml(e, true)).join('')}${items.length > 2 ? `<button type="button" class="cal-more" data-action="cal-day" data-date="${ds}">+${items.length - 2} more</button>` : ''}</div></div>`);
  }
  return `<div class="cal-grid" role="group" aria-label="${esc(fmt.monthName(st.y, st.m))}">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="cal-head" aria-hidden="true">${d}</div>`).join('')}${cells.join('')}</div>`;
}

function viewCalendar() {
  const st = calState();
  return {
    title: 'Calendar & deadlines', nav: 'tasks',
    html: `${head('calendar', 'Calendar & deadlines', 'Task dates, project due dates, payment due dates, agreement end dates and lead follow-ups, together.')}
      <div class="cal-bar"><div class="row-actions"><button type="button" class="btn btn-sm" data-action="cal-prev" aria-label="Previous month">${icon('chevron-left')}</button><strong class="cal-title" aria-live="polite">${st.view === 'month' ? esc(fmt.monthName(st.y, st.m)) : 'All dates'}</strong><button type="button" class="btn btn-sm" data-action="cal-next" aria-label="Next month">${icon('chevron-right')}</button><button type="button" class="btn btn-sm" data-action="cal-today">Today</button></div>
        <div class="segmented" role="group" aria-label="View"><button type="button" class="seg" data-action="cal-view" data-view="month" aria-pressed="${st.view === 'month'}">Month</button><button type="button" class="seg" data-action="cal-view" data-view="list" aria-pressed="${st.view === 'list'}">List</button></div></div>
      <fieldset class="cal-types"><legend class="sr-only">Show these kinds of dates</legend>${CAL_TYPES.map(([k, label]) => `<label class="choice inline ev-key ev-${k}"><input type="checkbox" data-role="cal-type" value="${k}"${st.hidden.includes(k) ? '' : ' checked'}><span>${esc(label)}</span></label>`).join('')}</fieldset>
      <div id="list-calendar">${calendarHtml()}</div>`,
  };
}

/* ------------------------------------- activity log ------------------------------------- */

const GROUPS = {
  clients: ['Clients and leads', (t) => t.startsWith('client_') || t.startsWith('lead_')],
  projects: ['Projects', (t) => t.startsWith('project_')],
  agreements: ['Agreements', (t) => t.startsWith('agreement_')],
  payments: ['Invoices and payments', (t) => t.startsWith('invoice_') || t.startsWith('payment_')],
  tasks: ['Tasks', (t) => t.startsWith('task_')],
  scope: ['Scope checks and changes', (t) => t.startsWith('comparison_') || t.startsWith('scope_change')],
  notes: ['Notes you added', (t) => t === 'note'],
  data: ['Data and backups', (t) => t.startsWith('data_') || t.startsWith('demo_') || t.startsWith('settings_')],
};
const groupOf = (type) => Object.entries(GROUPS).find(([, [, fn]]) => fn(type))?.[0] || 'data';
const LOG_DEFAULTS = { q: '', group: 'all', client: 'all', limit: 100 };

function logHtml() {
  const db = S.data();
  const st = listState('log', LOG_DEFAULTS);
  const all = [...db.activity].sort((a, b) => b.at.localeCompare(a.at)).filter((a) => (st.group === 'all' || groupOf(a.type) === st.group)
    && (st.client === 'all' || (a.refs && a.refs.clientId === st.client)) && D.searchMatch([a.text], st.q));
  if (!db.activity.length) return empty({ title: 'No activity yet', text: 'When you add clients, record payments, finish tasks or save comparisons, it is logged here with the time.' });
  if (!all.length) return empty({ title: 'No entries match', text: 'Try a different search or filter.' });
  const shown = all.slice(0, st.limit);
  return `<ol class="timeline">${shown.map((a) => { const href = activityHref(db, a); return `<li><span class="tl-mark" aria-hidden="true"></span><div class="tl-body"><span>${esc(a.text)}</span><span class="small muted">${badge(GROUPS[groupOf(a.type)][0], 'plain')} ${esc(fmt.dateTime(a.at))}${href ? ` · <a href="${href}">Open</a>` : ''}</span></div></li>`; }).join('')}</ol>
    ${all.length > shown.length ? `<p><button type="button" class="btn" data-action="log-more">Show 100 more (${all.length - shown.length} left)</button></p>` : `<p class="small muted">${all.length} entr${all.length === 1 ? 'y' : 'ies'}.</p>`}`;
}

function viewLog() {
  const db = S.data();
  const st = listState('log', LOG_DEFAULTS);
  return {
    title: 'Activity log', nav: 'tasks',
    html: `${head('log', 'Activity log', 'A record of what you did in WorkSphare. It does not track emails, calls or messages unless you add them yourself.', `<button type="button" class="btn" data-action="note-new">${icon('plus')}Add a note</button>`)}
      ${filterBar('log', st, { placeholder: 'Search the log', selects: [{ key: 'group', label: 'Type', options: [{ value: 'all', label: 'Everything' }, ...Object.entries(GROUPS).map(([value, [label]]) => ({ value, label }))] }, { key: 'client', label: 'Client', options: [{ value: 'all', label: 'All clients' }, ...clientOptions(db)] }] })}
      <div id="list-log" aria-live="polite">${logHtml()}</div>`,
  };
}

export function render(parts) {
  const sub = parts[1];
  if (!sub) return viewTasks();
  if (sub === 'calendar') return viewCalendar();
  if (sub === 'log') return viewLog();
  return null;
}

export const lists = { tasks: listHtml, calendar: calendarHtml, log: logHtml };

/* ---------------------------------------- handlers ---------------------------------------- */

async function openTaskDialog(t, preset = {}) {
  const db = S.data();
  const editing = !!t;
  const proj = D.byId(db.projects, preset.project);
  const v = t || { clientId: preset.client || (proj ? proj.clientId : ''), projectId: proj ? proj.id : '', status: 'To Do', priority: 'Medium' };
  const done = await formDialog({
    title: editing ? 'Edit task' : 'New task', submitLabel: editing ? 'Save changes' : 'Create task', bodyHtml: taskFields(db, v), wide: true,
    onSubmit: (raw) => {
      const r = D.validateTask(raw, S.data());
      if (!r.ok) return { errors: r.errors };
      const s = trySave(() => {
        if (editing) {
          const completing = r.values.status === 'Done' && t.status !== 'Done';
          S.patch('tasks', t.id, { ...r.values, completedAt: r.values.status === 'Done' ? t.completedAt || new Date().toISOString() : '' });
          S.log(completing ? 'task_completed' : 'task_updated', completing ? `Task completed: ${r.values.title}` : `Task updated: ${r.values.title}`, { taskId: t.id, clientId: r.values.clientId, projectId: r.values.projectId });
          return t;
        }
        const n = S.add('tasks', { ...r.values, completedAt: r.values.status === 'Done' ? new Date().toISOString() : '' });
        S.log('task_created', `Task created: ${n.title}`, { taskId: n.id, clientId: n.clientId, projectId: n.projectId });
        return n;
      });
      return s.ok ? s.out : failForm(s);
    },
  });
  if (done) { toast(editing ? 'Task saved.' : 'Task created.'); refresh(); }
}

export const actions = {
  'task-new': (el) => openTaskDialog(null, { client: el.dataset.client || '', project: el.dataset.project || '' }),
  'task-edit': (el) => { const t = D.byId(S.data().tasks, el.dataset.id); if (t) return openTaskDialog(t); return null; },
  'task-toggle': (el) => {
    const t = D.byId(S.data().tasks, el.dataset.id);
    if (!t) return;
    const done = t.status !== 'Done';
    const r = saveWithToast(() => {
      S.patch('tasks', t.id, { status: done ? 'Done' : 'To Do', completedAt: done ? new Date().toISOString() : '' });
      S.log(done ? 'task_completed' : 'task_updated', done ? `Task completed: ${t.title}` : `Task reopened: ${t.title}`, { taskId: t.id, clientId: t.clientId, projectId: t.projectId });
    }, done ? 'Task marked as done.' : 'Task reopened.');
    if (r.ok) refresh();
  },
  'task-delete': async (el) => {
    const t = D.byId(S.data().tasks, el.dataset.id);
    if (!t) return;
    if (!(await confirmDialog({ title: 'Delete this task?', message: `“${t.title}” will be deleted. This cannot be undone.`, confirmLabel: 'Delete task', danger: true }))) return;
    const r = saveWithToast(() => { S.drop('tasks', t.id); S.log('task_deleted', `Task deleted: ${t.title}`, { clientId: t.clientId, projectId: t.projectId }); }, 'Task deleted.');
    if (r.ok) refresh();
  },

  'cal-prev': () => { const s = calState(); const d = new Date(s.y, s.m - 1, 1); setListState('calendar', { y: d.getFullYear(), m: d.getMonth() }); refresh(); },
  'cal-next': () => { const s = calState(); const d = new Date(s.y, s.m + 1, 1); setListState('calendar', { y: d.getFullYear(), m: d.getMonth() }); refresh(); },
  'cal-today': () => { const d = new Date(); setListState('calendar', { y: d.getFullYear(), m: d.getMonth() }); refresh(); },
  'cal-view': (el) => { setListState('calendar', { view: el.dataset.view }); refresh(); },
  'cal-day': async (el) => {
    const db = S.data();
    const date = el.dataset.date;
    const st = calState();
    const items = D.calendarEvents(db, today(), db.settings.expiryWarnDays).filter((e) => e.date === date && !st.hidden.includes(e.type));
    await infoDialog({ title: fmt.date(date), closeLabel: 'Close', bodyHtml: items.length ? `<ul class="plain-list">${items.map((e) => `<li><div class="list-text">${eventHtml(e)}<span class="small muted">${esc(e.sub || '')}</span></div></li>`).join('')}</ul>` : '<p class="muted">Nothing is planned for this day.</p>' });
  },
  'log-more': () => { setListState('log', { limit: (listState('log', LOG_DEFAULTS).limit || 100) + 100 }); const r = document.getElementById('list-log'); if (r) r.innerHTML = logHtml(); },
  'note-new': async () => {
    const db = S.data();
    const done = await formDialog({
      title: 'Add a note to the log', intro: 'Use this to record things WorkSphare cannot see, like a phone call or a meeting.', submitLabel: 'Add note', wide: true,
      bodyHtml: `${field({ id: 'nt-text', name: 'text', label: 'What happened?', kind: 'textarea', rows: 3, required: true, max: 600 })}${row2(field({ id: 'nt-client', name: 'clientId', label: 'Client', kind: 'select', list: clientOptions(db), blank: 'No client' }), field({ id: 'nt-project', name: 'projectId', label: 'Project', kind: 'select', list: projectOptions(db), blank: 'No project' }))}`,
      onSubmit: (raw) => {
        const text = String(raw.text || '').trim();
        if (!text) return { errors: { text: 'Write what happened.' } };
        const s = trySave(() => S.log('note', text, { ...(raw.clientId ? { clientId: raw.clientId } : {}), ...(raw.projectId ? { projectId: raw.projectId } : {}) }));
        return s.ok ? true : failForm(s);
      },
    });
    if (done) { toast('Note added.'); refresh(); }
  },
};

export const changes = {
  'tk-client': (el) => {
    const sel = el.closest('form')?.querySelector('select[name="projectId"]');
    if (sel) sel.innerHTML = `<option value="">No project</option>${options(projectOptions(S.data(), el.value, ''), '')}`;
  },
  'tk-project': (el) => {
    const p = D.byId(S.data().projects, el.value);
    const client = el.closest('form')?.querySelector('select[name="clientId"]');
    if (p && client) client.value = p.clientId;
  },
  'cal-type': () => {
    const hidden = [...document.querySelectorAll('input[data-role="cal-type"]')].filter((c) => !c.checked).map((c) => c.value).join(',');
    setListState('calendar', { hidden });
    document.getElementById('list-calendar').innerHTML = calendarHtml();
  },
};

export { go };
