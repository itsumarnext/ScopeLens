// End-to-end test: drives the real app in Chromium (Playwright). Run: node tests/e2e.mjs [baseUrl]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const BASE = process.argv[2] || 'http://localhost:8765/';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-'));
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };

const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
const external = [];
page.on('request', (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });

const text = async (sel) => (await page.locator(sel).first().innerText());
const hash = () => page.evaluate(() => location.hash);
const openNotes = () => page.evaluate(() => document.querySelectorAll('.note-details').forEach((d) => { d.open = true; }));
const noHScroll = async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

await page.goto(BASE);
await page.waitForSelector('h1');
check('Dashboard loads with empty state', (await text('.empty h2')).includes('No projects yet'));
check('Dashboard: no horizontal scroll at 390px', await noHScroll());

// 1. create project with only required field
await page.click('a.btn-primary:has-text("Create project")');
await page.waitForSelector('form[data-form="new-project"]');
await page.click('button:has-text("Create project")');
check('Create: empty name shows error', (await text('[data-error-for="name"]')).includes('Enter a project name'));
await page.fill('#pf-budget', 'abc'); await page.fill('#pf-name', 'Bakery site');
await page.click('form[data-form="new-project"] button[type=submit]');
check('Create: invalid budget shows error', (await text('[data-error-for="budget"]')).length > 0);
await page.fill('#pf-budget', '');
await page.click('form[data-form="new-project"] button[type=submit]');
await page.waitForSelector('form[data-form="scope"]');
check('Create: project with only name works, goes to scope', (await hash()).endsWith('/scope'));
const projectHash = (await hash()).replace('/scope', '');

// 2. save baseline
await page.click('form[data-form="scope"] button[type=submit]');
check('Scope: empty text rejected', (await text('[data-error-for="text"]')).includes('Paste'));
const BASELINE = `Deliverables:
- A 5-page responsive website: Home, About, Menu, Gallery and Contact.
- The contact page will include a contact form with name, email and message fields.
- Menu items will be supplied by the client, up to 30 items.
- Basic on-page SEO: page titles and meta descriptions for each page.
- Up to 2 rounds of revisions are included.

The agreement does not include online ordering, payment processing or photography.`;
await page.fill('#sf-date', '2026-09-01');
await page.fill('#sf-text', BASELINE);
await page.click('form[data-form="scope"] button[type=submit]');
await page.waitForSelector('.scope-text');
check('Scope: baseline saved and shown', (await text('.scope-text')).includes('5-page responsive'));

// 3. requests
await page.goto(BASE + projectHash + '/requests');
await page.waitForSelector('.empty');
const addReq = async (t, d, src) => {
  await page.click('button[data-action="request-add"]');
  await page.waitForSelector('dialog[open]');
  await page.fill('#rf-text', t); await page.fill('#rf-date', d); if (src) await page.fill('#rf-source', src);
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('dialog', { state: 'detached' });
};
await page.click('button[data-action="request-add"]');
await page.fill('#rf-text', ''); await page.click('dialog button[type=submit]');
check('Request: empty text rejected, dialog stays open', (await text('dialog [data-error-for="text"]')).includes('Add what the client asked') && await page.locator('dialog[open]').count() === 1);
await page.keyboard.press('Escape'); await page.waitForSelector('dialog', { state: 'detached' });
await addReq('Hi! Could you also add an online ordering form so customers can pre-order cakes? Thanks!', '2026-09-10', 'Email');
await addReq('Please change the number of pages from 5 to 7, we want to add a Blog and a Careers page.', '2026-09-05', 'Chat message');
await addReq("We'd like to drop the Gallery page for now.", '2026-09-12', 'Meeting');
await addReq('Can you make the site look more modern and improve the speed?', '2026-09-14', 'Chat message');
check('Requests: 4 added', await page.locator('.request').count() === 4);
const firstDate = await text('.request:first-child .request-top strong');
check('Requests: chronological by date received', firstDate.includes('5 Sept') || firstDate.includes('Sep 5') || /5.*Sep|Sep.*5/.test(firstDate), firstDate);
check('Requests: shows added-to-ScopeLens timestamp', (await text('.request .stamp')).includes('Added to ScopeLens'));

