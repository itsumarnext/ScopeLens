// End-to-end checks for the workspace. Run: python3 -m http.server 8765  then  node tests/e2e-workspace.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(execSync('npm root -g').toString().trim() + '/');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8765/index.html';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const errs = [], external = [];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
await (await import('./auth-helper.mjs')).signedIn(ctx);
const p = await ctx.newPage();
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
p.on('request', r => { if (!r.url().startsWith('http://localhost') && !r.url().startsWith('data:') && !r.url().startsWith('https://yrkvlunvpjmuprlftauy.supabase.co') && !r.url().startsWith('blob:')) external.push(r.url()); });
const go = async h => { await p.goto(BASE + '#/' + h); await p.waitForTimeout(200); };
const db = () => p.evaluate(() => JSON.parse(localStorage.getItem('scopelens_data_v1') || 'null'));
const text = () => p.locator('#view').innerText();
const today = new Date().toISOString().slice(0, 10);
const ymd = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

console.log('empty state');
await go(''); ok(/Add your first client/.test(await text()), 'empty dashboard welcome');
ok((await db()) === null || (await db()).clients.length === 0, 'no data until user adds some');

console.log('clients');
await go('clients/add');
await p.fill('#cl-name', 'Test Client'); await p.fill('#cl-email', 'tc@example.com');
await p.click('form[data-form="client-add"] button[type=submit]'); await p.waitForTimeout(300);
let d = await db(); ok(d.clients.length === 1 && d.clients[0].name === 'Test Client', 'client saved');
await go('clients/add'); await p.fill('#cl-name', 'Other'); await p.fill('#cl-email', 'tc@example.com');
await p.click('form[data-form="client-add"] button[type=submit]'); await p.waitForTimeout(200);
d = await db(); ok(d.clients.length === 1, 'duplicate email blocked');
await p.reload(); await go('clients'); ok(/Test Client/.test(await text()), 'client survives reload');
await p.fill('input[type=search]', 'zzz'); await p.waitForTimeout(300); ok(!/Test Client/.test(await text()), 'search filters');
await p.fill('input[type=search]', 'test'); await p.waitForTimeout(300); ok(/Test Client/.test(await text()), 'search matches');
const cid = d.clients[0].id;

console.log('projects');
await go('projects/new?client=' + cid);
await p.fill('#pj-name', 'Website'); await p.fill('#pj-value', '10000');
await p.click('form[data-form="proj-add"] button[type=submit]'); await p.waitForTimeout(300);
d = await db(); ok(d.projects.length === 1 && d.projects[0].clientId === cid, 'project saved & linked');
const pid = d.projects[0].id;
await go('projects/board'); ok(/Website/.test(await text()), 'project on board');
await p.selectOption('.board-card select', { label: 'In Progress' }).catch(() => {});
await p.waitForTimeout(300); d = await db(); ok(d.projects[0].status === 'In Progress', 'board move changes status');
await p.reload(); d = await db(); ok(d.projects[0].status === 'In Progress', 'status persists after refresh');

console.log('invoices and partial payments');
await go('payments/invoices'); await p.click('#view [data-action="inv-new"]'); await p.waitForTimeout(200);
await p.selectOption('dialog #iv-clientId', cid); await p.fill('dialog #iv-description', 'Design work'); await p.fill('dialog #iv-amount', '1000');
await p.fill('dialog #iv-issueDate', ymd(-20)); await p.fill('dialog #iv-dueDate', ymd(-5));
await p.click('dialog button[type=submit]'); await p.waitForTimeout(300);
d = await db(); ok(d.invoices.length === 1 && d.invoices[0].amount === 1000, 'invoice saved');
ok(/Overdue/.test(await text()) && /5 days/.test(await text()), 'overdue and days overdue shown');
await go('payments/transactions'); await p.click('#view [data-action="txn-new"]'); await p.waitForTimeout(200);
await p.selectOption('dialog #tx-clientId', cid); await p.selectOption('dialog #tx-invoiceId', { index: 1 });
await p.fill('dialog #tx-amount', '400'); await p.fill('dialog #tx-date', today);
await p.click('dialog button[type=submit]'); await p.waitForTimeout(300);
await go('payments/invoices'); ok(/Overdue/.test(await text()), 'part-paid but late stays overdue');
ok(/600/.test(await text()), 'balance 600 shown');
await go('payments/transactions'); await p.click('#view [data-action="txn-new"]'); await p.waitForTimeout(200);
await p.selectOption('dialog #tx-clientId', cid); await p.selectOption('dialog #tx-invoiceId', { index: 1 });
await p.fill('dialog #tx-amount', '700'); await p.fill('dialog #tx-date', today);
await p.click('dialog button[type=submit]'); await p.waitForTimeout(300);
d = await db(); ok(d.transactions.length === 1, 'overpayment rejected');
await p.keyboard.press('Escape');
await p.reload(); await go('payments/invoices'); await p.click('a:has-text("INV"), a[href^="#/payments/invoice/"]').catch(() => {});
await p.waitForTimeout(300); ok(/Balance|Amount due|Due/i.test(await text()), 'printable invoice opens');

