// demo.js — optional sample data. Only used when someone clicks "Load demo data". Every record is flagged demo:true
// so it can be shown with a "Demo" label and removed in one click. All dates are relative to today.

import { uid } from './utils.js';
import { addDays } from './domain.js';
import { analyzeRequest, buildResponseDraft, ENGINE_ID, composeAgreementText } from './ai.js';

const iso = (date, time = '10:00:00') => `${date}T${time}.000Z`;

export function buildDemo(today, business = '') {
  const d = (n) => addDays(today, n);
  const stamp = (n) => iso(d(n));
  const base = (n = -30) => ({ id: uid(), createdAt: stamp(n), updatedAt: stamp(n), demo: true });

  const c1 = { ...base(-45), name: 'Asha Rao', company: 'Sunrise Bakery', email: 'asha@sunrisebakery.example', phone: '+91 98765 43210', address: '12 Mill Road\nPune 411001', type: 'Small business', status: 'Active', prevStatus: '', notes: 'Prefers WhatsApp for quick questions. Pays by bank transfer.' };
  const c2 = { ...base(-70), name: 'Daniel Wright', company: 'Northwind Studio', email: 'daniel@northwind.example', phone: '+44 20 7946 0000', address: '', type: 'Company', status: 'Active', prevStatus: '', notes: 'Slow to reply on Mondays.' };
  const c3 = { ...base(-5), name: 'Meera Joshi', company: '', email: 'meera@example.com', phone: '', address: '', type: 'Individual', status: 'Lead', prevStatus: '', notes: 'Asked about a portfolio site.' };

  const l1 = { ...base(-14), name: 'Kabir Shah', company: 'Shah Fitness', email: 'kabir@shahfitness.example', phone: '', source: 'Referral', estimatedValue: 80000, nextFollowUp: d(-2), status: 'Proposal Sent', notes: 'Sent the proposal last week.', clientId: '' };
  const l2 = { ...base(-6), name: 'Priya Nair', company: '', email: 'priya@example.com', phone: '', source: 'Website', estimatedValue: 35000, nextFollowUp: d(5), status: 'Contacted', notes: '', clientId: '' };
  const l3 = { ...base(-3), name: 'Omar Ali', company: 'Ali Traders', email: 'omar@alitraders.example', phone: '', source: 'Social media', estimatedValue: 55000, nextFollowUp: '', status: 'Won', notes: 'Agreed on the phone. Ready to become a client.', clientId: '' };

  const a1 = { ...base(-42), title: 'Website design agreement', clientId: c1.id, projectId: '', scope: [
    'A 5-page responsive website: Home, About, Menu, Gallery and Contact.',
    'The contact page will include a contact form with name, email and message fields.',
    'Menu items will be supplied by the client, up to 30 items.',
    'Basic on-page SEO: page titles and meta descriptions for each page.',
    'The website will be delivered within 8 weeks of the deposit.',
  ].join('\n'), deliverables: '5-page responsive website\nContact form\nBasic SEO setup', exclusions: 'online ordering\npayment processing\nphotography', revisions: 'Up to 2 rounds of revisions', conditions: '40% deposit before work starts\nBalance due on delivery', startDate: d(-40), endDate: d(25), value: 90000, status: 'Active', prevStatus: '', notes: 'Sample agreement. Made up.', renewedAt: '', renewedToId: '', renewalOfId: '' };
  const a2 = { ...base(-62), title: 'Logo refresh agreement', clientId: c2.id, projectId: '', scope: 'Three logo concepts will be presented.\nOne round of revisions on the chosen concept.\nFinal files delivered as SVG and PNG.', deliverables: '3 logo concepts\nFinal logo files', exclusions: 'brand guidelines\nstationery design', revisions: 'One round of revisions', conditions: '', startDate: d(-60), endDate: d(-3), value: 40000, status: 'Active', prevStatus: '', notes: '', renewedAt: '', renewedToId: '', renewalOfId: '' };
  const a3 = { ...base(-4), title: 'Brand guidelines proposal', clientId: c2.id, projectId: '', scope: 'A brand guidelines document covering colours, typography and logo use.', deliverables: 'Brand guidelines PDF', exclusions: '', revisions: '', conditions: '', startDate: '', endDate: '', value: 25000, status: 'Draft', prevStatus: '', notes: '', renewedAt: '', renewedToId: '', renewalOfId: '' };

  const p1 = { ...base(-40), name: 'Sunrise Bakery website', clientId: c1.id, description: 'A five-page website with a contact form.', startDate: d(-40), dueDate: d(20), value: 90000, status: 'In Progress', progress: 55, agreementId: a1.id, notes: '', archived: false };
  const p2 = { ...base(-60), name: 'Northwind logo refresh', clientId: c2.id, description: 'Refresh the studio logo.', startDate: d(-60), dueDate: d(-5), value: 40000, status: 'In Progress', progress: 90, agreementId: a2.id, notes: 'Waiting on final feedback.', archived: false };
  const p3 = { ...base(-4), name: 'Northwind brand guidelines', clientId: c2.id, description: '', startDate: '', dueDate: d(45), value: 25000, status: 'Not Started', progress: 0, agreementId: a3.id, notes: '', archived: false };
  const p4 = { ...base(-50), name: 'Bakery recipe photography', clientId: c1.id, description: 'One-day photo shoot.', startDate: d(-50), dueDate: d(-30), value: 15000, status: 'Completed', progress: 100, agreementId: '', notes: '', archived: false };
  a1.projectId = p1.id; a2.projectId = p2.id; a3.projectId = p3.id;

  const inv = (o) => ({ ...base(-30), status: 'Unpaid', notes: '', ...o });
  const i1 = inv({ number: 'DEMO-001', clientId: c1.id, projectId: p1.id, description: 'Website deposit (40%)', amount: 36000, issueDate: d(-38), dueDate: d(-24) });
  const i2 = inv({ number: 'DEMO-002', clientId: c1.id, projectId: p1.id, description: 'Website milestone 2', amount: 30000, issueDate: d(-10), dueDate: d(4) });
  const i3 = inv({ number: 'DEMO-003', clientId: c2.id, projectId: p2.id, description: 'Logo concepts', amount: 20000, issueDate: d(-50), dueDate: d(-20) });
  const i4 = inv({ number: 'DEMO-004', clientId: c2.id, projectId: p2.id, description: 'Logo final delivery', amount: 20000, issueDate: d(0), dueDate: d(14), status: 'Draft' });
  const i5 = inv({ number: 'DEMO-005', clientId: c1.id, projectId: p4.id, description: 'Recipe photography', amount: 15000, issueDate: d(-32), dueDate: d(-25) });

  const tx = (o) => ({ ...base(-20), method: '', reference: '', notes: '', ...o });
  const t1 = tx({ clientId: c1.id, invoiceId: i1.id, projectId: p1.id, amount: 36000, date: d(-36), method: 'Bank transfer', reference: 'UTR-DEMO-1001' });
  const t2 = tx({ clientId: c1.id, invoiceId: i2.id, projectId: p1.id, amount: 10000, date: d(-2), method: 'UPI', reference: 'UPI-DEMO-2002', notes: 'Part payment' });
  const t3 = tx({ clientId: c1.id, invoiceId: i5.id, projectId: p4.id, amount: 15000, date: d(-28), method: 'Bank transfer' });

  const tk = (o) => ({ ...base(-10), description: '', priority: 'Medium', status: 'To Do', completedAt: '', ...o });
  const k1 = tk({ title: 'Send homepage draft to Asha', dueDate: d(0), priority: 'High', status: 'In Progress', clientId: c1.id, projectId: p1.id });
  const k2 = tk({ title: 'Chase Northwind about the logo payment', dueDate: d(-2), priority: 'High', clientId: c2.id, projectId: p2.id, description: 'INV-0003 is overdue.' });
  const k3 = tk({ title: 'Outline the brand guidelines', dueDate: d(3), clientId: c2.id, projectId: p3.id });
  const k4 = tk({ title: 'Call Kabir about the proposal', dueDate: d(1), priority: 'Low', clientId: '', projectId: '' });
  const k5 = tk({ title: 'Back up the photo files', dueDate: d(-20), status: 'Done', completedAt: stamp(-19), clientId: c1.id, projectId: p4.id });

  const request = 'Hi! Could you also add an online ordering form so customers can pre-order cakes?\nAlso please change the number of pages from 5 to 7, we want a Blog and a Careers page.\nCan you make the site look more modern?';
  const out = analyzeRequest({ agreement: a1, requestText: request });
  const cmp = out.ok ? { ...base(-5), clientId: c1.id, clientName: c1.name, agreementId: a1.id, agreementTitle: a1.title, projectId: p1.id, projectName: p1.name, requestText: request, context: 'Sent by email.', constraints: '', agreementText: '', manualAgreement: false, engine: ENGINE_ID, result: out.result, response: buildResponseDraft({ business, clientName: c1.name, agreementTitle: a1.title, result: out.result }), responseEdited: false } : null;
  void composeAgreementText;

  const sc = { ...base(-5), title: 'Add an online ordering form', description: 'Asha asked for pre-orders on the site. The agreement lists online ordering as not included.', clientId: c1.id, projectId: p1.id, agreementId: a1.id, dateRequested: d(-5), additionalPrice: 12000, status: 'Discussing', notes: 'Sent a quote by email.', history: [{ at: stamp(-5), status: 'Needs Review', note: 'Recorded' }, { at: stamp(-3), status: 'Discussing', note: 'Quote sent' }] };

  const act = (n, type, text, refs) => ({ id: uid(), at: iso(d(n), '09:30:00'), type, text, refs, demo: true });
  const activity = [
    act(-45, 'client_created', 'Client added: Asha Rao', { clientId: c1.id }),
    act(-42, 'agreement_created', 'Agreement added: Website design agreement', { agreementId: a1.id, clientId: c1.id }),
    act(-40, 'project_created', 'Project created: Sunrise Bakery website', { projectId: p1.id, clientId: c1.id }),
    act(-36, 'payment_recorded', 'Payment recorded: 36,000 from Asha Rao for INV-0001', { invoiceId: i1.id, clientId: c1.id }),
    act(-5, 'comparison_saved', cmp ? `Scope check saved for Asha Rao: ${cmp.result.summary}` : 'Scope check saved', { comparisonId: cmp ? cmp.id : '', clientId: c1.id }),
    act(-5, 'scope_change_created', 'Scope change recorded: Add an online ordering form', { changeId: sc.id, clientId: c1.id, projectId: p1.id }),
    act(-2, 'payment_recorded', 'Payment recorded: 10,000 from Asha Rao for INV-0002', { invoiceId: i2.id, clientId: c1.id }),
  ];

  const l3Client = { ...base(-1), name: 'Omar Ali', company: 'Ali Traders', email: 'omar@alitraders.example', phone: '', address: '', type: 'Small business', status: 'Active', prevStatus: '', notes: '' };
  void l3Client;

  return {
    clients: [c1, c2, c3], leads: [l1, l2, l3], projects: [p1, p2, p3, p4], agreements: [a1, a2, a3], invoices: [i1, i2, i3, i4, i5],
    transactions: [t1, t2, t3], tasks: [k1, k2, k3, k4, k5], comparisons: cmp ? [cmp] : [], scopeChanges: [sc], activity,
  };
}
