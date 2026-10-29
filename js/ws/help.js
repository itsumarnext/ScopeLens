// ws/help.js — Help & Guide.

import { esc, icon, pageHead, card } from './ui.js';

const topic = (title, body, open = false) => `<details class="topic"${open ? ' open' : ''}><summary>${esc(title)}</summary><div class="topic-body">${body}</div></details>`;

export function render() {
  return {
    title: 'Help & Guide', nav: 'help',
    html: `${pageHead({ title: 'Help & Guide', sub: 'How ScopeLens works, in plain words.' })}
      ${card(`<h2>Getting started</h2><ol class="plain-bullets steps-list">
        <li><strong>Add your details.</strong> Open <a href="#/settings">Settings</a> and enter your business name, email and currency. They appear on printed invoices.</li>
        <li><strong>Add a client.</strong> Go to <a href="#/clients/add">Clients → Add client</a>. Only the name is required. If someone is not a client yet, add them as a lead first.</li>
        <li><strong>Create a project</strong> in <a href="#/projects/new">Projects</a> and link it to the client.</li>
        <li><strong>Add the agreement</strong> in <a href="#/agreements/add">Agreements</a>. Paste the agreed scope, the deliverables and what is not included.</li>
        <li><strong>Create invoices and record payments</strong> in <a href="#/payments">Payments</a>. Balances and overdue days are worked out for you.</li>
        <li><strong>Add tasks</strong> in <a href="#/tasks">Activity &amp; Tasks</a> so nothing slips.</li>
        <li><strong>Check a new request</strong> in <a href="#/ai">ScopeLens AI</a> when a client asks for more.</li></ol>
        <p class="muted">Want to look around first? Open <a href="#/settings">Settings</a> and choose “Load demo data”. It is clearly labelled and easy to remove.</p>`)}
      ${card(`<h2>How to…</h2>
        ${topic('Add and manage clients', '<p>Use <strong>Clients → Add client</strong>. Open a client from <strong>Client history</strong> to see their projects, agreements, invoices, payments, tasks and activity in one place. Everything there links to the real records.</p><p><strong>Leads &amp; follow-ups</strong> tracks people before a deal. When a lead is marked <em>Won</em>, choose <em>Make a client</em> and the details are copied across.</p><p>Archiving hides a client without deleting anything. A client who has projects, invoices or other records cannot be deleted. Archive them instead.</p>')}
        ${topic('Create projects and use the board', '<p>A project belongs to a client. The <strong>Project board</strong> shows projects in columns by status. Drag a card to another column, or use the <em>Move to</em> menu on the card (this works with a keyboard and on phones). Moving a project to <em>Completed</em> also sets its progress to 100%.</p>')}
        ${topic('Store agreements and watch renewals', '<p>Type or paste the agreement text, deliverables, what is not included, and the revision limit. You can also add a file. Text files are read into the text box. PDF and Word files are kept on this device only, and you should paste their text if you want to compare requests against them.</p><p><strong>Renewals &amp; expiring</strong> lists agreements about to end. <em>Create renewal</em> makes a new agreement and leaves the old one untouched.</p>')}
        ${topic('Invoices, payments and balances', '<p>Create an invoice, then record each payment you receive. You can record several part payments on one invoice. The invoice shows <em>Partially Paid</em> until the balance is zero, then <em>Paid</em>. If the due date passes with money still owed it shows <em>Overdue</em> and how many days late.</p><p>Opening or editing an invoice never marks it as paid. Only a recorded payment does. <em>Draft</em> and <em>Cancelled</em> invoices are not counted as money owed.</p><p>To invoice a client, open the invoice and choose <em>Print or save as PDF</em>. ScopeLens does <strong>not</strong> send invoices or reminders. The reminder is a message for you to copy and send yourself.</p>')}
        ${topic('Tasks, calendar and the activity log', '<p>Tasks can be linked to a client and a project. The <strong>Calendar</strong> brings together task dates, project due dates, payment due dates, agreement end dates and lead follow-ups, each labelled by type. The <strong>Activity log</strong> records what you do in ScopeLens. It cannot see emails or calls, but you can add a note for those.</p>')}
        ${topic('Compare a client request', '<p>In <strong>ScopeLens AI → Compare a request</strong>, choose the client, choose an agreement (or paste one), paste what the client asked for, and compare. You get: what appears covered, what may change agreed work, what may be outside the scope, what is unclear, the agreement wording behind each point, suggested next steps, and a polite draft reply you can edit and copy.</p><p><strong>Important:</strong> this check runs in your browser using word-matching rules. It is not a live AI model, it can miss meaning, and it is not legal advice. It never says that something is definitely extra work. Always read the agreement yourself. Results are saved in <em>Comparison history</em>. Use the <em>Scope change tracker</em> to record changes you discuss with the client. Nothing in your agreements, projects or prices changes automatically.</p>')}
      `)}
      ${card(`<h2>Where your data lives</h2><ul class="plain-bullets">
        <li>Everything is saved in <strong>this browser, on this device</strong>. There is no account and no server, and nothing is uploaded.</li>
        <li>It does <strong>not</strong> sync. Another browser or device starts empty.</li>
        <li>Clearing your browser’s site data, or using private/incognito mode, can erase it. <strong>Download a backup</strong> from <a href="#/settings">Settings</a> regularly and keep it somewhere safe.</li>
        <li>Browsers limit how much a site can store. If saving fails, ScopeLens tells you and keeps your earlier data.</li>
        <li>Backups do not include uploaded agreement files. Those stay in the browser they were added in.</li>
        <li>This is a personal, local tool, not secure multi-user storage. Do not put passwords or card details in it.</li></ul>`)}
      ${card(`<h2>Classic projects</h2><p class="muted">The original ScopeLens (one agreement per project, word-by-word comparison and printable reports) is still available under <a href="#/ai/classic">ScopeLens AI → Classic projects</a>. Its projects are stored separately and have their own backup.</p>`)}
      <p class="muted">${icon('shield')} Your data stays on your device.</p>`,
  };
}