// edit request
await page.click('.request:first-child button[data-action="request-edit"]');
await page.fill('#rf-notes', 'Client was keen on this');
await page.click('dialog button[type=submit]');
await page.waitForSelector('dialog', { state: 'detached' });
check('Request: edit saved', (await text('.request:first-child')).includes('Client was keen'));

// delete request with cancel
const delBtn = page.locator('.request:last-child button[data-action="request-delete"]');
await delBtn.click(); await page.click('dialog button:has-text("Cancel")');
check('Request: delete cancel keeps it', await page.locator('.request').count() === 4);
await delBtn.click(); await page.click('dialog button:has-text("Delete request")');
await page.waitForFunction(() => document.querySelectorAll('.request').length === 3);
check('Request: delete confirm removes it', await page.locator('.request').count() === 3);
await addReq('Can you make the site look more modern and improve the speed?', '2026-09-14', 'Chat message');

// 4. refresh persistence
await page.reload(); await page.waitForSelector('.request');
check('Persistence: requests survive refresh', await page.locator('.request').count() === 4);
await page.goto(BASE + '#/'); await page.waitForSelector('.project-row');
check('Persistence: project listed after refresh', (await text('.project-name')).includes('Bakery site'));
check('Dashboard: status preview shown', (await text('.project-status')).includes('4 client requests'));

// 5-6. compare
await page.goto(BASE + projectHash + '/compare'); await page.waitForSelector('form[data-form="compare"]');
await page.click('button[data-action="select-no-requests"]');
await page.click('form[data-form="compare"] button[type=submit]');
check('Compare: no request selected -> error', (await text('[data-error-for="requests"]')).includes('Choose at least one'));
await page.click('button[data-action="select-all-requests"]');
await page.click('form[data-form="compare"] button[type=submit]');
await page.waitForSelector('.summary');
const stats = await page.$$eval('.stat', (els) => els.map((e) => e.querySelector('.stat-n').textContent));
check('Results: summary numbers real (additions, removals, modified, clarify)', stats.join(',') === '1,1,1,1', stats.join(','));
check('Results: finding cards shown', await page.locator('.finding').count() === 4, String(await page.locator('.finding').count()));
check('Results: related exclusion shown for online ordering', (await page.locator('.finding', { hasText: 'online ordering' }).first().innerText()).includes('may say this is not included'));
check('Results: no horizontal scroll', await noHScroll());

// 8-9. statuses and notes
const card = page.locator('.finding', { hasText: 'online ordering' }).first();
await card.locator('button[data-status="relevant"]').click();
check('Review: relevant chip shown', (await page.locator('.finding', { hasText: 'online ordering' }).first().innerText()).includes('Real change'));
const c2 = page.locator('.finding', { hasText: 'Gallery' }).first();
await c2.locator('button[data-status="irrelevant"]').click();
const c3 = page.locator('.finding', { hasText: 'modern' }).first();
await c3.locator('button[data-status="clarify"]').click();
await page.waitForTimeout(500);
check('Review: ambiguous -> clarify count stays 1', (await page.$$eval('.stat-n', (e) => e.map((x) => x.textContent)))[3] === '1');
await openNotes(); await page.locator('.finding', { hasText: 'online ordering' }).first().locator('textarea').fill('Covered by exclusion; will quote extra');
await openNotes(); await page.locator('.finding', { hasText: 'online ordering' }).first().locator('button:has-text("Save note")').click();
await page.waitForSelector('.toast');
await openNotes(); await page.locator('.finding', { hasText: 'online ordering' }).first().locator('textarea').fill('Covered by exclusion; quote extra');
await openNotes(); await page.locator('.finding', { hasText: 'online ordering' }).first().locator('button:has-text("Save note")').click();
await page.waitForTimeout(600);
await page.reload(); await page.waitForSelector('.finding');
await openNotes();
check('Review: statuses & notes persist', (await page.locator('.finding', { hasText: 'online ordering' }).first().locator('textarea').inputValue()).includes('quote extra'), await page.locator('.finding', { hasText: 'online ordering' }).first().locator('textarea').inputValue());
// toggle off
await page.locator('.finding', { hasText: 'Gallery' }).first().locator('button[data-status="irrelevant"]').click();
await page.waitForFunction(() => [...document.querySelectorAll('.finding')].find((f) => f.innerText.includes('Gallery'))?.innerText.includes('Not reviewed yet'));
check('Review: pressing again clears status', (await page.locator('.finding', { hasText: 'Gallery' }).first().innerText()).includes('Not reviewed yet'), (await page.locator('.finding', { hasText: 'Gallery' }).first().innerText()).slice(0, 120));
// filters
await page.selectOption('#filter-status', 'relevant');
check('Filter: status filter works', await page.locator('.finding').count() === 1);
await page.selectOption('#filter-status', 'all'); await page.selectOption('#filter-type', 'removed');
check('Filter: type filter works', await page.locator('.finding').count() === 1);
await page.selectOption('#filter-type', 'unchanged');
check('Filter: unchanged list available', await page.locator('.finding').count() >= 3);
await page.selectOption('#filter-type', 'changes');

