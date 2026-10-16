// Unit tests for the comparison engine and import validation. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { diffText, compareScope, summarizeFindings, splitStatements, collapseChunks } from '../js/comparison.js';
import { validateImport, validateProjectFields, validateRequestFields, newProject, saveBaseline, addRequest, runComparison, setFindingStatus, exportEnvelope } from '../js/projects.js';
import { buildClientMessage, buildReportBody, buildReportJSON } from '../js/report.js';

const ORIG = `Deliverables:
- A 5-page responsive website: Home, About, Menu, Gallery and Contact.
- The contact page will include a contact form with name, email and message fields.
- Menu items will be supplied by the client, up to 30 items.
- Up to 2 rounds of revisions are included.
The agreement does not include online ordering or photography.`;

test('diff: identical text ignoring case/punctuation/whitespace', () => {
  const d = diffText('The site has 5 pages. Contact form included.', 'the SITE has five pages!\n\n contact form   included');
  assert.equal(d.identical, true);
  assert.equal(d.stats.added + d.stats.removed, 0);
});
test('diff: detects added and removed words', () => {
  const d = diffText('We build a website with five pages', 'We build a website with eight pages and a blog');
  assert.deepEqual([d.stats.added, d.stats.removed], [4, 1]);
  assert.ok(d.chunks.some((c) => c.type === 'add' && c.text.includes('blog')));
  assert.ok(d.chunks.some((c) => c.type === 'del' && c.text.includes('five')));
});
test('diff: empty inputs do not crash', () => {
  assert.equal(diffText('', '').identical, true);
  assert.equal(diffText('', 'new words here').stats.added, 3);
  assert.equal(diffText('old words', '').stats.removed, 2);
});
test('diff: very large unrelated texts stay responsive and flagged approximate', () => {
  const a = Array.from({ length: 6000 }, (_, i) => 'alpha' + i).join(' ');
  const b = Array.from({ length: 6000 }, (_, i) => 'beta' + i).join(' ');
  const t = Date.now();
  const d = diffText(a, b);
  assert.ok(Date.now() - t < 3000);
  assert.equal(d.stats.approximate, true);
});
test('collapseChunks hides long unchanged runs', () => {
  const long = Array.from({ length: 80 }, (_, i) => 'w' + i).join(' ');
  const d = diffText(long + ' old ' + long, long + ' new ' + long);
  assert.ok(collapseChunks(d.chunks, 5).some((c) => c.type === 'gap' && c.hidden > 50));
});
test('splitStatements: bullets, sentences, headings, abbreviations, wrapped lines', () => {
  const s = splitStatements('Deliverables:\n- Home page, e.g. with a hero image.\n- About page. Contact page.\nThe site will be fast\nand light.\nSCOPE');
  assert.deepEqual(s.map((x) => x.text), ['Home page, e.g. with a hero image.', 'About page.', 'Contact page.', 'The site will be fast and light.']);
});
test('requests mode: new, modified, removed, ambiguous, exclusion hint', () => {
  const r = compareScope({ originalText: ORIG, mode: 'requests', requests: [
    { id: 'a', text: 'Could you also add an online ordering form?' },
    { id: 'b', text: 'Please change the number of pages from 5 to 7.' },
    { id: 'c', text: "Let's drop the Gallery page." },
    { id: 'd', text: 'Can you make it look more modern?' },
  ] });
  const by = (t) => r.findings.filter((f) => f.type === t);
  assert.equal(by('new').length, 1);
  assert.ok(by('new')[0].related.text.includes('does not include online ordering'));
  assert.equal(by('modified').length, 1);
  assert.equal(by('removed').length, 1);
  assert.equal(by('ambiguous').length, 1);
  assert.ok(by('removed')[0].original.includes('Gallery'));
});
test('requests mode: a request restating the scope is a possible duplicate, not new', () => {
  const r = compareScope({ originalText: ORIG, mode: 'requests', requests: [{ id: 'a', text: 'Up to 2 rounds of revisions are included.' }] });
  assert.equal(r.findings.filter((f) => f.type === 'duplicate').length, 1);
  assert.equal(r.findings.filter((f) => f.type === 'new').length, 0);
});
test('requests mode: courtesy-only messages produce nothing', () => {
  const r = compareScope({ originalText: ORIG, mode: 'requests', requests: [{ id: 'a', text: 'Hi! Thanks, sounds good.' }] });
  assert.equal(r.findings.filter((f) => f.type !== 'unchanged').length, 0);
});
test('manual mode: formatting-only changes yield no findings', () => {
  const r = compareScope({ originalText: ORIG, mode: 'manual', manualText: ORIG.toUpperCase().replace(/\./g, '').replace(/\n/g, '\n\n') });
  assert.equal(summarizeFindings(r.findings).flagged, 0);
});
test('manual mode: minor connecting-word change is not flagged', () => {
  const r = compareScope({ originalText: ORIG, mode: 'manual', manualText: ORIG.replace('The contact page will include a contact form', 'The contact page will include the contact form') });
  assert.equal(summarizeFindings(r.findings).flagged, 0);
});
test('manual mode: number, negation and removal are caught with reasons', () => {
  const upd = ORIG.replace('5-page', '8-page').replace('- Up to 2 rounds of revisions are included.\n', '').replace('does not include', 'includes') + '\n- Add a blog.';
  const r = compareScope({ originalText: ORIG, mode: 'manual', manualText: upd });
  const s = summarizeFindings(r.findings);
  assert.equal(s.additions, 1);
  assert.equal(s.removals, 1);
  assert.ok(s.modified >= 2);
  assert.ok(r.findings.find((f) => f.type === 'modified' && f.flags.some((x) => x.startsWith('Numbers'))));
});
test('summary counts reflect review status', () => {
  const r = compareScope({ originalText: ORIG, mode: 'requests', requests: [{ id: 'd', text: 'Can you make it look more modern?' }] });
  assert.equal(summarizeFindings(r.findings).clarify, 1);
  r.findings.find((f) => f.type === 'ambiguous').status = 'irrelevant';
  assert.equal(summarizeFindings(r.findings).clarify, 0);
});
test('empty updated text: everything is potentially removed', () => {
  const r = compareScope({ originalText: ORIG, mode: 'manual', manualText: 'x' });
  assert.ok(summarizeFindings(r.findings).removals >= 4);
});

