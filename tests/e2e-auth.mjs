// Browser tests for sign-up, login, sessions, password reset and the admin gate.
// Uses an in-memory imitation of Supabase (tests/mock-supabase.mjs). Serve the folder on :8765 first.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createState, installMock, addUser, confirmLink, ADMIN_EMAIL, SUPA } from './mock-supabase.mjs';
const require = createRequire(execSync('npm root -g').toString().trim() + '/');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8765/index.html';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const b = await chromium.launch();
const st = createState({ confirmEmail: true });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
await installMock(ctx, st);
const p = await ctx.newPage();
const errs = [], external = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error' && !/status of (400|403)/.test(m.text())) errs.push(m.text()); }); // 400/403 are the deliberate wrong-password and forbidden tests
p.on('request', r => { const u = r.url(); if (!u.startsWith('http://localhost') && !u.startsWith(SUPA) && !u.startsWith('data:')) external.push(u); });
const go = async h => { await p.goto(BASE + '#/' + h); await p.waitForTimeout(250); };
const openLink = async (frag) => { await p.goto('about:blank'); await p.goto(BASE + frag); };
const hash = () => p.evaluate(() => location.hash);
const text = () => p.locator('#view').innerText();
const visible = sel => p.locator(sel).first().isVisible().catch(() => false);
const fillSubmit = async (form, vals) => { for (const [k, v] of Object.entries(vals)) await p.fill(`form[data-auth-form="${form}"] [name="${k}"]`, v); await p.click(`form[data-auth-form="${form}"] button[type=submit]`); await p.waitForTimeout(350); };
const eventsFor = email => st.events.filter(e => e.user_id === st.users.find(u => u.email === email)?.id).length;

console.log('logged-out gate');
await go('clients'); ok((await hash()) === '#/login', 'protected page redirects to login');
ok(!(await visible('.sidebar')), 'no app navigation on the login page');
for (const r of ['', 'projects', 'payments', 'settings', 'ai', 'tasks/calendar', 'admin']) { await go(r); ok((await hash()) === '#/login', `#/${r} needs login`); }
ok(/What ScopeLens collects/.test(await p.locator('body').innerText()), 'analytics disclosure shown');

console.log('signup validation');
await go('signup');
await fillSubmit('signup', { email: '', password: '', confirm: '' });
ok(/Enter your email/.test(await text()) && /Enter a password/.test(await text()), 'empty fields explained');
await fillSubmit('signup', { email: 'nope', password: 'abcdefgh', confirm: 'abcdefgh' });
ok(/valid email/.test(await text()), 'bad email explained');
await fillSubmit('signup', { email: 'a@b.com', password: 'short', confirm: 'short' });
ok(/at least 8/.test(await text()), 'short password explained');
await fillSubmit('signup', { email: 'a@b.com', password: 'longenough1', confirm: 'different11' });
ok(/do not match/.test(await text()), 'mismatch explained');
ok(st.users.length === 0, 'nothing created while invalid');
await p.check('[data-auth-toggle]'); ok((await p.getAttribute('#au-password', 'type')) === 'text', 'show password works');

console.log('signup + email confirmation');
await go('signup'); await fillSubmit('signup', { email: 'alice@example.com', password: 'secret-pass-1', confirm: 'secret-pass-1' });
ok((await hash()) === '#/check-email' && /alice@example.com/.test(await text()), 'asked to check email');
ok(st.sent.some(m => m.type === 'signup' && m.to === 'alice@example.com'), 'confirmation email requested');
await go('login'); await fillSubmit('login', { email: 'alice@example.com', password: 'secret-pass-1' });
ok(/confirm your email/i.test(await text()) && (await visible('[data-auth-action=resend]')), 'unconfirmed login blocked with resend option');
ok(eventsFor('alice@example.com') === 0, 'no login recorded for failed login');
await p.click('[data-auth-action=resend]'); await p.waitForTimeout(250); ok(st.sent.some(m => m.again), 'resend works');
await go('signup'); await fillSubmit('signup', { email: 'alice@example.com', password: 'secret-pass-1', confirm: 'secret-pass-1' });
ok((await hash()) === '#/check-email', 'existing address does not reveal itself');
await openLink(confirmLink(st, 'alice@example.com')); await p.waitForTimeout(500);
ok((await hash()) === '#/' && /Dashboard|Add your first client/.test(await text()), 'confirmation link logs in and opens dashboard');
ok(!(await p.evaluate(() => location.href)).includes('access_token'), 'tokens removed from address bar');
ok(eventsFor('alice@example.com') === 1, 'confirmation counted once as a login');

console.log('session persistence');
await p.reload(); await p.waitForTimeout(400); ok((await hash()) === '#/' && (await visible('.sidebar')), 'still logged in after refresh');
await go('clients'); await p.reload(); await p.waitForTimeout(300);
ok(eventsFor('alice@example.com') === 1, 'refreshes are not counted as logins');
await go('login'); ok((await hash()) === '#/', 'logged-in user is sent away from login');
await go('signup'); ok((await hash()) === '#/', 'logged-in user is sent away from signup');
ok((await p.locator('#auth-user').innerText()) === 'alice@example.com', 'account email shown');
ok(!(await visible('#admin-link')), 'no Admin link for a normal user');
const stored = await p.evaluate(() => JSON.stringify(localStorage));
ok(!stored.includes('secret-pass-1'), 'password never stored in the browser');