// text comparison tab
await page.click('button[data-action="results-tab"][data-tab="text"]');
await page.waitForSelector('.diff');
check('Text diff: shows added text', await page.locator('.diff ins').count() > 0);

// message
const msg = await page.inputValue('#client-message');
check('Message: uses project name and neutral wording', msg.includes('Bakery site') && msg.includes('confirm what you need') && !/owe|must pay|violat/i.test(msg));
await page.fill('#client-message', msg + '\nPS: thanks!'); await page.locator('#client-message').blur();
await page.click('button[data-action="message-copy"]');
await page.waitForSelector('.toast:has-text("copied")');
const clip = await page.evaluate(() => navigator.clipboard.readText());
check('Message: copy to clipboard works with edited text', clip.includes('PS: thanks!'));

// 10-11. report
await page.click('a:has-text("Create report")');
await page.waitForSelector('.sl-report');
const rep = await text('.sl-report');
{ const need = ['Bakery site', 'ScopeLens', 'not legal advice', 'Real change', 'quote extra', 'PS: thanks!', 'What you confirmed']; const miss = need.filter((s) => !rep.includes(s)); check('Report: has project, branding, disclaimer, decisions, message', !miss.length, 'missing: ' + miss.join(' | ')); }
check('Report: no horizontal scroll', await noHScroll());
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button[data-action="report-download-html"]')]);
const htmlPath = path.join(tmp, 'report.html'); await dl.saveAs(htmlPath);
const html = fs.readFileSync(htmlPath, 'utf8');
check('Report: HTML download is standalone & correct', html.includes('<!doctype html>') && html.includes('Bakery site') && html.includes('sl-report') && !/<script/i.test(html));
const [dj] = await Promise.all([page.waitForEvent('download'), page.click('button[data-action="report-download-json"]')]);
const jPath = path.join(tmp, 'report.json'); await dj.saveAs(jPath);
const rj = JSON.parse(fs.readFileSync(jPath, 'utf8'));
check('Report: JSON export valid', rj.kind === 'change-report' && rj.comparison.findings.length > 0);
await page.emulateMedia({ media: 'print' });
const hidden = await page.evaluate(() => getComputedStyle(document.querySelector('.sidebar')).display === 'none' && getComputedStyle(document.querySelector('.topbar')).display === 'none');
const pdfPath = path.join(tmp, 'report.pdf');
await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
await page.emulateMedia({ media: 'screen' });
check('Print: app chrome hidden & PDF renders', hidden && fs.statSync(pdfPath).size > 5000, `${fs.statSync(pdfPath).size} bytes`);
fs.copyFileSync(pdfPath, path.join(tmp, '..', 'scopelens-sample-report.pdf'));

// history
await page.goto(BASE + projectHash + '/history'); await page.waitForSelector('.timeline');
const hist = await text('.timeline');
{ const need = ['Original agreement saved', 'Client request added', 'Comparison done', 'Result reviewed', 'Report shared or saved']; const miss = need.filter((s) => !hist.includes(s)); check('History: records baseline, requests, comparison, reviews, notes, export', !miss.length, 'missing: ' + miss.join(' | ')); }
check('History: distinguishes request date vs entered date', (await page.locator('.timeline').innerText()).includes('Added to ScopeLens'));

