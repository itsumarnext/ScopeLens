# WorkSphare

**Catch the changes nobody noticed.**

WorkSphare helps freelancers, independent developers, designers and small agencies compare the **original project agreement** with **later client requests**. It flags potentially new requirements, changed deliverables, removals and unclear wording, so you can talk to the client with a clear record.

**Version 3 turns it into one workspace** for your whole client business: clients and leads, projects, invoices and payments, agreements and renewals, tasks and a calendar, and the WorkSphare AI scope-creep check. The original project-comparison tool is still available under *WorkSphare AI → Classic projects* (`#/ai/classic`).

It is a static website: HTML, CSS and plain JavaScript. No server, no account, no paid API, no build step. Your projects are saved **only in your own browser**.

> WorkSphare is an aid for reviewing requirements. It is **not** legal advice and never decides that a client is wrong or that payment is owed.

---

## 1. What is in this folder

```
WorkSphare/
├── index.html            App shell, icon sprite, privacy policy (CSP) meta tag
├── css/
│   └── styles.css        The whole neutral white design, responsive + print rules
├── js/
│   ├── app.js            Router, state, buttons, forms, import/export wiring
│   ├── storage.js        IndexedDB storage (+ in-memory fallback), small preferences
│   ├── projects.js       Data model, validation, comparisons, history, import/export, demo
│   ├── comparison.js     The comparison engine (word diff + requirement matching)
│   ├── report.js         Client report (HTML/JSON) and the suggested client message
│   ├── views.js          Screens (returns HTML strings; all user text is escaped)
│   ├── ui.js             Icons, toasts, accessible dialogs
│   └── utils.js          Dates, escaping, download, clipboard, small helpers
├── assets/
│   └── worksphare-logo.png, worksphare-icon.png, favicon.png, apple-touch-icon.png   WorkSphare logo files
├── tests/
│   ├── engine.test.mjs   Unit tests (Node)
│   └── e2e.mjs           Browser tests (Playwright) — optional, for developers
├── package.json          Only marks the folder as ES modules for the Node tests
└── README.md
```

Every file is needed except `tests/` and `package.json`, which you can leave out when deploying.

## 2. How to run it

WorkSphare uses JavaScript **modules** (`import … from './x.js'`). Browsers refuse to load modules from `file://` pages (opening `index.html` by double-tapping it), and browser storage can also behave differently or be blocked on `file://`. So it must be served from a web address. Two easy ways:

### On a computer
```bash
cd WorkSphare
python3 -m http.server 8000
```
Open <http://localhost:8000>.  (Or `npx serve`.)

### On an Android phone (no computer)
**Option A — deploy it, then open the link on your phone (recommended).** See section 5. Once it is on free hosting you can open it in Chrome and use *Add to Home screen*.

**Option B — Termux (runs on the phone itself).**
1. Install **Termux** from F-Droid (the Play Store version is outdated).
2. In Termux: `pkg install python`
3. Copy the `WorkSphare` folder to the phone (for example into Downloads), then `termux-setup-storage` and `cd ~/storage/downloads/WorkSphare` (adjust the path).
4. Run `python -m http.server 8000`, then open `http://localhost:8000` in Chrome.

### Getting the files onto your phone
You have a ZIP (`WorkSphare.zip`). Extract it with any file manager (for example the built-in Files app, or *ZArchiver*). The folder structure must stay exactly as listed above.

## 3. Using WorkSphare

1. **Create project** — only the name is required.
2. **Original agreement** — paste what you and your client agreed (proposal, contract, email, notes) and save it. Use one requirement per line or sentence for the best results. Editing it later shows a warning, and the old version is kept as an earlier version.
3. **Client requests** — add each client request with the date received, an optional source (email, chat, meeting…), reference and notes. You paste the text yourself; WorkSphare never reads your messages.
4. **Compare** — compare the original agreement with the selected requests, *or* with a full updated scope you paste in.
5. **Review results** — mark each as *Real change*, *Not a change* or *Ask the client*, and add notes. Filter by type and status. A **Word changes** tab shows added and removed words.
6. **Report** — create a client-ready report. Use **Print or save as PDF** (choose “Save as PDF” in the print dialog), **Download HTML**, or **Export JSON**.
7. **Client message** — a neutral message built from your real findings. Edit it, then **Copy message**.
8. **History** — a timeline of everything, showing the date *you* recorded for each request separately from when it was *added to WorkSphare*.

**Backups** (sidebar) downloads all projects as a JSON file and restores them again. Imports are validated and never overwrite existing projects (duplicates are added as “restored copy”). A clearly-labelled **sample project** can be loaded and removed there.

## 4. How the comparison works (and where it can be wrong)

Everything runs in your browser using fixed, visible rules. There is **no AI model** and nothing is uploaded.