console.log('normal user cannot reach admin');
await go('admin'); await p.waitForTimeout(300); ok((await hash()) === '#/', '#/admin redirects normal user to dashboard');
ok(!/Admin dashboard|Total registered users/.test(await text()), 'no admin content shown');
const direct = await p.evaluate(async ({ SUPA }) => {
  const s = JSON.parse(localStorage.getItem('scopelens_auth_v1'));
  const r = await fetch(`${SUPA}/rest/v1/rpc/admin_overview`, { method: 'POST', headers: { apikey: 'x', Authorization: `Bearer ${s.access_token}`, 'content-type': 'application/json' }, body: '{}' });
  return r.status;
}, { SUPA });
ok(direct === 403, 'direct database call by normal user is refused');

console.log('business data stays local');
await go('clients/add'); await p.fill('#cl-name', 'TopSecret Client Ltd'); await p.click('form[data-form="client-add"] button[type=submit]'); await p.waitForTimeout(300);
await go('payments/invoices');
ok(!st.requests.some(r => /TopSecret/.test(r.body) || /TopSecret/.test(r.path)), 'no business data sent to Supabase');
ok(st.requests.filter(r => r.path.startsWith('/rest/v1/') && !r.path.includes('rpc')).every(r => r.path === '/rest/v1/login_events'), 'only the login_events table is touched');

console.log('logout');
await p.click('[data-auth-action=logout]'); await p.waitForTimeout(400);
ok((await hash()) === '#/login', 'logout goes to login');
ok(!(await p.evaluate(() => localStorage.getItem('scopelens_auth_v1'))), 'session removed on logout');
await p.reload(); await p.waitForTimeout(300); ok((await hash()) === '#/login', 'stays logged out after refresh');
await go('clients'); ok((await hash()) === '#/login', 'protected page blocked after logout');
await p.goBack().catch(() => {}); await p.waitForTimeout(200); ok(!(await visible('.sidebar')), 'back button does not reveal the app');

console.log('login');
await p.evaluate(() => sessionStorage.clear());
await go('login'); await fillSubmit('login', { email: 'alice@example.com', password: 'wrong-wrong' });
ok(/not correct/.test(await text()), 'wrong password message');
await fillSubmit('login', { email: '', password: '' }); ok(/Enter your email/.test(await text()), 'empty login explained');
await fillSubmit('login', { email: 'alice@example.com', password: 'secret-pass-1' });
ok((await hash()) === '#/' && eventsFor('alice@example.com') === 2, 'login works and is recorded once');
ok(/TopSecret Client Ltd/.test(await (async () => { await go('clients'); return text(); })()), 'local data still there after login');
await p.click('[data-auth-action=logout]'); await p.waitForTimeout(300);
await go('clients'); await go('login'); await fillSubmit('login', { email: 'alice@example.com', password: 'secret-pass-1' });
ok((await hash()) === '#/clients', 'returns to the page you wanted after login');
await p.click('[data-auth-action=logout]'); await p.waitForTimeout(300);

console.log('forgot / reset password');
await go('forgot'); await fillSubmit('forgot', { email: 'bad' }); ok(/valid email/.test(await text()), 'forgot validates email');
await fillSubmit('forgot', { email: 'alice@example.com' });
ok((await hash()) === '#/check-email' && st.sent.some(m => m.type === 'recovery'), 'reset email requested');
await fillSubmit('forgot', {}).catch(() => {});
await go('reset-password'); ok((await hash()) === '#/login', 'reset page needs a valid emailed link');
await openLink(confirmLink(st, 'alice@example.com', 'recovery')); await p.waitForTimeout(500);
ok((await hash()) === '#/reset-password' && /Choose a new password/.test(await text()), 'reset link opens the new-password page');
ok(!(await p.evaluate(() => localStorage.getItem('scopelens_auth_v1'))), 'reset link alone does not log in');
await fillSubmit('reset', { password: 'abc', confirm: 'abc' }); ok(/at least 8/.test(await text()), 'reset validates length');
await fillSubmit('reset', { password: 'brand-new-pass', confirm: 'brand-new-pass' });
ok((await hash()) === '#/' && (await visible('.sidebar')), 'new password saves and logs in');
await p.click('[data-auth-action=logout]'); await p.waitForTimeout(300);
await go('login'); await fillSubmit('login', { email: 'alice@example.com', password: 'secret-pass-1' }); ok(/not correct/.test(await text()), 'old password no longer works');
await fillSubmit('login', { email: 'alice@example.com', password: 'brand-new-pass' }); ok((await hash()) === '#/', 'new password works');
await p.click('[data-auth-action=logout]'); await p.waitForTimeout(300);
await openLink('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'); await p.waitForTimeout(400);
ok((await hash()) === '#/login' && /expired/.test(await p.locator('body').innerText()), 'expired link explained');