// baseline edit warning + revision
await page.goto(BASE + projectHash + '/scope'); await page.waitForSelector('.scope-text');
await page.click('button[data-action="scope-edit"]');
check('Baseline edit: warning dialog shown', (await text('dialog')).includes('Change the original agreement?'));
await page.click('dialog button:has-text("Cancel")');
check('Baseline edit: cancel leaves read-only', await page.locator('form[data-form="scope"]').count() === 0);
await page.click('button[data-action="scope-edit"]'); await page.click('dialog button:has-text("Yes, change it")');
await page.fill('#sf-text', BASELINE.replace('up to 30 items', 'up to 40 items'));
await page.click('form[data-form="scope"] button[type=submit]'); await page.waitForSelector('.scope-text');
check('Baseline edit: saved and revision kept', (await page.locator('.card:has-text("Earlier versions")').count()) === 1);
await page.click('button[data-action="revision-view"]');
check('Baseline: revision view shows old text', (await text('dialog')).includes('up to 30 items'));
await page.keyboard.press('Escape');

// manual mode + minor formatting
await page.goto(BASE + projectHash + '/compare'); await page.waitForSelector('form[data-form="compare"]');
await page.check('input[name="mode"][value="manual"]');
await page.click('form[data-form="compare"] button[type=submit]');
check('Manual compare: empty text rejected', (await text('[data-error-for="manualText"]')).includes('Paste'));
const reformatted = BASELINE.replace('up to 30', 'up to 40').toUpperCase().replace(/\./g, '').replace(/\n/g, '\n\n');
await page.fill('#cf-manual', reformatted);
await page.click('form[data-form="compare"] button[type=submit]'); await page.waitForSelector('.summary');
const s2 = await page.$$eval('.stat-n', (e) => e.map((x) => x.textContent));
check('Formatting-only changes (case/punctuation/line breaks) -> no findings', s2.join(',') === '0,0,0,0', s2.join(','));
check('Empty comparison state shown', (await text('#findings-list')).includes('No changes found'));
// real change
await page.goto(BASE + projectHash + '/compare'); await page.check('input[name="mode"][value="manual"]');
await page.fill('#cf-manual', BASELINE.replace('5-page', '8-page').replace('- Basic on-page SEO: page titles and meta descriptions for each page.\n', '') + '\n- Add a blog with 3 posts per month.');
await page.click('form[data-form="compare"] button[type=submit]'); await page.waitForSelector('.summary');
const s3 = await page.$$eval('.stat-n', (e) => e.map((x) => x.textContent));
check('Manual compare: addition, removal, modification detected', s3[0] === '1' && s3[2] === '1' && Number(s3[1]) >= 1, s3.join(','));
await page.click('button[data-action="results-tab"][data-tab="text"]'); await page.waitForSelector('.diff');
check('Text diff: shows both added and removed', (await page.locator('.diff ins').count()) > 0 && (await page.locator('.diff del').count()) > 0);

