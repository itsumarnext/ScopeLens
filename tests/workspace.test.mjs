// Unit tests for the workspace layer (business rules, storage, backup, request analysis).
// Run: node --test tests/workspace.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser storage stand-ins so store.js can run under Node.
class MemStorage {
  constructor() { this.m = new Map(); this.failWrites = false; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) {
    if (this.failWrites) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
    this.m.set(k, String(v));
  }
  removeItem(k) { this.m.delete(k); }
}
globalThis.localStorage = new MemStorage();
globalThis.sessionStorage = new MemStorage();

const D = await import('../js/domain.js');
const B = await import('../js/backup.js');
const S = await import('../js/store.js');
const AI = await import('../js/ai.js');
const F = await import('../js/fmt.js');

const TODAY = '2026-10-15';
const fresh = () => { localStorage.m.clear(); localStorage.failWrites = false; S.init(); };
function seed() {
  fresh();
  return S.mutate(() => {
    const c = S.add('clients', { name: 'Asha Rao', company: 'Sunrise Bakery', email: 'asha@example.com', phone: '', address: '', type: 'Small business', status: 'Active', prevStatus: '', notes: '' });
    const p = S.add('projects', { name: 'Website', clientId: c.id, description: '', startDate: '2026-09-01', dueDate: '2026-11-01', value: 50000, status: 'In Progress', progress: 40, agreementId: '', notes: '', archived: false });
    const i = S.add('invoices', { number: 'INV-0001', clientId: c.id, projectId: p.id, description: 'Design', amount: 1000, issueDate: '2026-09-01', dueDate: '2026-10-01', status: 'Unpaid', notes: '' });
    return { c, p, i };
  });
}

test('parseMoney: accepts plain numbers and rejects rubbish', () => {
  assert.equal(D.parseMoney('1,250.50').value, 1250.5);
  assert.equal(D.parseMoney('₹45000').value, 45000);
  assert.equal(D.parseMoney('').value, '');
  assert.ok(D.parseMoney('', { required: true }).error);
  assert.ok(D.parseMoney('abc').error);
  assert.ok(D.parseMoney('-5').error);
  assert.ok(D.parseMoney('1.234').error);
  assert.ok(D.parseMoney('0', { allowZero: false }).error);
});