console.log('administrator');
addUser(st, 'bob@example.com', 'bobs-password', true, 40);
addUser(st, 'carol@example.com', 'carols-password', true, 2);
await go('signup'); await fillSubmit('signup', { email: ADMIN_EMAIL, password: 'owner-password-1', confirm: 'owner-password-1' });
await go('login'); await fillSubmit('login', { email: ADMIN_EMAIL, password: 'owner-password-1' });
ok(/confirm your email/i.test(await text()), 'admin address cannot log in until the email is confirmed');
await openLink(confirmLink(st, ADMIN_EMAIL)); await p.waitForTimeout(700);
ok(await visible('#admin-link'), 'Admin link appears for the administrator');
await p.click('#admin-link'); await p.waitForTimeout(600);
ok((await hash()) === '#/admin' && /Admin dashboard/.test(await text()), 'admin opens dashboard');
const t = await text();
ok(new RegExp(`${st.users.length}\\s*\\n?\\s*Total registered users`).test(t), 'total users matches');
ok(/Logins this month/.test(t) && /Logins today/.test(t) && /Monthly active users/.test(t) && /Average MAU/.test(t) && /New users this month/.test(t) && /New users today/.test(t) && /Returning users/.test(t), 'all required statistics present');
ok((await p.locator('#view svg.chart').count()) === 6, 'six charts drawn');
ok(/bob@example.com/.test(t) && /carol@example.com/.test(t), 'user list shows emails');
ok(!/TopSecret/.test(t), 'no business data on admin page');
await p.fill('#admin-search', 'carol'); await p.waitForTimeout(700);
let ut = await p.locator('#admin-users').innerText(); ok(/carol/.test(ut) && !/bob@/.test(ut), 'user search filters');
await p.fill('#admin-search', 'zzzz'); await p.waitForTimeout(700); ok(/No users found/.test(await p.locator('#admin-users').innerText()), 'empty search handled');
await p.reload(); await p.waitForTimeout(700); ok((await hash()) === '#/admin' && /Admin dashboard/.test(await text()), 'admin page survives refresh');
await go(''); ok(/Dashboard|Add your first client|Business overview/.test(await text()), 'administrator also has the normal app');
const mauBefore = st.events.length;
await p.click('[data-auth-action=logout]'); await p.waitForTimeout(300);
await go('login'); await fillSubmit('login', { email: 'carol@example.com', password: 'carols-password' });
await go('admin'); ok((await hash()) === '#/' && !(await visible('#admin-link')), 'second normal user also kept out of admin');
await p.click('[data-auth-action=logout]'); await p.waitForTimeout(300);
await go('login'); await fillSubmit('login', { email: ADMIN_EMAIL, password: 'owner-password-1' });
await go('admin'); await p.waitForTimeout(500);
const num = async (label) => Number((await p.locator('.stat', { hasText: label }).first().locator('.stat-n').innerText()).replace(/,/g, ''));
const monthKey = new Date().toISOString().slice(0, 7);
ok((await num('Total logins')) === st.events.length, 'total logins equals recorded events');
ok((await num('Logins today')) === st.events.filter(e => e.t.startsWith(new Date().toISOString().slice(0, 10))).length, 'logins today correct');
ok((await num('Monthly active users')) === new Set(st.events.filter(e => e.t.startsWith(monthKey)).map(e => e.user_id)).size, 'MAU = unique users this month');
ok((await num('Total registered users')) === st.users.length, 'total users correct after more signups');
ok(mauBefore > 0, 'events were recorded');

console.log('responsive');
await p.click('[data-auth-action=logout]').catch(async () => { await p.click('#navToggle'); await p.click('[data-auth-action=logout]'); }); await p.waitForTimeout(300);
for (const w of [360, 768]) {
  await p.setViewportSize({ width: w, height: 800 });
  for (const r of ['login', 'signup', 'forgot']) { await go(r); ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `no h-scroll ${w}px #/${r}`); }
}
await go('login'); await fillSubmit('login', { email: ADMIN_EMAIL, password: 'owner-password-1' });
for (const w of [360, 768, 1280]) { await p.setViewportSize({ width: w, height: 800 }); await go('admin'); await p.waitForTimeout(400); ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `no h-scroll ${w}px admin`); }

console.log('security settings');
const csp = await p.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]').content);
ok(/connect-src https:\/\/yrkvlunvpjmuprlftauy\.supabase\.co;/.test(csp) && /script-src 'self'/.test(csp) && !/unsafe-eval|script-src[^;]*unsafe-inline/.test(csp), 'CSP allows only the Supabase host for connections');
const src = (await import('node:fs')).readFileSync(new URL('../js/auth/config.js', import.meta.url), 'utf8');
ok(/sb_publishable_/.test(src) && !/service_role|sb_secret_/.test(src), 'only the publishable key is in the frontend');
ok(external.length === 0, 'no other external requests: ' + external.join(','));
ok(errs.length === 0, 'no console errors: ' + errs.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close(); process.exit(fail ? 1 : 0);