// 12-13. export / import
await page.goto(BASE + '#/data'); await page.waitForSelector('#import-file');
const [de] = await Promise.all([page.waitForEvent('download'), page.click('button[data-action="export-all"]')]);
const bPath = path.join(tmp, 'backup.json'); await de.saveAs(bPath);
const backup = JSON.parse(fs.readFileSync(bPath, 'utf8'));
check('Export: backup JSON has project', backup.app === 'ScopeLens' && backup.projects.length === 1 && backup.projects[0].requests.length === 4);
await page.setInputFiles('#import-file', bPath);
await page.waitForSelector('#import-result .banner');
check('Import: valid backup imported as copy', (await text('#import-result')).includes('Restored 1 project'));
await page.goto(BASE + '#/'); await page.waitForSelector('.project-row');
check('Import: both original and imported copy listed', await page.locator('.project-row').count() === 2 && (await page.locator('.project-list').innerText()).includes('restored copy'));
// corrupted
const bad = (name, content) => { const p = path.join(tmp, name); fs.writeFileSync(p, content); return p; };
await page.goto(BASE + '#/data'); await page.waitForSelector('#import-file');
for (const [name, content, expect] of [
  ['bad1.json', '{not json', 'could not be read'],
  ['bad2.json', '[1,2,3]', 'not a ScopeLens backup'],
  ['bad3.json', JSON.stringify({ app: 'Other', schema: 1, projects: [] }), 'does not look like'],
  ['bad4.json', JSON.stringify({ app: 'ScopeLens', schema: 1, projects: [{ name: '' }, 5] }), 'No usable projects'],
  ['bad5.json', JSON.stringify({ app: 'ScopeLens', schema: 99, projects: [] }), 'newer version'],
]) {
  await page.setInputFiles('#import-file', bad(name, content));
  await page.waitForFunction((e) => document.querySelector('#import-result')?.innerText.includes(e), expect);
  check(`Import: rejects ${name}`, (await text('#import-result')).includes('Nothing was changed'));
}
const hostile = JSON.parse(JSON.stringify(backup)); hostile.projects[0].name = '<img src=x onerror=alert(1)>'; hostile.projects[0].requests[0].text = '<script>alert(1)</script>'; hostile.projects[0].comparisons[0].findings[0].type = 'bogus';
await page.setInputFiles('#import-file', bad('hostile.json', JSON.stringify(hostile)));
await page.waitForFunction(() => document.querySelector('#import-result')?.innerText.includes('Restored'));
await page.goto(BASE + '#/'); await page.waitForSelector('.project-row');
check('Import: hostile markup is escaped, not executed', (await page.locator('.project-list img').count()) === 0);

// 14. empty project compare
await page.goto(BASE + '#/new'); await page.fill('#pf-name', 'Empty one'); await page.click('form button[type=submit]');
await page.waitForSelector('form[data-form="scope"]');
const emptyHash = (await hash()).replace('/scope', '');
await page.goto(BASE + emptyHash + '/compare'); await page.waitForSelector('.empty');
check('Empty project: compare asks for baseline', (await text('.empty')).includes('Add the original agreement first'));
await page.goto(BASE + emptyHash + '/requests'); await page.waitForSelector('.empty');
await page.goto(BASE + emptyHash + '/history'); await page.waitForSelector('.timeline');
check('Empty project: overview & history render', true);

// search, rename, archive, delete
await page.goto(BASE + '#/'); await page.waitForSelector('.project-row');
await page.fill('#project-search', 'empty');
check('Search: filters by name', await page.locator('.project-row').count() === 1);
await page.fill('#project-search', 'zzzz');
check('Search: no-match state', (await text('#project-list')).includes('No matching projects'));
await page.fill('#project-search', '');
await page.locator('.project-row', { hasText: 'Empty one' }).locator('summary').click();
await page.locator('.project-row', { hasText: 'Empty one' }).locator('button[data-action="project-rename"]').click(); await page.fill('#rn-name', 'Renamed one'); await page.click('dialog button[type=submit]');
await page.waitForSelector('.project-name:has-text("Renamed one")');
check('Rename works', true);
await page.locator('.project-row', { hasText: 'Renamed one' }).locator('summary').click();
await page.locator('.project-row', { hasText: 'Renamed one' }).locator('button[data-action="project-archive"]').click();
await page.waitForFunction(() => !document.body.innerText.includes('Renamed one'));
await page.click('button[data-action="list-filter"][data-value="archived"]');
await page.waitForFunction(() => document.querySelector('#project-list')?.innerText.includes('Renamed one'));
check('Archive: appears under Archived', (await text('#project-list')).includes('Renamed one'), (await text('#project-list')).slice(0, 100));
await page.locator('.project-row').first().locator('summary').click(); await page.click('button[data-action="project-restore"]');
await page.waitForFunction(() => document.querySelector('#project-list')?.innerText.includes('No archived'));
await page.click('button[data-action="list-filter"][data-value="active"]');
// delete cancel/confirm
const row = () => page.locator('.project-row', { hasText: 'Renamed one' });
await row().locator('summary').click(); await row().locator('button[data-action="project-delete"]').click(); await page.click('dialog button:has-text("Cancel")');
check('Delete: cancel keeps project', await row().count() === 1);
await row().locator('summary').click(); await row().locator('button[data-action="project-delete"]').click(); await page.click('dialog button:has-text("Delete project")');
await page.waitForFunction(() => !document.body.innerText.includes('Renamed one'));
check('Delete: confirm removes project', await row().count() === 0);