console.log('tasks and calendar');
await go('tasks'); await p.click('#view [data-action="task-new"]'); await p.waitForTimeout(200);
await p.fill('dialog #tk-title', 'Call client'); await p.fill('dialog #tk-dueDate', today);
await p.click('dialog button[type=submit]'); await p.waitForTimeout(300);
d = await db(); ok(d.tasks.length === 1, 'task saved');
await go('tasks/calendar'); ok(/Call client/.test(await text()), 'open task on calendar');
await go('tasks'); await p.click('.task .check, [data-action="task-toggle"]'); await p.waitForTimeout(300);
d = await db(); ok(d.tasks[0].status === 'Done', 'task toggled done');
await go('tasks/calendar'); ok(!/Call client/.test(await text()), 'done task leaves calendar');

console.log('agreement with file');
await go('agreements/add?client=' + cid);
await p.fill('#ag-title', 'Web Agreement'); await p.fill('#ag-scope', 'Design a 5 page website\nOne round of revisions');
await p.fill('#ag-exclusions', 'Hosting'); await p.fill('#ag-endDate', ymd(10));
await p.setInputFiles('#ag-file', { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
await p.click('form[data-form="agr-add"] button[type=submit]'); await p.waitForTimeout(500);
d = await db(); ok(d.agreements.length === 1, 'agreement saved');
ok(!!d.agreements[0].fileId || !!d.agreements[0].file, 'file reference stored');
await go('agreements/renewals'); ok(/Web Agreement/.test(await text()), 'expiring agreement listed');

console.log('AI compare');
await go('ai');
await p.selectOption('form[data-form="ai-compare"] select[name="clientId"]', cid); await p.waitForTimeout(200);
await p.selectOption('form[data-form="ai-compare"] select[name="agreementId"]', { index: 1 });
await p.fill('#ai-requestText, textarea[name="requestText"]', 'Please add hosting setup and also a blog page.');
await p.click('form[data-form="ai-compare"] button[type=submit]'); await p.waitForTimeout(500);
ok(/not a live AI|word-matching/i.test(await text()), 'honest engine note shown');
d = await db(); ok(d.comparisons.length === 1, 'comparison saved');
const cmpUrl = p.url(); await p.reload(); await p.waitForTimeout(300); ok(/word-matching|not a live AI/i.test(await text()), 'comparison reopens');
await go('ai/history'); ok(/Test Client/.test(await text()), 'history lists comparison');

console.log('settings: export, import, clear');
await go('settings');
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#view [data-action="data-export"]')]);
const path = await dl.path(); const fs = await import('node:fs'); const exported = JSON.parse(fs.readFileSync(path, 'utf8'));
ok(exported.app === 'WorkSphare' && exported.data.clients.length === 1, 'export has data');
fs.writeFileSync('/tmp/bad.json', '{"hello":1}');
await p.setInputFiles('[data-role="data-import"]', '/tmp/bad.json'); await p.waitForTimeout(400);
d = await db(); ok(d.clients.length === 1, 'invalid import leaves data alone');
await p.keyboard.press('Escape');
await p.click('[data-action="data-clear"], button:has-text("Delete all data")'); await p.waitForTimeout(200);
await p.fill('dialog input', 'DELETE'); await p.click('dialog button.btn-danger, dialog button[type=submit]'); await p.waitForTimeout(500);
d = await db(); ok(!d || d.clients.length === 0, 'clear-all empties data');
fs.writeFileSync('/tmp/good.json', JSON.stringify(exported));
await go('settings'); await p.setInputFiles('[data-role="data-import"]', '/tmp/good.json'); await p.waitForTimeout(300);
await p.click('dialog button.btn-primary, dialog button[type=submit], dialog button:has-text("Replace")'); await p.waitForTimeout(500);
d = await db(); ok(d && d.clients.length === 1, 'valid import restores data');

console.log('demo data');
await p.click('[data-action="data-clear"], button:has-text("Delete all data")'); await p.fill('dialog input', 'DELETE'); await p.click('dialog button.btn-danger, dialog button[type=submit]'); await p.waitForTimeout(400);
await go(''); await p.click('#view [data-action="ws-demo-load"]'); await p.waitForTimeout(500);
d = await db(); ok(d.clients.length >= 3 && d.clients.every(c => c.demo), 'demo loaded & flagged');
ok(/Demo/i.test(await text()), 'demo banner visible');

console.log('every tab opens');
for (const r of ['', 'clients', 'clients/history', 'clients/leads', 'projects', 'projects/details', 'payments', 'payments/dues', 'agreements/details', 'tasks/log', 'ai/changes', 'settings', 'help']) {
  await go(r); ok((await p.locator('#view h1').count()) > 0, 'opens #/' + r);
}

console.log('mobile');
for (const w of [360, 768]) {
  await p.setViewportSize({ width: w, height: 800 });
  for (const r of ['', 'clients', 'projects/board', 'payments/invoices', 'tasks/calendar', 'ai', 'settings']) {
    await go(r); ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `no h-scroll ${w}px #/${r}`);
  }
}
await p.setViewportSize({ width: 360, height: 800 }); await go('');
await p.click('#navToggle'); await p.waitForTimeout(200);
ok(await p.locator('.sidebar a[data-nav="payments"]').isVisible(), 'mobile drawer opens');

ok(external.length === 0, 'no external requests: ' + external.join(','));
ok(errs.length === 0, 'no console errors: ' + errs.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close(); process.exit(fail ? 1 : 0);
