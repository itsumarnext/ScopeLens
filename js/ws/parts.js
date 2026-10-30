// ws/parts.js — small read-only fragments reused on several screens (client profile, project details, etc.).

import {
  esc, icon, fmt, table, badge, empty, clientLink, projectLink, agreementLink, progressBar,
} from './ui.js';
import * as D from '../domain.js';
import { truncate } from '../utils.js';
import { activityHref } from './core.js';
import { today } from './core.js';

export const dueBadge = (date, done = false) => {
  if (!date) return '<span class="muted">No date</span>';
  if (done) return `<span>${esc(fmt.date(date))}</span>`;
  const n = D.daysBetween(today(), date);
  if (n < 0) return `<span>${esc(fmt.date(date))}</span> ${badge(`${-n} day${n === -1 ? '' : 's'} late`, 'alert')}`;
  if (n === 0) return `<span>${esc(fmt.date(date))}</span> ${badge('Today', 'accent')}`;
  return `<span>${esc(fmt.date(date))}</span>${n <= 7 ? ` <span class="small muted">in ${n} day${n === 1 ? '' : 's'}</span>` : ''}`;
};

export const invoiceStatusBadge = (v) => `${badge(v.status)}${v.isOverdue ? ` <span class="small muted">${v.overdueDays} day${v.overdueDays === 1 ? '' : 's'} overdue</span>` : ''}${v.partial && v.status === 'Overdue' ? ' <span class="small muted">partly paid</span>' : ''}`;

export function taskList(db, tasks, { links = true } = {}) {
  if (!tasks.length) return '<p class="muted">No tasks yet.</p>';
  const t0 = today();
  return `<ul class="task-list">${tasks.map((t) => {
    const done = t.status === 'Done';
    const late = !done && t.dueDate && t.dueDate < t0;
    return `<li class="task${done ? ' is-done' : ''}">
      <button type="button" class="check" data-action="task-toggle" data-id="${esc(t.id)}" aria-pressed="${done}" aria-label="${done ? 'Mark as not done' : 'Mark as done'}: ${esc(t.title)}">${done ? icon('check') : ''}</button>
      <div class="task-text"><button type="button" class="link-btn" data-action="task-edit" data-id="${esc(t.id)}">${esc(t.title)}</button>
        <span class="small muted">${badge(t.priority, t.priority === 'High' ? 'alert' : 'plain')} ${badge(t.status)} ${t.dueDate ? `Due ${esc(fmt.date(t.dueDate))}` : 'No due date'}${late ? ' · overdue' : ''}${links && t.clientId ? ` · ${clientLink(db, t.clientId)}` : ''}${links && t.projectId ? ` · ${projectLink(db, t.projectId)}` : ''}</span></div>
    </li>`;
  }).join('')}</ul>`;
}

export function activityList(db, entries, { limit = 30, showAll = false } = {}) {
  if (!entries.length) return '<p class="muted">Nothing recorded yet. Actions you take in WorkSphare appear here.</p>';
  const shown = showAll ? entries : entries.slice(0, limit);
  return `<ol class="timeline">${shown.map((a) => {
    const href = activityHref(db, a);
    return `<li><span class="tl-mark" aria-hidden="true"></span><div class="tl-body"><span>${esc(a.text)}</span><span class="small muted">${esc(fmt.dateTime(a.at))}${href ? ` · <a href="${href}">Open</a>` : ''}</span></div></li>`;
  }).join('')}</ol>${!showAll && entries.length > limit ? `<p class="small muted">Showing the latest ${limit} of ${entries.length}.</p>` : ''}`;
}

export function invoiceTable(db, invoices, { client = true } = {}) {
  const t0 = today();
  const rows = [...invoices].sort((a, b) => b.issueDate.localeCompare(a.issueDate));
  return table({
    list: 'mini-invoices', rows, empty: '<p class="muted">No invoices yet.</p>', caption: 'Invoices',
    cols: [
      { label: 'Invoice', cell: (i) => `<a href="#/payments/invoice/${esc(i.id)}">${esc(i.number)}</a><br><span class="small muted">${esc(truncate(i.description, 60))}</span>` },
      ...(client ? [{ label: 'Client', cell: (i) => clientLink(db, i.clientId) }] : []),
      { label: 'Due', cell: (i) => esc(fmt.date(i.dueDate)) },
      { label: 'Amount', cls: 'num', cell: (i) => esc(fmt.money(i.amount)) },
      { label: 'Balance', cls: 'num', cell: (i) => { const v = D.invoiceView(db, i, t0); return v.issued ? esc(fmt.money(v.balance)) : '<span class="muted">—</span>'; } },
      { label: 'Status', cell: (i) => invoiceStatusBadge(D.invoiceView(db, i, t0)) },
    ],
  });
}

