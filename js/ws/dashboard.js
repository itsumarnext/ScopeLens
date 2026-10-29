// ws/dashboard.js — Dashboard: every figure is calculated from saved records.

import { esc, icon, fmt, pageHead, sectionHead, card, badge, empty } from './ui.js';
import * as D from '../domain.js';
import * as S from '../store.js';
import { EVENT_TYPES } from '../domain.js';
import { today } from './core.js';
import { activityList, dueBadge } from './parts.js';

const tile = (href, n, label, note = '') => `<a class="stat stat-link" href="${href}"><span class="stat-n">${n}</span><span class="stat-l">${esc(label)}</span>${note ? `<span class="small muted">${esc(note)}</span>` : ''}</a>`;

const mini = (items, none, render) => (items.length ? `<ul class="plain-list">${items.map(render).join('')}</ul>` : `<p class="muted">${esc(none)}</p>`);

export function render() {
  const db = S.data();
  const t0 = today();
  const warn = db.settings.expiryWarnDays;
  const m = D.dashboardMetrics(db, t0, warn);
  const hasDemo = [...db.clients, ...db.projects, ...db.invoices, ...db.agreements].some((r) => r.demo);
  const recent = [...db.activity].sort((a, b) => b.at.localeCompare(a.at));
  const name = db.settings.businessName;
  const client = (id) => D.clientName(db, id);

  const welcome = S.isEmpty()
    ? card(`<h2>Welcome to ScopeLens</h2><p class="muted">Nothing is saved yet, so every number below is zero. Start by adding a client, or look around with sample data first. Sample data is clearly labelled and can be removed in one click.</p>
      <div class="card-actions"><a class="btn btn-primary" href="#/clients/add">${icon('plus')}Add your first client</a><button type="button" class="btn" data-action="ws-demo-load">Load demo data</button><a class="btn" href="#/help">Read the guide</a></div>`, 'card-next')
    : '';
  const demo = hasDemo ? `<div class="banner" role="status"><p><strong>You are looking at demo data.</strong> It is made up, and shown with a “Demo” label. Remove it when you are ready to use your own.</p><button type="button" class="btn btn-sm" data-action="ws-demo-remove">Remove demo data</button></div>` : '';

  const todayCards = [
    ['Tasks due today', m.today.tasksToday, 'Nothing is due today.', (t) => `<li><div class="list-text"><button type="button" class="link-btn" data-action="task-edit" data-id="${esc(t.id)}">${esc(t.title)}</button><span class="small muted">${esc(client(t.clientId))}</span></div>${badge(t.priority, t.priority === 'High' ? 'alert' : 'plain')}</li>`],
    ['Overdue tasks', m.today.tasksOverdue, 'No tasks are overdue.', (t) => `<li><div class="list-text"><button type="button" class="link-btn" data-action="task-edit" data-id="${esc(t.id)}">${esc(t.title)}</button><span class="small muted">${esc(client(t.clientId))}</span></div>${dueBadge(t.dueDate)}</li>`],
    ['Project deadlines (next 14 days)', m.today.projects, 'No project deadlines coming up.', (p) => `<li><div class="list-text"><a href="#/projects/details/${esc(p.id)}">${esc(p.name)}</a><span class="small muted">${esc(client(p.clientId))}</span></div>${dueBadge(p.dueDate)}</li>`],
    ['Payments due in the next 7 days', m.today.paymentsSoon, 'No payments are due soon.', ({ inv, v }) => `<li><div class="list-text"><a href="#/payments/invoice/${esc(inv.id)}">${esc(inv.number)}</a><span class="small muted">${esc(client(inv.clientId))} · ${esc(fmt.money(v.balance))} still owed</span></div>${dueBadge(inv.dueDate)}</li>`],
    ['Overdue payments', m.today.overdueInvoices, 'No payments are overdue.', ({ inv, v }) => `<li><div class="list-text"><a href="#/payments/invoice/${esc(inv.id)}">${esc(inv.number)}</a><span class="small muted">${esc(client(inv.clientId))} · ${esc(fmt.money(v.balance))} still owed</span></div><span class="small">${v.overdueDays} day${v.overdueDays === 1 ? '' : 's'} overdue</span></li>`],
    [`Agreements ending within ${warn} days`, m.today.agreementsEnding, 'No agreements are about to end.', ({ a, v }) => `<li><div class="list-text"><a href="#/agreements/details/${esc(a.id)}">${esc(a.title)}</a><span class="small muted">${esc(client(a.clientId))}</span></div><span class="small">${esc(fmt.date(a.endDate))} (${v.daysLeft} day${v.daysLeft === 1 ? '' : 's'})</span></li>`],
  ];

  const up = m.upcoming;
  const quick = [
    ['Add client', '#/clients/add', 'users'], ['Create project', '#/projects/new', 'briefcase'], ['Record payment', null, 'wallet', 'txn-new'],
    ['Add agreement', '#/agreements/add', 'file'], ['Create task', null, 'tasks', 'task-new'], ['Compare client request', '#/ai', 'spark'],
  ];
  const h = m.health;
  const sum = (arr) => arr.map((x) => `${x.count} ${x.status.toLowerCase()}`).join(' · ');

  return {
    title: 'Dashboard', nav: 'dashboard',
    html: `${pageHead({ title: name ? `Hello, ${name}` : 'Dashboard', sub: 'Your business at a glance. Every figure is worked out from the records saved in this browser.' })}
      ${welcome}${demo}
      <section aria-labelledby="ov-h"><h2 id="ov-h" class="h-gap">Business overview</h2><div class="summary summary-6">
        ${tile('#/clients', m.totals.clients, 'Total clients', 'Not counting archived')}
        ${tile('#/projects', m.totals.activeProjects, 'Active projects', 'In progress now')}
        ${tile('#/payments/transactions', esc(fmt.money(m.totals.received)), 'Money received', 'Payments recorded')}
        ${tile('#/payments/dues', esc(fmt.money(m.totals.outstanding)), 'Still owed to you', 'Issued invoices, not yet paid')}
        ${tile('#/payments/dues', esc(fmt.money(m.totals.overdue)), 'Overdue', 'Past the due date')}
        ${tile('#/agreements', m.totals.activeAgreements, 'Active agreements', 'Including ones ending soon')}
      </div></section>
      <section aria-labelledby="qa-h"><h2 id="qa-h" class="h-gap">Quick actions</h2><div class="quick-grid">${quick.map(([label, href, ic, action]) => (href ? `<a class="btn" href="${href}">${icon(ic)}${esc(label)}</a>` : `<button type="button" class="btn" data-action="${action}">${icon(ic)}${esc(label)}</button>`)).join('')}</div></section>
      <section aria-labelledby="bt-h"><h2 id="bt-h" class="h-gap">My business today</h2><div class="grid-2">${todayCards.map(([title, items, none, fn]) => card(`<h3>${esc(title)} <span class="count">${items.length}</span></h3>${mini(items, none, fn)}`)).join('')}</div></section>
      <div class="grid-2">
        <section>${card(`${sectionHead('Upcoming deadlines', 'The next things on your calendar, soonest first.', '<a class="btn btn-sm" href="#/tasks/calendar">Open calendar</a>')}${m.overdueEvents.length ? `<p class="small">${m.overdueEvents.length} past-due item${m.overdueEvents.length === 1 ? '' : 's'} are shown first in the <a href="#/tasks/calendar">calendar</a>.</p>` : ''}${mini(up, 'Nothing is coming up. Add dates to tasks, projects, invoices or agreements and they will appear here.', (e) => `<li><div class="list-text">${e.open ? `<button type="button" class="link-btn" data-action="${e.open}" data-id="${esc(e.id)}">${esc(e.title)}</button>` : `<a href="${e.href}">${esc(e.title)}</a>`}<span class="small muted">${esc(EVENT_TYPES[e.type])}${e.sub ? ` · ${esc(e.sub)}` : ''}</span></div><span class="small">${esc(fmt.date(e.date))}</span></li>`)}`)}</section>
        <section>${card(`${sectionHead('Recent activity', 'What changed lately, including saved scope comparisons.', '<a class="btn btn-sm" href="#/tasks/log">See all</a>')}${activityList(db, recent, { limit: 8 })}`)}</section>
      </div>
      ${card(`${sectionHead('Business health summary', 'Plain totals and statuses. These are counts and sums of what you recorded. They are not forecasts, and received money is not the same as profit.')}
        ${D.byId ? `<dl class="kv">
          <dt>Projects</dt><dd>${esc(sum(h.projectsByStatus))}</dd>
          <dt>Invoices</dt><dd>${esc(sum(h.invoicesByStatus))}</dd>
          <dt>Tasks</dt><dd>${esc(sum(h.tasksByStatus))}</dd>
          <dt>Open leads</dt><dd>${h.leadsOpen}</dd>
          <dt>Scope changes waiting</dt><dd>${h.changesOpen}</dd>
          <dt>Saved comparisons</dt><dd>${db.comparisons.length}</dd></dl>` : ''}`)}`,
  };
}

export { empty };