test('dates: daysBetween and addDays are exact', () => {
  assert.equal(D.daysBetween('2026-10-01', '2026-10-15'), 14);
  assert.equal(D.daysBetween('2026-10-15', '2026-10-01'), -14);
  assert.equal(D.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(D.addDays('2026-03-01', -1), '2026-02-28');
});

test('invoice: partial payments update balance and status; overdue days are counted', () => {
  const { i } = seed();
  const db = S.data();
  let v = D.invoiceView(db, i, TODAY);
  assert.equal(v.status, 'Overdue');
  assert.equal(v.overdueDays, 14);
  assert.equal(v.balance, 1000);
  S.mutate(() => { S.add('transactions', { clientId: i.clientId, invoiceId: i.id, projectId: i.projectId, amount: 0.1, date: '2026-10-05', method: '', reference: '', notes: '' }); S.add('transactions', { clientId: i.clientId, invoiceId: i.id, projectId: i.projectId, amount: 0.2, date: '2026-10-06', method: '', reference: '', notes: '' }); });
  v = D.invoiceView(S.data(), i, TODAY);
  assert.equal(v.paid, 0.3, 'cents maths avoids 0.30000000000000004');
  assert.equal(v.balance, 999.7);
  assert.equal(v.partial, true);
  assert.equal(v.status, 'Overdue');
  S.mutate(() => { S.add('transactions', { clientId: i.clientId, invoiceId: i.id, projectId: i.projectId, amount: 999.7, date: '2026-10-07', method: '', reference: '', notes: '' }); });
  v = D.invoiceView(S.data(), i, TODAY);
  assert.equal(v.status, 'Paid');
  assert.equal(v.balance, 0);
  assert.equal(v.isOverdue, false);
});

test('invoice: draft and cancelled are never owed, and editing never marks paid', () => {
  const { i } = seed();
  for (const status of ['Draft', 'Cancelled']) {
    S.mutate(() => S.patch('invoices', i.id, { status }));
    const v = D.invoiceView(S.data(), S.data().invoices[0], TODAY);
    assert.equal(v.status, status);
    assert.equal(v.isOpen, false);
  }
  S.mutate(() => S.patch('invoices', i.id, { status: 'Unpaid', notes: 'edited' }));
  assert.equal(D.invoiceView(S.data(), S.data().invoices[0], '2026-09-10').status, 'Unpaid');
  assert.equal(D.moneyTotals(S.data(), TODAY).received, 0);
});

test('transaction rules: no overpayment, no future date, no payment on a draft', () => {
  const { i } = seed();
  const db = S.data();
  const base = { invoiceId: i.id, amount: '400', date: '2026-10-10' };
  assert.ok(D.validateTransaction(base, db, { today: TODAY }).ok);
  assert.ok(D.validateTransaction({ ...base, amount: '1000.01' }, db, { today: TODAY }).errors.amount);
  assert.ok(D.validateTransaction({ ...base, date: '2026-10-16' }, db, { today: TODAY }).errors.date);
  assert.ok(D.validateTransaction({ ...base, amount: 'x' }, db, { today: TODAY }).errors.amount);
  S.mutate(() => S.patch('invoices', i.id, { status: 'Draft' }));
  assert.ok(D.validateTransaction(base, S.data(), { today: TODAY }).errors.invoiceId);
});

test('invoice edit cannot go below what was already received', () => {
  const { i } = seed();
  S.mutate(() => S.add('transactions', { clientId: i.clientId, invoiceId: i.id, projectId: '', amount: 600, date: '2026-10-05', method: '', reference: '', notes: '' }));
  const raw = { number: 'INV-0001', clientId: i.clientId, projectId: '', description: 'x', amount: '500', issueDate: '2026-09-01', dueDate: '2026-10-01', status: 'Unpaid' };
  assert.ok(D.validateInvoice(raw, S.data(), { id: i.id }).errors.amount);
  assert.ok(D.validateInvoice({ ...raw, amount: '700' }, S.data(), { id: i.id }).ok);
  assert.ok(D.validateInvoice({ ...raw, number: 'inv-0001' }, S.data()).errors.number, 'duplicate numbers are refused');
  assert.ok(D.validateInvoice({ ...raw, dueDate: '2026-08-01' }, S.data(), { id: i.id }).errors.dueDate);
});

test('dashboard figures come from saved records and change when records change', () => {
  const { i } = seed();
  let m = D.dashboardMetrics(S.data(), TODAY);
  assert.equal(m.totals.clients, 1);
  assert.equal(m.totals.activeProjects, 1);
  assert.equal(m.totals.outstanding, 1000);
  assert.equal(m.totals.overdue, 1000);
  assert.equal(m.totals.received, 0);
  S.mutate(() => S.add('transactions', { clientId: i.clientId, invoiceId: i.id, projectId: '', amount: 250, date: '2026-10-05', method: '', reference: '', notes: '' }));
  m = D.dashboardMetrics(S.data(), TODAY);
  assert.equal(m.totals.received, 250);
  assert.equal(m.totals.outstanding, 750);
  assert.equal(m.totals.overdue, 750);
  assert.equal(m.today.overdueInvoices.length, 1);
});

test('agreements: expiring soon and expired come from the end date', () => {
  const a = { status: 'Active', endDate: '2026-10-30' };
  assert.equal(D.agreementView(a, TODAY, 30).status, 'Expiring Soon');
  assert.equal(D.agreementView(a, TODAY, 7).status, 'Active');
  assert.equal(D.agreementView({ status: 'Active', endDate: '2026-10-01' }, TODAY, 30).status, 'Expired');
  assert.equal(D.agreementView({ status: 'Draft', endDate: '2026-10-01' }, TODAY, 30).status, 'Draft');
  assert.equal(D.agreementView({ status: 'Completed', endDate: '2026-10-01' }, TODAY, 30).status, 'Completed');
});

test('clients: duplicate email is blocked; same name+company is flagged', () => {
  seed();
  const db = S.data();
  const dupEmail = D.validateClient({ name: 'Someone', email: 'ASHA@example.com' }, db);
  assert.ok(dupEmail.errors.email);
  const dupName = D.validateClient({ name: 'asha rao', company: 'sunrise bakery', email: '' }, db);
  assert.ok(dupName.ok && dupName.duplicateName);
  assert.ok(D.validateClient({ name: '' }, db).errors.name);
  assert.ok(D.validateClient({ name: 'X', email: 'nope' }, db).errors.email);
});

test('projects: dates and numbers are validated; agreement must belong to the same client', () => {
  const { c, p } = seed();
  const db = S.data();
  const ok = { name: 'A', clientId: c.id, startDate: '2026-09-01', dueDate: '2026-09-30', value: '1000', progress: '50', status: 'In Progress' };
  assert.ok(D.validateProject(ok, db).ok);
  assert.ok(D.validateProject({ ...ok, dueDate: '2026-08-01' }, db).errors.dueDate);
  assert.ok(D.validateProject({ ...ok, progress: '101' }, db).errors.progress);
  assert.ok(D.validateProject({ ...ok, value: '12x' }, db).errors.value);
  assert.ok(D.validateProject({ ...ok, clientId: '' }, db).errors.clientId);
  assert.ok(D.validateProject({ ...ok, startDate: '2026-02-31' }, db).errors.startDate);
  assert.ok(p);
});

test('calendar: events are built from tasks, projects, invoices, agreements and leads, in date order', () => {
  const { c, p } = seed();
  S.mutate(() => {
    S.add('tasks', { title: 'Call', description: '', dueDate: '2026-10-16', priority: 'High', status: 'To Do', clientId: c.id, projectId: p.id, completedAt: '' });
    S.add('tasks', { title: 'Done one', description: '', dueDate: '2026-10-16', priority: 'Low', status: 'Done', clientId: '', projectId: '', completedAt: '' });
    S.add('agreements', { title: 'Retainer', clientId: c.id, projectId: '', scope: 'x', deliverables: '', exclusions: '', revisions: '', conditions: '', startDate: '2026-01-01', endDate: '2026-10-20', value: '', status: 'Active', notes: '', renewedAt: '', renewedToId: '', renewalOfId: '' });
    S.add('leads', { name: 'Lead A', company: '', email: '', phone: '', source: '', estimatedValue: '', nextFollowUp: '2026-10-14', status: 'New', notes: '', clientId: '' });
  });
  const ev = D.calendarEvents(S.data(), TODAY, 30);
  assert.deepEqual(ev.map((e) => e.type), ['payment', 'lead', 'task', 'agreement', 'project']);
  assert.ok(ev.every((e, i) => i === 0 || ev[i - 1].date <= e.date));
});

test('store: data survives a reload (init) and the activity log is written with the change', () => {
  seed();
  S.mutate(() => S.log('client_created', 'Test entry', {}));
  const before = JSON.stringify(S.data());
  S.init();
  assert.equal(JSON.stringify(S.data().clients.map((x) => x.name)), JSON.stringify(['Asha Rao']));
  assert.ok(S.data().activity.some((a) => a.text === 'Test entry'));
  assert.ok(before.length > 100);
});

test('store: a failed save is rolled back and reported kindly', () => {
  seed();
  localStorage.failWrites = true;
  assert.throws(() => S.mutate(() => S.add('tasks', { title: 'x', description: '', dueDate: '', priority: 'Low', status: 'To Do', clientId: '', projectId: '', completedAt: '' })), /no room left/);
  assert.equal(S.data().tasks.length, 0, 'in-memory data matches what is saved');
  localStorage.failWrites = false;
});

test('store: corrupted storage does not crash and the unreadable copy is kept', () => {
  localStorage.m.clear();
  localStorage.setItem(S.DATA_KEY, '{not json');
  const h = S.init();
  assert.equal(h.corrupted, true);
  assert.equal(S.data().clients.length, 0);
  assert.ok([...localStorage.m.keys()].some((k) => k.includes('unreadable')));
  localStorage.m.clear();
  localStorage.setItem(S.DATA_KEY, JSON.stringify({ schema: 99, clients: [] }));
  assert.equal(S.init().corrupted, true);
});

test('backup: round trip keeps everything; hostile text stays plain text', () => {
  const { c } = seed();
  S.mutate(() => S.add('tasks', { title: '<img src=x onerror=alert(1)>', description: '', dueDate: '', priority: 'Low', status: 'To Do', clientId: c.id, projectId: '', completedAt: '' }));
  const env = S.exportAll();
  const res = B.validateBackup(JSON.parse(JSON.stringify(env)));
  assert.ok(res.ok, res.errors.join());
  assert.equal(res.counts.clients, 1);
  assert.equal(res.counts.invoices, 1);
  assert.equal(res.db.tasks[0].title, '<img src=x onerror=alert(1)>');
});

test('backup: rejects wrong files and repairs broken records without crashing', () => {
  assert.equal(B.validateBackup('hello').ok, false);
  assert.equal(B.validateBackup({ app: 'Other' }).ok, false);
  assert.equal(B.validateBackup({ app: 'ScopeLens', kind: 'workspace-backup', schema: 99, data: {} }).ok, false);
  assert.equal(B.validateBackup({ app: 'ScopeLens', schema: 1, projects: [] }).ok, false);
  const broken = { app: 'ScopeLens', kind: 'workspace-backup', schema: 1, data: {
    clients: [{ id: 'c1', name: 'Good' }, { id: 'c1', name: 'Repeat' }, { name: 'No id' }, { id: 'c2', name: '' }, 5],
    projects: [{ id: 'p1', name: 'Orphan', clientId: 'missing' }, { id: 'p2', name: 'Fine', clientId: 'c1', status: 'weird', progress: 900, value: 'abc', startDate: '2026-02-31' }],
    invoices: [{ id: 'i1', number: 'A', clientId: 'c1', amount: -5, issueDate: '2026-01-01', dueDate: '2026-01-02' }],
    tasks: 'nope',
  } };
  const res = B.validateBackup(broken);
  assert.ok(res.ok);
  assert.deepEqual(res.db.clients.map((c) => c.name), ['Good']);
  assert.deepEqual(res.db.projects.map((p) => p.name), ['Fine']);
  assert.equal(res.db.projects[0].status, 'Not Started');
  assert.equal(res.db.projects[0].progress, 100);
  assert.equal(res.db.projects[0].value, '');
  assert.equal(res.db.projects[0].startDate, '');
  assert.equal(res.db.invoices.length, 0);
  assert.ok(res.warnings.length >= 3);
});

test('analysis: sorts a request into covered, changed, outside and unclear, with the agreement wording', () => {
  const agreement = {
    scope: 'A 5-page responsive website: Home, About, Menu, Gallery and Contact.\nThe contact page will include a contact form with name, email and message fields.\nUp to 2 rounds of revisions are included.',
    deliverables: '', exclusions: 'online ordering\npayment processing', revisions: 'Up to 2 rounds of revisions', conditions: '',
  };
  const req = 'Could you also add an online ordering form so customers can pre-order cakes?\nPlease change the number of pages from 5 to 7.\nMake it look more modern.';
  const r = AI.analyzeRequest({ agreement, requestText: req });
  assert.ok(r.ok);
  const all = [...r.result.covered, ...r.result.possible, ...r.result.outside, ...r.result.unclear];
  assert.ok(all.length >= 3);
  const ordering = r.result.outside.find((x) => /ordering/i.test(x.request));
  assert.ok(ordering, 'online ordering is flagged as possibly outside');
  assert.match(ordering.exclusion, /online ordering/i, 'the exclusion wording is shown');
  assert.ok(r.result.possible.some((x) => /pages/.test(x.request)));
  assert.ok(r.result.nextSteps.length >= 2);
  const text = JSON.stringify(r.result);
  assert.doesNotMatch(text, /definitely|certainly|you owe|must pay|breach/i);
  const draft = AI.buildResponseDraft({ business: 'Dev Studio', clientName: 'Asha Rao', agreementTitle: 'Website agreement', result: r.result });
  assert.match(draft, /^Hi Asha,/);
  assert.match(draft, /may not be covered/);
  assert.match(draft, /Dev Studio$/);
  assert.doesNotMatch(draft, /definitely|you owe|must pay|breach/i);
});

test('analysis: revision requests point at the agreement’s own words; empty input is refused', () => {
  const agreement = { scope: 'Logo design with 2 rounds of revisions included.', revisions: 'Two rounds of revisions' };
  const r = AI.analyzeRequest({ agreement, requestText: 'Can we do another round of revisions on the logo?' });
  assert.ok(r.ok);
  assert.ok(r.result.notes.some((n) => /revision/i.test(n)));
  assert.equal(AI.analyzeRequest({ agreement, requestText: '   ' }).ok, false);
  assert.equal(AI.analyzeRequest({ agreement: { scope: '' }, requestText: 'x' }).ok, false);
});

test('analysis: extra rules typed for this check are used', () => {
  const agreement = { scope: 'A one page website.' };
  const withRule = AI.analyzeRequest({ agreement, requestText: 'We need hosting set up for the site.', constraints: 'Hosting is not included' });
  assert.ok(withRule.result.outside.some((x) => /hosting/i.test(x.exclusion)));
});

test('formatting follows settings and handles bad input', () => {
  F.configure({ currency: 'USD', dateFormat: 'dmy', numberLocale: 'en-US', currencyDisplay: 'symbol' });
  assert.equal(F.date('2026-09-05'), '05/09/2026');
  assert.equal(F.money(1234.5), '$1,234.50');
  F.configure({ currency: 'INR', dateFormat: 'medium', numberLocale: 'en-IN', currencyDisplay: 'symbol' });
  assert.equal(F.date('2026-09-05'), '5 Sep 2026');
  assert.match(F.money(125000), /1,25,000\.00/);
  assert.equal(F.date(''), '');
  assert.equal(F.money('abc'), '');
});

test('reminder text is a draft for the user to send and states the real balance', () => {
  const { i } = seed();
  const view = D.invoiceView(S.data(), i, TODAY);
  const text = D.buildReminder({ business: 'Dev Studio', client: S.data().clients[0], invoice: i, view, fmtMoney: F.money, fmtDate: F.date });
  assert.match(text, /^Hi Asha,/);
  assert.match(text, /14 days past due/);
  assert.match(text, /Balance due/);
  assert.doesNotMatch(text, /\bsent\b/i);
});
