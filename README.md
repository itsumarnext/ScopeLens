# ScopeLens

**Catch the changes nobody noticed.**

ScopeLens helps freelancers, independent developers, designers and small agencies compare the **original project agreement** with **later client requests**. It flags potentially new requirements, changed deliverables, removals and unclear wording, so you can talk to the client with a clear record.

**Version 3 turns it into one workspace** for your whole client business: clients and leads, projects, invoices and payments, agreements and renewals, tasks and a calendar, and the ScopeLens AI scope-creep check. The original project-comparison tool is still available under *ScopeLens AI → Classic projects* (`#/ai/classic`).

It is a static website: HTML, CSS and plain JavaScript. No server, no account, no paid API, no build step. Your projects are saved **only in your own browser**.

> ScopeLens is an aid for reviewing requirements. It is **not** legal advice and never decides that a client is wrong or that payment is owed.

---

## 1. What is in this folder

```
ScopeLens/
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
│   └── logo.svg          ScopeLens logo (original)
├── tests/
│   ├── engine.test.mjs   Unit tests (Node)
│   └── e2e.mjs           Browser tests (Playwright) — optional, for developers
├── package.json          Only marks the folder as ES modules for the Node tests
└── README.md
```

Every file is needed except `tests/` and `package.json`, which you can leave out when deploying.

## 2. How to run it

ScopeLens uses JavaScript **modules** (`import … from './x.js'`). Browsers refuse to load modules from `file://` pages (opening `index.html` by double-tapping it), and browser storage can also behave differently or be blocked on `file://`. So it must be served from a web address. Two easy ways:

### On a computer
```bash
cd ScopeLens
python3 -m http.server 8000
```
Open <http://localhost:8000>.  (Or `npx serve`.)

### On an Android phone (no computer)
**Option A — deploy it, then open the link on your phone (recommended).** See section 5. Once it is on free hosting you can open it in Chrome and use *Add to Home screen*.

**Option B — Termux (runs on the phone itself).**
1. Install **Termux** from F-Droid (the Play Store version is outdated).
2. In Termux: `pkg install python`
3. Copy the `ScopeLens` folder to the phone (for example into Downloads), then `termux-setup-storage` and `cd ~/storage/downloads/ScopeLens` (adjust the path).
4. Run `python -m http.server 8000`, then open `http://localhost:8000` in Chrome.

### Getting the files onto your phone
You have a ZIP (`ScopeLens.zip`). Extract it with any file manager (for example the built-in Files app, or *ZArchiver*). The folder structure must stay exactly as listed above.

## 3. Using ScopeLens

1. **Create project** — only the name is required.
2. **Original agreement** — paste what you and your client agreed (proposal, contract, email, notes) and save it. Use one requirement per line or sentence for the best results. Editing it later shows a warning, and the old version is kept as an earlier version.
3. **Client requests** — add each client request with the date received, an optional source (email, chat, meeting…), reference and notes. You paste the text yourself; ScopeLens never reads your messages.
4. **Compare** — compare the original agreement with the selected requests, *or* with a full updated scope you paste in.
5. **Review results** — mark each as *Real change*, *Not a change* or *Ask the client*, and add notes. Filter by type and status. A **Word changes** tab shows added and removed words.
6. **Report** — create a client-ready report. Use **Print or save as PDF** (choose “Save as PDF” in the print dialog), **Download HTML**, or **Export JSON**.
7. **Client message** — a neutral message built from your real findings. Edit it, then **Copy message**.
8. **History** — a timeline of everything, showing the date *you* recorded for each request separately from when it was *added to ScopeLens*.

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
- Dates are entered by you. ScopeLens cannot verify when a message was actually sent.
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
Both offer a free drag-and-drop style upload of a site folder; at the time of writing they also accept a ZIP of the folder, but the sign-up and upload screens change, so check the host's current instructions. Upload the `ScopeLens` folder (with `index.html` at its top level) and you receive a public address.

> Important: browser storage belongs to each web address. Projects saved at `localhost` will **not** appear at your deployed address (or the reverse). Use **Backups** to move them.

## 6. Privacy and storage

Where things are kept (all in your browser, nothing is uploaded):

| Place | Key / name | What it holds |
|---|---|---|
| `localStorage` | `scopelens_data_v1` | One JSON document: settings, clients, leads, projects, agreements, invoices, transactions, tasks, comparisons, scope changes, activity log. Has a `schema` number. |
| `sessionStorage` | `scopelens_session_v1` | Temporary screen state only (filters, a half-filled compare form). Gone when the tab closes. |
| IndexedDB | `scopelens_files_v1` | Uploaded agreement files (max 5 MB each). Not included in JSON backups. |
| IndexedDB / `localStorage` | `projects` store, `scopelens:` keys | The classic projects tool. Untouched by the workspace and has its own backup under *Classic projects*. |

- If saved data cannot be read, ScopeLens keeps a copy under `scopelens_data_v1_unreadable_<time>` and starts empty instead of overwriting it.
- If the browser is full, the change is rolled back and you are told; nothing is half-saved.
- Settings → Data & Storage: export a JSON backup, import one (checked first; replaces current data after you confirm), or delete everything (type DELETE).
- **Clearing browser data, private browsing or losing the device can delete your data.** Export backups regularly and keep them private.
- No analytics, trackers, third-party scripts, fonts or images. The Content-Security-Policy blocks contact with other sites. No API keys exist or are stored. There is no sync between devices.

## 6b. Known limits

- The "AI" is a local word-matching check, not a live AI model. It never claims otherwise and is not legal advice.
- Reminders and invoices are text/pages you copy or print. ScopeLens never sends email or messages.
- One currency at a time; light theme only; PDF/Word files can be stored and downloaded but not previewed or searched.
- Not tested on a physical Android device (tested in Chromium at 360, 768 and 1280 px).

## 7. Tests (optional, for developers)

```bash
node --test tests/engine.test.mjs        # comparison engine and classic tool
node --test tests/workspace.test.mjs     # money, invoices, storage, backup, dashboard rules
# browser tests: serve the folder on :8765 and run (needs Playwright + Chromium)
python3 -m http.server 8765 &
node tests/e2e.mjs             # classic tool
node tests/e2e-workspace.mjs   # workspace flows
```

## 8. Not included in this version

Accounts, teams, cloud sync, payments, email/chat integrations, recording of any kind, and AI/semantic matching. Version one only compares text that you paste in.

## Accessibility

Labelled form fields, visible focus outlines, keyboard-operable dialogs (Esc closes), a skip link, 44px touch targets, status shown with text and shape (never colour alone), and no horizontal scrolling down to 360px wide.

## UI notes

The interface uses a 4/8/12/16/24/32/40 px spacing scale, plain-English labels, and one subtle purple accent (focus ring, current page, next step, added words). There is a light theme only; no dark theme exists.