export function transactionTable(db, txns, { client = true } = {}) {
  const rows = [...txns].sort((a, b) => b.date.localeCompare(a.date));
  return table({
    list: 'mini-transactions', rows, empty: '<p class="muted">No payments recorded yet.</p>', caption: 'Payments received',
    cols: [
      { label: 'Date', cell: (t) => esc(fmt.date(t.date)) },
      ...(client ? [{ label: 'Client', cell: (t) => clientLink(db, t.clientId) }] : []),
      { label: 'Invoice', cell: (t) => { const i = D.byId(db.invoices, t.invoiceId); return i ? `<a href="#/payments/invoice/${esc(i.id)}">${esc(i.number)}</a>` : '<span class="muted">Not linked to an invoice</span>'; } },
      { label: 'Amount received', cls: 'num', cell: (t) => esc(fmt.money(t.amount)) },
      { label: 'Method', cell: (t) => esc(t.method || '—') },
    ],
  });
}

export function projectTable(db, projects, { client = true } = {}) {
  return table({
    list: 'mini-projects', rows: projects, empty: '<p class="muted">No projects yet.</p>', caption: 'Projects',
    cols: [
      { label: 'Project', cell: (p) => `<a href="#/projects/details/${esc(p.id)}">${esc(p.name)}</a>${p.archived ? ' ' + badge('Archived') : ''}` },
      ...(client ? [{ label: 'Client', cell: (p) => clientLink(db, p.clientId) }] : []),
      { label: 'Due', cell: (p) => dueBadge(p.dueDate, p.status === 'Completed' || p.status === 'Cancelled') },
      { label: 'Value', cls: 'num', cell: (p) => (p.value === '' ? '<span class="muted">—</span>' : esc(fmt.money(p.value))) },
      { label: 'Progress', cell: (p) => progressBar(p.progress) },
      { label: 'Status', cell: (p) => badge(p.status) },
    ],
  });
}

export function agreementTable(db, agreements, { client = true } = {}) {
  const t0 = today();
  const warn = db.settings.expiryWarnDays;
  return table({
    list: 'mini-agreements', rows: agreements, empty: '<p class="muted">No agreements yet.</p>', caption: 'Agreements',
    cols: [
      { label: 'Agreement', cell: (a) => `<a href="#/agreements/details/${esc(a.id)}">${esc(a.title)}</a>` },
      ...(client ? [{ label: 'Client', cell: (a) => clientLink(db, a.clientId) }] : []),
      { label: 'Ends', cell: (a) => (a.endDate ? esc(fmt.date(a.endDate)) : '<span class="muted">No end date</span>') },
      { label: 'Value', cls: 'num', cell: (a) => (a.value === '' ? '<span class="muted">—</span>' : esc(fmt.money(a.value))) },
      { label: 'Status', cell: (a) => badge(D.agreementView(a, t0, warn).status) },
    ],
  });
}

export function comparisonList(db, comparisons) {
  if (!comparisons.length) return '<p class="muted">No comparisons saved yet.</p>';
  return `<ul class="plain-list">${[...comparisons].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((c) => `<li><div class="list-text"><a href="#/ai/result/${esc(c.id)}">${esc(truncate(c.requestText, 90))}</a><span class="small muted">${esc(fmt.date(c.createdAt))} · ${esc(c.agreementTitle || 'Pasted agreement')} · ${esc(c.result.summary)}</span></div></li>`).join('')}</ul>`;
}

export function changeList(db, changes) {
  if (!changes.length) return '<p class="muted">No scope changes recorded.</p>';
  return `<ul class="plain-list">${[...changes].sort((a, b) => b.dateRequested.localeCompare(a.dateRequested)).map((c) => `<li><div class="list-text"><a href="#/ai/changes">${esc(c.title)}</a><span class="small muted">Requested ${esc(fmt.date(c.dateRequested))}${c.additionalPrice !== '' ? ` · extra ${esc(fmt.money(c.additionalPrice))}` : ''}</span></div>${badge(c.status)}</li>`).join('')}</ul>`;
}

export { empty, agreementLink };