// demo
await page.goto(BASE + '#/data'); await page.click('button[data-action="demo-load"]'); await page.waitForSelector('.chip:has-text("Sample project")');
check('Demo: loads on request and is labelled', true);
await page.goto(BASE + '#/data'); await page.click('button[data-action="demo-remove"]'); await page.click('dialog button:has-text("Remove sample project")');
await page.waitForFunction(() => document.querySelector('button[data-action="demo-remove"]')?.disabled);
check('Demo: removed without touching real projects', true);
await page.goto(BASE + '#/'); await page.waitForSelector('.project-row');
check('Real projects remain after demo removal', await page.locator('.project-row', { hasText: 'Bakery site' }).count() >= 1);

// 16-17. mobile nav & keyboard
await page.click('#navToggle'); 
check('Mobile nav opens', await page.evaluate(() => document.body.classList.contains('nav-open')) && (await page.getAttribute('#navToggle', 'aria-expanded')) === 'true');
await page.click('.sidebar a[href="#/about"]'); await page.waitForSelector('h1:has-text("How it works")');
check('Mobile nav navigates and closes', !(await page.evaluate(() => document.body.classList.contains('nav-open'))));
await page.click('#navToggle'); await page.keyboard.press('Escape');
check('Mobile nav closes with Escape', !(await page.evaluate(() => document.body.classList.contains('nav-open'))));
await page.goto(BASE + '#/new');
const unlabeled = await page.$$eval('input:not([type=hidden]),select,textarea', (els) => els.filter((e) => !(e.id && document.querySelector(`label[for="${e.id}"]`)) && !e.getAttribute('aria-label')).map((e) => e.name || e.id));
check('A11y: every field has a label (create form)', unlabeled.length === 0, unlabeled.join(','));
await page.focus('#pf-name'); await page.keyboard.type('Keyboard only'); await page.keyboard.press('Enter');
await page.waitForSelector('form[data-form="scope"]');
check('Keyboard: form submits with Enter', (await hash()).endsWith('/scope'));
await page.keyboard.press('Tab');
check('Keyboard: focus visible outline style on focus', await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' || s.boxShadow !== 'none'; }));

// desktop layout
await page.setViewportSize({ width: 1280, height: 800 }); await page.goto(BASE + '#/'); await page.waitForTimeout(400);
check('Desktop: sidebar visible, topbar hidden', await page.evaluate(() => (['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(getComputedStyle(document.querySelector('.sidebar')).transform)) && getComputedStyle(document.querySelector('.topbar')).display === 'none'));
await page.screenshot({ path: path.join(tmp, '..', 'shot-desktop.png') });
await page.setViewportSize({ width: 360, height: 740 });
await page.goto(BASE + '#/about'); check('360px: no horizontal scroll', await noHScroll());


// storage failure: IndexedDB unavailable -> memory fallback with a clear warning
{
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 800 } });
  await ctx2.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { get() { return undefined; } }); });
  const p2 = await ctx2.newPage();
  const errs2 = []; p2.on('pageerror', (e) => errs2.push(e.message));
  await p2.goto(BASE); await p2.waitForSelector('.banner[role="alert"]');
  check('Storage failure: warning banner shown', (await p2.innerText('.banner[role="alert"]')).includes('not letting ScopeLens save'));
  await p2.goto(BASE + '#/new'); await p2.fill('#pf-name', 'Memory only'); await p2.click('form button[type=submit]');
  await p2.waitForSelector('form[data-form="scope"]');
  check('Storage failure: app still works in memory mode', true);
  await p2.goto(BASE + '#/data'); await p2.waitForSelector('.card');
  check('Storage failure: data page explains it', (await p2.innerText('main')).includes('only held in memory'));
  check('Storage failure: no uncaught errors', errs2.length === 0, errs2.join('|'));
  await ctx2.close();
}

check('No console/page errors', errors.length === 0, errors.join(' | '));
check('No external network requests', external.length === 0, external.join(','));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