test('project validation', () => {
  assert.ok(validateProjectFields({ name: 'A' }).ok);
  assert.ok(validateProjectFields({ name: '' }).errors.name);
  assert.ok(validateProjectFields({ name: 'A', budget: '-5' }).errors.budget);
  assert.ok(validateProjectFields({ name: 'A', budget: 'abc' }).errors.budget);
  assert.ok(validateProjectFields({ name: 'A', startDate: '2026-13-40' }).errors.startDate);
  assert.ok(validateProjectFields({ name: 'A', currency: 'XXX' }).errors.currency);
  assert.ok(validateRequestFields({ text: 'x', date: '' }).errors.date);
});

function sample() {
  const p = newProject({ name: 'T', client: 'Asha Rao', description: '', startDate: '', budget: '', currency: 'INR' });
  saveBaseline(p, { title: 'Scope', date: '2026-09-01', text: ORIG });
  addRequest(p, { text: 'Please add an online ordering form.', date: '2026-09-10', source: 'Email', reference: '', notes: '' });
  return p;
}
test('baseline revisions are kept when edited', () => {
  const p = sample();
  saveBaseline(p, { title: 'Scope', date: '2026-09-01', text: ORIG + '\n- Extra.' });
  assert.equal(p.baselineRevisions.length, 1);
  assert.equal(p.baselineRevisions[0].text, ORIG);
});
test('runComparison validates and carries decisions over', () => {
  const p = sample();
  assert.equal(runComparison(p, { mode: 'requests', requestIds: [] }).ok, false);
  const first = runComparison(p, { mode: 'requests', requestIds: p.requests.map((r) => r.id) });
  const f = first.comparison.findings.find((x) => x.type === 'new');
  setFindingStatus(p, first.comparison, f.id, 'relevant');
  const second = runComparison(p, { mode: 'requests', requestIds: p.requests.map((r) => r.id) });
  assert.equal(second.carried, 1);
  assert.equal(second.comparison.findings.find((x) => x.type === 'new').status, 'relevant');
});
test('client message: uses real details, neutral, no payment claim', () => {
  const p = sample();
  const c = runComparison(p, { mode: 'requests', requestIds: p.requests.map((r) => r.id) }).comparison;
  const m = buildClientMessage(p, c);
  assert.match(m, /^Hi Asha,/);
  assert.match(m, /online ordering form/);
  assert.match(m, /changes to the agreed cost/);
  assert.doesNotMatch(m, /you owe|must pay|breach|violat/i);
});
test('report: separates detected from decided and escapes HTML', () => {
  const p = sample();
  p.name = '<b>X</b>';
  const c = runComparison(p, { mode: 'requests', requestIds: p.requests.map((r) => r.id) }).comparison;
  const html = buildReportBody(p, c);
  assert.ok(html.includes('&lt;b&gt;X&lt;/b&gt;'));
  assert.ok(html.includes('Reviewer decision') && html.includes('Not reviewed'));
  assert.ok(html.includes('not a legal determination'));
  assert.equal(buildReportJSON(p, c).kind, 'change-report');
});
test('import validation: accepts round trip, rejects garbage', () => {
  const p = sample();
  runComparison(p, { mode: 'requests', requestIds: p.requests.map((r) => r.id) });
  const ok = validateImport(JSON.parse(JSON.stringify(exportEnvelope([p]))));
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.projects[0].comparisons[0].findings.length, p.comparisons[0].findings.length);
  for (const bad of [null, 5, 'x', [], {}, { app: 'ScopeLens' }, { app: 'ScopeLens', schema: 1 }, { app: 'ScopeLens', schema: 1, projects: [{}] }, { app: 'ScopeLens', schema: 9, projects: [] }]) {
    assert.ok(validateImport(bad).errors.length > 0, JSON.stringify(bad));
  }
  const evil = JSON.parse(JSON.stringify(exportEnvelope([p])));
  evil.projects[0].comparisons[0].findings[0].type = 'hax';
  evil.projects[0].budget = 'NaN';
  evil.projects[0].requests[0].date = 'not a date';
  const r = validateImport(evil);
  assert.equal(r.errors.length, 0);
  assert.equal(r.projects[0].comparisons[0].findings.every((f) => ['new', 'modified', 'removed', 'ambiguous', 'duplicate', 'unchanged'].includes(f.type)), true);
  assert.equal(r.projects[0].budget, '');
});