- **Text comparison:** word-by-word diff that ignores capitalisation, punctuation and line breaks, so reformatting alone is not reported as a change.
- **Requirement comparison:** text is split into bullet points and sentences; each is reduced to stemmed keywords; statements are paired by keyword overlap (Dice coefficient). Pairs that differ become *modified* (with a note on changed numbers, negations, “must/should/may” and limits such as “up to”, “unlimited”). Unpaired original statements become *potentially removed*; unpaired new ones become *potentially new*.
- **Request wording:** cue words such as “remove / drop” and “change … to / instead of” link a request to the original statement it appears to affect. A list of vague phrases (“etc”, “as needed”, “improve”, “modern”…) marks wording that needs clarification.
- **Exclusions:** if a request mentions something your original scope explicitly excludes (“does not include online ordering”), the exclusion is shown beside the finding.

**Limitations (please read):**
- Matching is by shared words, not meaning. Different words for the same thing can look new; similar words for different things can look the same.
- A sentence containing several requirements is treated as one.
- “Match confidence” only describes keyword overlap, not legal or semantic certainty.
- A request can already be covered by the agreement or a revision allowance. **You** make the final decision; use notes to record it.
- Dates are entered by you. WorkSphare cannot verify when a message was actually sent.
- Inputs are limited to about 60,000 characters per text.

## 5. Deploying for free (static hosting)

The whole app is static files, so any free static host works. Do **not** include `tests/` or `node_modules/`.

### GitHub Pages (works from a phone browser)
1. Create a free GitHub account and a new **public** repository (for example `scopelens`).
2. GitHub's mobile web upload cannot upload folders, but the editor can create them: choose **Add file → Create new file**, type the full path in the name box (for example `css/styles.css` — typing `/` makes the folder), paste the file's contents, and commit. Repeat for each file in the list in section 1 (11 files). Pasting from the files in the ZIP is fine.  
   *(On a computer you can simply drag the whole folder in with **Add file → Upload files**.)*
3. Open **Settings → Pages**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.
4. After a minute your site is at `https://YOUR-USERNAME.github.io/scopelens/`.

### Netlify Drop or Cloudflare Pages (direct upload)
Both offer a free drag-and-drop style upload of a site folder; at the time of writing they also accept a ZIP of the folder, but the sign-up and upload screens change, so check the host's current instructions. Upload the `WorkSphare` folder (with `index.html` at its top level) and you receive a public address.

> Important: browser storage belongs to each web address. Projects saved at `localhost` will **not** appear at your deployed address (or the reverse). Use **Backups** to move them.

## Feature status: what is real, what is demo, what is not included

**Real and working (saved in your browser, no fake data):** clients, leads and follow-ups, projects and the status board, invoices, part payments and overdue tracking, agreements and renewal warnings, agreement file upload (stored in your browser), tasks, calendar, activity log, dashboard figures (all calculated from your records), scope-change tracker, comparison history, settings, JSON export/import/delete-all, printable invoices, and the original Classic projects tool.

**Demo data:** none by default. A new install is empty. Sample records appear only after you press "Load demo data". They carry a "Demo" label and "Remove demo data" deletes only them.

**AI: not integrated.** There is no live AI model (no ChatGPT, Claude or other API) anywhere in the app. "WorkSphare AI" is a local word-matching rule engine (`local-rules-v1`) that runs in your browser. It sorts each client request into covered, possibly outside, outside, or unclear, and drafts a reply from templates. It can miss synonyms, misread context, and is not legal advice. The app says this on every result. It never changes an agreement, price or invoice by itself.

**Accounts and the Admin dashboard:** login, sign-up, password reset, email confirmation and the owner-only Admin dashboard are real and use Supabase Auth. They need the one-time setup below.

**Not included (and nothing pretends to be):**
- Sending email, WhatsApp or SMS. Reminders and invoices are text you copy or pages you print or save as PDF. Nothing is ever "sent".
- Real payment processing. Payments are records you enter by hand. No payment gateway, bank link or payment links.
- Teams, roles other than the single administrator, or cloud sync of business data between devices. Business data lives in one browser on one device. Two accounts on the same browser share that browser's local data.
- Reading the text of uploaded PDF/Word files or previewing them. They can be stored and downloaded only. Paste text into the agreement form to use it in comparisons.
- Multiple currencies, dark theme, time zone settings, and automatic backups. Export backups yourself.
- Uploaded agreement files are not part of the JSON backup.

**Tested vs not tested:** the login, password-reset, confirmation and admin flows were tested only against a built-in imitation of Supabase and a local PostgreSQL, **not against your real Supabase project** (it was not reachable from the build environment). Real email delivery, your project's email settings and redirect URLs are untested. Tested in Chromium at 360, 768 and 1280 px with automated tests (see Tests). Not tested on a real Android or iOS device, Safari or Firefox, or by actually printing an invoice to PDF.

---

## Accounts and the Admin dashboard

**What goes online:** your email address and sign-up time (held by Supabase Auth), your password (held by Supabase Auth as a hash, never visible to WorkSphare), and one row per successful login (your user id and the time) in the `login_events` table. **Nothing else.** Clients, projects, invoices, payments, agreements, tasks, files and comparisons never leave the browser. This is also disclosed on the sign-up and login pages.

