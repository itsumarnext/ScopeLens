// admin.js — Admin dashboard. All numbers come from database functions that only the single
// administrator account may call; this file only draws them. Hiding things here is cosmetic.
import { esc } from '../utils.js';
import { pageHead } from '../ws/ui.js';
import * as Auth from './client.js';

const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
const nf = new Intl.NumberFormat('en-US');
const n = (v) => nf.format(Number(v) || 0);

export async function loadOverview() { return Auth.rpc('admin_overview', { p_tz: tz() }); }
export async function loadUsers(search = '') { return Auth.rpc('admin_list_users', { p_search: search || null, p_limit: 100, p_offset: 0 }); }

/* ----------------------------------- charts ----------------------------------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function lab(iso, monthly) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return monthly ? `${MONTHS[m - 1]} ${String(y).slice(2)}` : `${d} ${MONTHS[m - 1]}`;
}
function niceMax(v) { if (v <= 4) return 4; const p = 10 ** Math.floor(Math.log10(v)); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }

function chart({ id, title, rows, monthly, kind = 'bar', unit = '' }) {
  const W = 640, H = 230, L = 40, R = 8, T = 10, B = 30;
  const vals = rows.map((r) => Number(r.value) || 0);
  const max = niceMax(Math.max(0, ...vals));
  const iw = W - L - R, ih = H - T - B;
  const x = (i) => L + (rows.length === 1 ? iw / 2 : (iw * i) / (rows.length - 1));
  const bw = Math.max(2, (iw / rows.length) * 0.7);
  const bx = (i) => L + (iw / rows.length) * (i + 0.5);
  const y = (v) => T + ih - (v / max) * ih;
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  const step = Math.ceil(rows.length / 6);
  const grid = ticks.map((t) => `<line class="chart-grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="chart-axis" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${n(t)}</text>`).join('');
  const xl = rows.map((r, i) => (i % step === 0 || i === rows.length - 1 ? `<text class="chart-axis" x="${kind === 'bar' ? bx(i) : x(i)}" y="${H - 8}" text-anchor="middle">${esc(lab(r.label, monthly))}</text>` : '')).join('');
  let marks;
  if (kind === 'bar') marks = rows.map((r, i) => `<rect class="chart-bar" x="${bx(i) - bw / 2}" y="${y(vals[i])}" width="${bw}" height="${Math.max(0, T + ih - y(vals[i]))}" rx="2"><title>${esc(lab(r.label, monthly))}: ${n(vals[i])}${unit}</title></rect>`).join('');
  else {
    const pts = rows.map((r, i) => `${x(i)},${y(vals[i])}`).join(' ');
    marks = `<polyline class="chart-line" points="${pts}" fill="none"/>${rows.map((r, i) => `<circle class="chart-dot" cx="${x(i)}" cy="${y(vals[i])}" r="3"><title>${esc(lab(r.label, monthly))}: ${n(vals[i])}${unit}</title></circle>`).join('')}`;
  }
  const total = vals.reduce((a, b) => a + b, 0);
  const table = `<details class="mini-details"><summary>View as a table</summary><div class="table-wrap"><table class="table"><thead><tr><th>${monthly ? 'Month' : 'Day'}</th><th class="num">Value</th></tr></thead><tbody>${rows.map((r) => `<tr><td data-label="${monthly ? 'Month' : 'Day'}">${esc(lab(r.label, monthly))}</td><td class="num" data-label="Value">${n(r.value)}</td></tr>`).join('')}</tbody></table></div></details>`;
  return `<section class="card chart-card" aria-labelledby="${id}-h"><h2 id="${id}-h">${esc(title)}</h2>
    <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(title)}. Total ${n(total)}. Highest value ${n(Math.max(0, ...vals))}.">${grid}${marks}${xl}</svg>${table}</section>`;
}

/* ------------------------------------ page ------------------------------------ */

const tile = (v, label, note = '') => `<div class="stat"><span class="stat-n">${v}</span><span class="stat-l">${esc(label)}</span>${note ? `<span class="small muted">${esc(note)}</span>` : ''}</div>`;

export function usersTable(res) {
  const rows = res.users || [];
  const fmt = (iso) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const body = rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Email</th><th>Signed up</th><th>Last login</th><th class="num">Logins</th><th>Status</th></tr></thead><tbody>${rows.map((u) => `<tr>
    <td data-label="Email">${esc(u.email)}</td><td data-label="Signed up">${esc(fmt(u.created_at))}</td><td data-label="Last login">${u.last_login ? esc(fmt(u.last_login)) : 'Never'}</td><td class="num" data-label="Logins">${n(u.logins)}</td>
    <td data-label="Status"><span class="badge ${u.status === 'Active' ? 'badge-done' : u.status === 'Disabled' ? 'badge-alert' : 'badge-muted'}">${esc(u.status)}</span></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty"><h3>No users found</h3><p>Try a different search.</p></div>';
  return `<p class="muted small" aria-live="polite">Showing ${n(rows.length)} of ${n(res.total)} users.</p>${body}`;
}

export function dashboard(o, users) {
  const logins = (o.totalLogins || 0);
  return `${pageHead({ title: 'Admin dashboard', sub: 'Account statistics for ScopeLens. Only you can see this page. It contains no client, project, invoice or agreement data.', actions: '<button type="button" class="btn" data-admin-action="refresh">Refresh</button>' })}
  <section aria-labelledby="ad-sum"><h2 id="ad-sum" class="h-gap">Overview</h2>
    <div class="summary summary-6">
      ${tile(n(o.totalUsers), 'Total registered users', 'All accounts')}
      ${tile(n(logins), 'Total logins', 'Successful sign-ins')}
      ${tile(n(o.loginsThisMonth), 'Logins this month')}
      ${tile(n(o.loginsToday), 'Logins today')}
      ${tile(n(o.mau), 'Monthly active users', 'Different people who logged in this month')}
      ${tile(n(o.avgMau), 'Average MAU', `Over ${n(o.monthsCounted)} month${o.monthsCounted === 1 ? '' : 's'} with data`)}
      ${tile(n(o.newUsersThisMonth), 'New users this month')}
      ${tile(n(o.newUsersToday), 'New users today')}
      ${tile(n(o.returningUsers), 'Returning users', 'Logged in on 2 or more different days')}
    </div></section>
  <p class="small muted">Days and months use your time zone (${esc(o.timezone)}). Page refreshes are not counted as logins; only successful log-ins are. Counting began when analytics were switched on, so older logins are not included.</p>
  <div class="chart-grid-2">
    ${chart({ id: 'c1', title: 'New registrations, last 30 days', rows: o.registrationsDaily || [] })}
    ${chart({ id: 'c2', title: 'New registrations by month', rows: o.registrationsMonthly || [], monthly: true })}
    ${chart({ id: 'c3', title: 'Daily logins, last 30 days', rows: o.dailyLogins || [] })}
    ${chart({ id: 'c4', title: 'Monthly logins', rows: o.monthlyLogins || [], monthly: true })}
    ${chart({ id: 'c5', title: 'Monthly active users', rows: o.mauByMonth || [], monthly: true })}
    ${chart({ id: 'c6', title: 'User growth (total accounts)', rows: o.userGrowth || [], monthly: true, kind: 'line' })}
  </div>
  <section class="card" aria-labelledby="ad-users"><h2 id="ad-users">Users</h2>
    <p class="muted small">Email, signup date, last login and status only.</p>
    <div class="field"><label for="admin-search">Search by email</label><input id="admin-search" class="input" type="search" autocomplete="off" placeholder="Type part of an email"></div>
    <div id="admin-users">${usersTable(users)}</div></section>`;
}
