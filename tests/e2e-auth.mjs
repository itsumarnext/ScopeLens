// Browser tests for Google-only sign-in, sessions, sign-out and the admin gate.
// Uses an in-memory imitation of Supabase + Google (tests/mock-supabase.mjs). Serve the folder on :8765 first.
// NOTE: the real Google consent screen cannot be automated here; see README "Google sign-in setup".
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createState, installMock, addUser, ADMIN_EMAIL, SUPA } from './mock-supabase.mjs';
const require = createRequire(execSync('npm root -g').toString().trim() + '/');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8765/index.html';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const b = await chromium.launch();
const st = createState();
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
await installMock(ctx, st);
const p = await ctx.newPage();
const errs = [], external = [], supaUrls = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error' && !/status of (401|403)/.test(m.text())) errs.push(m.text()); });
p.on('request', r => { const u = r.url(); if (u.startsWith(SUPA)) supaUrls.push(u); else if (!u.startsWith('http://localhost') && !u.startsWith('data:')) external.push(u); });
const go = async h => { await p.goto(BASE + '#/' + h); await p.waitForTimeout(250); };
const hash = () => p.evaluate(() => location.hash);
const text = () => p.locator('#view').innerText();
const visible = sel => p.locator(sel).first().isVisible().catch(() => false);
const google = async () => { await p.click('[data-auth-action=google]'); await p.waitForURL(/index\.html/, { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(700); };
const eventsFor = email => st.events.filter(e => e.user_id === st.users.find(u => u.email === email)?.id).length;

console.log('the only thing a logged-out visitor sees');
await go('');
ok((await hash()) === '#/login', 'opening the app logged-out shows the sign-in screen');
const body = await p.locator('body').innerText();
ok(/Continue with Google/.test(body), 'has "Continue with Google"');
ok((await p.locator('input').count()) === 0, 'no input fields at all (no email, password, confirm)');
ok((await p.locator('form').count()) === 0, 'no forms');
ok((await p.locator('button:visible').count()) === 1, 'exactly one button');
ok(!/sign up|create (an )?account|forgot|password|log in|email address field/i.test(body.replace(/What WorkSphare collects[\s\S]*/, '').replace(/creates your account automatically/, '')), 'no sign-up / forgot / password / separate login wording');
ok(!(await visible('.sidebar')) && !(await visible('.topbar')), 'no app navigation shown');
ok((await p.locator('#view img.brand-logo').getAttribute('alt')) === 'WorkSphare', 'WorkSphare logo shown');
ok(/What WorkSphare collects/.test(body), 'analytics disclosure shown');
for (const r of ['clients', 'projects', 'payments', 'agreements', 'tasks', 'ai', 'settings', 'help', 'admin']) { await go(r); ok((await hash()) === '#/login', `#/${r} needs Google sign-in`); }
for (const r of ['signup', 'forgot', 'reset-password', 'check-email']) { await go(r); ok((await hash()) === '#/login' && (await p.locator('input').count()) === 0, `old #/${r} page is gone`); }

console.log('google sign-in: new user');
st.google = { email: 'alice@example.com' };
await go('clients'); // remembered, so we land here after signing in
await google();
ok(st.authorizeCalls === 1 && supaUrls.some(u => /\/auth\/v1\/authorize\?provider=google&redirect_to=/.test(u)), 'sent to Supabase /authorize with provider=google');
ok((await hash()) === '#/clients' && (await visible('.sidebar')), 'returned signed-in to the page you wanted');
ok(!(await p.evaluate(() => location.href)).includes('access_token'), 'tokens removed from address bar');
ok(st.users.length === 1 && st.users[0].email === 'alice@example.com', 'account created from the Google email');
ok(eventsFor('alice@example.com') === 1, 'one login recorded');
const stored = await p.evaluate(() => JSON.stringify(localStorage));
ok(!stored.includes('google-token-should-be-ignored'), 'Google provider token is never stored');
ok((await p.locator('#auth-user').innerText()) === 'alice@example.com', 'account email shown');
ok(!(await visible('#admin-link')), 'no Admin link for a normal user');

console.log('sessions');
await p.reload(); await p.waitForTimeout(500); ok((await hash()) === '#/clients' && (await visible('.sidebar')), 'still signed in after refresh');
await go('login'); ok((await hash()) === '#/', 'signed-in user is sent from login to the dashboard');
await p.reload(); await p.waitForTimeout(300); ok(eventsFor('alice@example.com') === 1, 'refreshes are not counted as logins');
const p2 = await ctx.newPage(); await p2.goto(BASE + '#/projects'); await p2.waitForTimeout(500);
ok(/#\/projects/.test(await p2.evaluate(() => location.hash)), 'new tab shares the session'); await p2.close();

console.log('existing sessions and data keep working');
const kept = await p.evaluate(() => localStorage.getItem('scopelens_auth_v1'));
ok(!!kept && JSON.parse(kept).user.email === 'alice@example.com', 'session stored under the same key as before');
await go('clients/add'); await p.fill('#cl-name', 'TopSecret Client Ltd'); await p.click('form[data-form="client-add"] button[type=submit]'); await p.waitForTimeout(300);
ok(!st.requests.some(r => /TopSecret/.test(r.body + r.path)), 'no business data sent to Supabase');
ok(st.requests.filter(r => r.path.startsWith('/rest/v1/') && !r.path.includes('rpc')).every(r => r.path === '/rest/v1/login_events'), 'only login_events is touched');

console.log('sign out');
await p.click('[data-auth-action=logout]'); await p.waitForTimeout(400);
ok((await hash()) === '#/login' && /Continue with Google/.test(await p.locator('body').innerText()), 'sign-out returns to the Google screen');
ok(!(await p.evaluate(() => localStorage.getItem('scopelens_auth_v1'))), 'session removed');
await p.reload(); await p.waitForTimeout(300); ok((await hash()) === '#/login', 'stays signed out after refresh');
await go('clients'); ok((await hash()) === '#/login', 'protected page blocked after sign-out');
await p.goBack().catch(() => {}); await p.waitForTimeout(200); ok(!(await visible('.sidebar')), 'back button does not reveal the app');
await p.evaluate(() => sessionStorage.clear());
await go('login'); await google();
ok((await hash()) === '#/' && eventsFor('alice@example.com') === 2, 'signing in again works and counts one more login');
ok(/TopSecret Client Ltd/.test(await (async () => { await go('clients'); return text(); })()), 'local business data still there');
await p.click('[data-auth-action=logout]'); await p.waitForTimeout(300);

console.log('errors');
st.google = { error: 'access_denied', description: 'The user cancelled' };
await go('login'); await google();
ok((await hash()) === '#/login' && /cancelled|not allowed/i.test(await p.locator('body').innerText()), 'cancelled Google sign-in explained');
ok(!(await p.evaluate(() => location.href)).includes('error'), 'error details removed from address bar');
ok(!(await p.locator('[data-auth-action=google]').isDisabled()), 'button usable again after an error');
st.google = { error: 'server_error', errorCode: 'bad_oauth_callback', description: 'oops' };
await go('login'); await google(); ok(/could not be completed/i.test(await p.locator('body').innerText()), 'failed callback explained');
st.google = { error: 'server_error', errorCode: 'provider_disabled', description: 'x' };
await go('login'); await google(); ok(/not switched on/i.test(await p.locator('body').innerText()), 'provider-not-enabled explained');
await p.goto('about:blank'); await p.goto(BASE + '?error=access_denied&error_code=access_denied&error_description=Denied#/'); await p.waitForTimeout(500);
ok((await hash()) === '#/login' && /cancelled|not allowed/i.test(await p.locator('body').innerText()), 'error returned in the query string is handled');
await p.goto('about:blank'); await p.goto(BASE + '#access_token=abc&refresh_token=x&expires_in=3600&type=recovery'); await p.waitForTimeout(500);
ok((await hash()) === '#/login' && /no longer used/i.test(await p.locator('body').innerText()) && !(await p.evaluate(() => localStorage.getItem('scopelens_auth_v1'))), 'old password-reset links do not log anyone in');
await p.goto('about:blank'); await p.goto(BASE + '#access_token=forged&refresh_token=forged&expires_in=3600'); await p.waitForTimeout(600);
ok((await hash()) === '#/login' && !(await p.evaluate(() => localStorage.getItem('scopelens_auth_v1'))), 'a forged token is rejected by Supabase and nobody is logged in');

console.log('loading state');
st.google = { email: 'alice@example.com' };
await go('login');
await p.evaluate(() => { window.__label = []; new MutationObserver(() => window.__label.push(document.querySelector('[data-auth-action=google]')?.innerText)).observe(document.body, { subtree: true, childList: true, characterData: true }); });
await p.click('[data-auth-action=google]');
await p.waitForURL(/index\.html/).catch(() => {}); await p.waitForTimeout(600);
ok((await hash()) === '#/' && (await visible('.sidebar')), 'signed in after the redirect');
await p.click('[data-auth-action=logout]'); await p.waitForTimeout(300);

console.log('administrator');
addUser(st, 'bob@example.com', null, true, 40);
addUser(st, 'carol@example.com', null, true, 2);
st.google = { email: 'carol@example.com' };
await go('login'); await google(); await go('admin');
ok((await hash()) === '#/' && !(await visible('#admin-link')), 'normal user is redirected away from #/admin');
ok(!/Admin dashboard|Total registered users/.test(await text()), 'no admin content shown to normal user');
const direct = await p.evaluate(async ({ SUPA }) => {
  const s = JSON.parse(localStorage.getItem('scopelens_auth_v1'));
  const r = await fetch(`${SUPA}/rest/v1/rpc/admin_overview`, { method: 'POST', headers: { apikey: 'x', Authorization: `Bearer ${s.access_token}`, 'content-type': 'application/json' }, body: '{}' });
  return r.status;
}, { SUPA });
ok(direct === 403, 'direct database call by a normal user is refused');
await p.click('[data-auth-action=logout]'); await p.waitForTimeout(300);
st.google = { email: ADMIN_EMAIL };
await go('login'); await google();
ok(await visible('#admin-link'), 'Admin link appears for the administrator');
await p.click('#admin-link'); await p.waitForTimeout(700);
ok((await hash()) === '#/admin' && /Admin dashboard/.test(await text()), 'administrator opens the dashboard');
const t = await text();
ok(/Total registered users/.test(t) && /Logins this month/.test(t) && /Logins today/.test(t) && /Monthly active users/.test(t) && /Average MAU/.test(t) && /New users this month/.test(t) && /New users today/.test(t) && /Returning users/.test(t), 'all required statistics present');
ok((await p.locator('#view svg.chart').count()) === 6, 'six charts drawn');
ok(/bob@example.com/.test(t) && /carol@example.com/.test(t) && !/TopSecret/.test(t), 'user list shows emails only');
await p.fill('#admin-search', 'carol'); await p.waitForTimeout(700);
const ut = await p.locator('#admin-users').innerText(); ok(/carol/.test(ut) && !/bob@/.test(ut), 'user search filters');
await p.reload(); await p.waitForTimeout(700); ok((await hash()) === '#/admin' && /Admin dashboard/.test(await text()), 'admin page survives refresh');
const num = async (label) => Number((await p.locator('.stat', { hasText: label }).first().locator('.stat-n').innerText()).replace(/,/g, ''));
ok((await num('Total registered users')) === st.users.length && (await num('Total logins')) === st.events.length, 'statistics match the data');

console.log('responsive');
await p.click('[data-auth-action=logout]').catch(async () => { await p.click('#navToggle'); await p.click('[data-auth-action=logout]'); }); await p.waitForTimeout(300);
for (const w of [360, 390, 768, 1280]) {
  await p.setViewportSize({ width: w, height: 800 }); await go('login');
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `no h-scroll ${w}px sign-in`);
  ok((await p.locator('[data-auth-action=google]').boundingBox()).height >= 44, `button is touch-sized at ${w}px`);
}
await p.setViewportSize({ width: 360, height: 800 }); await go('login'); await google();
for (const w of [360, 768, 1280]) { await p.setViewportSize({ width: w, height: 800 }); await go('admin'); await p.waitForTimeout(400); ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `no h-scroll ${w}px admin`); }

console.log('security settings');
const csp = await p.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]').content);
ok(/connect-src https:\/\/yrkvlunvpjmuprlftauy\.supabase\.co;/.test(csp) && /script-src 'self'/.test(csp) && !/unsafe-eval|script-src[^;]*unsafe-inline/.test(csp), 'CSP unchanged: only the Supabase host for connections');
const fs = await import('node:fs');
const all = ['config.js', 'client.js', 'index.js', 'views.js', 'admin.js'].map(f => fs.readFileSync(new URL('../js/auth/' + f, import.meta.url), 'utf8')).join('\n');
ok(/sb_publishable_/.test(all) && !/service_role|sb_secret_|GOCSPX|client_secret/i.test(all.replace(/NEVER put a service-role or "secret" key[^\n]*/, '').replace(/No Google client secret[^\n]*/, '')), 'no secrets in frontend code');
ok(!/signUp|signIn\b|requestReset|grant_type=password|type="password"|resendConfirmation|setNewPassword/.test(all), 'no email/password code left');
ok(external.length === 0, 'no other external requests: ' + external.join(','));
ok(errs.length === 0, 'no console errors: ' + errs.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close(); process.exit(fail ? 1 : 0);