**Pages:** `#/login`, `#/signup`, `#/forgot`, `#/reset-password` (opened from the emailed link), and `#/admin`. Everything else needs login; logged-out visitors are redirected to the login page. Sessions persist across refreshes and restarts until you log out. A refresh never counts as a login; only a successful login (or confirming/reset link) does.

**Who is the administrator:** only the confirmed account `itsumarnext@gmail.com`. There is no admin sign-up. The check happens inside the database (`public.is_admin()` looks the logged-in account up in `auth.users`), and every admin statistic is served by functions that refuse everyone else with "not authorized". Hiding the Admin link and redirecting from `#/admin` in JavaScript is only convenience; a normal user who calls the database directly is refused. `login_events` cannot be read, changed or deleted through the API by anyone; users can only add their own row (at most one per 30 seconds).

**Definitions (calculated in SQL):** Total users = all accounts. Total logins = recorded successful logins. Logins this month / today = in the current calendar month / day in the admin's browser time zone. MAU = different users who logged in this month. Average MAU = mean of MAU over every month from the first recorded login to now (including the current, partial month). New users = accounts created in the period. Returning users = users who logged in on 2 or more different days. Logins from before the migration was run are not counted.

### One-time setup (about 10 minutes)

1. **Run the SQL.** Supabase dashboard → SQL Editor → New query → paste `supabase/migrations/001_auth_analytics.sql` → Run. It is safe to run again.
2. **Allow the site address.** Authentication → URL Configuration: set *Site URL* to where WorkSphare is hosted (for example `https://yourname.github.io/WorkSphare/`) and add the same address to *Redirect URLs*. Confirmation and reset emails link back here. For local testing also add `http://localhost:8765/index.html`.
3. **Keep "Confirm email" turned ON** (Authentication → Sign In / Providers → Email). This is required: it stops anyone from claiming the admin address without owning the inbox, and the database also refuses admin access to unconfirmed accounts.
4. **Create the administrator account first:** open WorkSphare → Create an account with `itsumarnext@gmail.com`, then click the link in the confirmation email. After login an **Admin** item appears in the sidebar.
5. Optional: Authentication → Email: set a stronger minimum password length and, for real traffic, configure custom SMTP (Supabase's built-in email sender is heavily rate-limited).

Never put a *service role* or *secret* key anywhere in this project. The publishable key in `js/auth/config.js` is meant to be public.

**Tests:** `bash tests/sql-test.sh` (30 checks of the SQL and its security rules on a local PostgreSQL), `node tests/e2e-auth.mjs` (88 browser checks against an in-memory imitation of Supabase). These do **not** talk to your real Supabase project: see "Tested vs not tested" above.

## 6. Privacy and storage

Where things are kept (all in your browser; the only online data is the login described in "Accounts and the Admin dashboard"):

| Place | Key / name | What it holds |
|---|---|---|
| `localStorage` | `scopelens_data_v1` | One JSON document: settings, clients, leads, projects, agreements, invoices, transactions, tasks, comparisons, scope changes, activity log. Has a `schema` number. |
| `sessionStorage` | `scopelens_session_v1` | Temporary screen state only (filters, a half-filled compare form). Gone when the tab closes. |
| IndexedDB | `scopelens_files_v1` | Uploaded agreement files (max 5 MB each). Not included in JSON backups. |
| IndexedDB / `localStorage` | `projects` store, `scopelens:` keys | The classic projects tool. Untouched by the workspace and has its own backup under *Classic projects*. |

- If saved data cannot be read, WorkSphare keeps a copy under `scopelens_data_v1_unreadable_<time>` and starts empty instead of overwriting it.
- If the browser is full, the change is rolled back and you are told; nothing is half-saved.
- Settings → Data & Storage: export a JSON backup, import one (checked first; replaces current data after you confirm), or delete everything (type DELETE).
- **Clearing browser data, private browsing or losing the device can delete your data.** Export backups regularly and keep them private.
- No third-party analytics, trackers, scripts, fonts or images. The Content-Security-Policy allows connections to one host only: your Supabase project. Only the public (publishable) key is in the code. There is no sync of business data between devices.

## 7. Tests (optional, for developers)

```bash
node --test tests/engine.test.mjs        # comparison engine and classic tool
node --test tests/workspace.test.mjs     # money, invoices, storage, backup, dashboard rules
# browser tests: serve the folder on :8765 and run (needs Playwright + Chromium)
python3 -m http.server 8765 &
node tests/e2e.mjs             # classic tool
node tests/e2e-workspace.mjs   # workspace flows
node tests/e2e-auth.mjs        # login, sessions, admin gate
bash tests/sql-test.sh         # database rules (needs local PostgreSQL)
```

## 8. Not included in this version

See "Feature status" above for the full list (no live AI, no email/chat sending, no payment processing, no accounts or sync).

## Accessibility

Labelled form fields, visible focus outlines, keyboard-operable dialogs (Esc closes), a skip link, 44px touch targets, status shown with text and shape (never colour alone), and no horizontal scrolling down to 360px wide.

## UI notes

The interface uses a 4/8/12/16/24/32/40 px spacing scale, plain-English labels, and one subtle purple accent (focus ring, current page, next step, added words). There is a light theme only; no dark theme exists.
