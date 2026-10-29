// ws/settings.js — Settings: business profile, preferences, data and storage (export, import, demo data, clear all).

import { esc, icon, fmt, field, row2, formError, pageHead, sectionHead, card, options, dl, badge } from './ui.js';
import * as D from '../domain.js';
import * as S from '../store.js';
import * as B from '../backup.js';
import * as Files from '../files.js';
import { buildDemo } from '../demo.js';
import { downloadFile, plural } from '../utils.js';
import { toast, confirmDialog, formDialog, showFieldErrors, readForm, trySave, saveWithToast, failForm, go, refresh, today } from './core.js';

let importResult = '';

const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${Math.max(0.1, n / 1024).toFixed(1)} KB`);

export function render() {
  const db = S.data();
  const s = db.settings;
  const health = S.storageHealth();
  const f = (name, label, o = {}) => field({ id: `st-${name}`, name, label, value: s[name] ?? '', ...o });
  const hasDemo = [...B.COLLECTIONS.map((c) => db[c])].flat().some((r) => r.demo);
  const counts = B.COLLECTIONS.filter((c) => c !== 'activity').map((c) => `${db[c].length} ${B.LABELS[c]}`);
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } })();
  const used = S.usage();
  return {
    title: 'Settings', nav: 'settings',
    html: `${pageHead({ title: 'Settings', sub: 'Your business details, how things are shown, and your data.' })}
      <form class="form" data-form="settings-save" novalidate>${formError()}
        ${card(`<h2>Business profile</h2><p class="muted">Shown at the top of printed invoices and used in message drafts.</p>
          ${f('businessName', 'Business or freelancer name', { max: 140 })}
          ${row2(f('email', 'Email', { kind: 'email', max: 200 }), f('phone', 'Phone', { kind: 'tel', max: 40 }))}
          ${f('currency', 'Currency', { kind: 'select', required: true, list: fmt.CURRENCIES, hint: 'One currency is used everywhere. Changing it only changes how amounts are shown. It does not convert anything.' })}
          <p class="small muted">Time zone: ${esc(tz || 'not known')} (taken from your device). Dates are always worked out in your device’s time.</p>`)}
        ${card(`<h2>Preferences</h2>
          ${row2(f('dateFormat', 'Date format', { kind: 'select', list: Object.entries(fmt.DATE_FORMATS).map(([value, label]) => ({ value, label })) }), f('numberLocale', 'Number style', { kind: 'select', list: Object.entries(fmt.NUMBER_LOCALES).map(([value, label]) => ({ value, label })) }))}
          ${row2(f('currencyDisplay', 'Show currency as', { kind: 'select', list: [{ value: 'symbol', label: 'A symbol (₹ 1,000.00)' }, { value: 'code', label: 'A code (INR 1,000.00)' }] }), f('expiryWarnDays', 'Warn me before an agreement ends', { kind: 'select', list: D.WARN_PERIODS.map((n) => ({ value: n, label: `${n} days before` })), value: s.expiryWarnDays }))}
          <div class="field"><label for="st-theme">Theme</label><p class="hint" id="st-theme-hint">Only the light theme is available right now.</p><select id="st-theme" class="input" disabled aria-describedby="st-theme-hint"><option>Light</option></select></div>`)}
        <div class="form-actions"><button class="btn btn-primary" type="submit">Save settings</button></div>
      </form>
      ${card(`<h2 id="data-storage">Data &amp; storage</h2>
        <p class="note">${icon('info')}<span><strong>Your data is stored in this browser, on this device.</strong> It does not sync to other devices or browsers, and there is no ScopeLens server. Clearing your browser’s site data, using a different browser or device, or private browsing can make it disappear. Download a backup regularly.</span></p>
        ${health.message ? `<p class="banner" role="status">${esc(health.message)}</p>` : ''}
        ${dl([['Where', `Browser storage (<code>${esc(S.DATA_KEY)}</code>)${health.mode === 'memory' ? ' <strong>(not available: held in memory only)</strong>' : ''}`], ['Space used', esc(fmtBytes(used))], ['Saved records', esc(counts.join(' · '))], ['Last saved', esc(fmt.dateTime(db.updatedAt))]])}
        <p class="small muted">Uploaded agreement files are kept in a separate part of the browser (IndexedDB) and are <strong>not</strong> included in the backup file. Classic projects are stored separately too. Back them up from Classic projects. Please do not store passwords or card details in ScopeLens.</p>
        <h3>Back up</h3><div class="card-actions"><button type="button" class="btn btn-primary" data-action="data-export">${icon('download')}Download a backup (JSON)</button></div>
        <h3>Restore</h3><p class="muted">Restoring <strong>replaces</strong> everything now in this browser with the contents of the backup. The file is checked first, and nothing changes if it is not valid.</p>
        <div class="field"><label for="import-file">Choose a backup file</label><input id="import-file" class="input" type="file" accept="application/json,.json" data-role="data-import"></div>
        <div id="import-result" aria-live="polite">${importResult}</div>
        <h3>Demo data</h3><p class="muted">Fill ScopeLens with made-up clients, projects, invoices and more, so you can try everything. Every demo record is labelled “Demo” and can be removed in one click.</p>
        <div class="card-actions"><button type="button" class="btn" data-action="ws-demo-load"${hasDemo ? ' disabled' : ''}>Load demo data</button><button type="button" class="btn btn-danger-outline" data-action="ws-demo-remove"${hasDemo ? '' : ' disabled'}>Remove demo data…</button></div>
        <h3>Clear everything</h3><p class="muted">Deletes all clients, projects, invoices, agreements, tasks, comparisons and saved files from this browser. Download a backup first.</p>
        <div class="card-actions"><button type="button" class="btn btn-danger-outline" data-action="data-clear">${icon('trash')}Clear all data…</button></div>`)}
      ${card(`<h2>Help &amp; guide</h2><p class="muted">New here? The guide explains each part of ScopeLens in plain words.</p><a class="btn" href="#/help">Open the guide</a>`)}`,
  };
}

export const forms = {
  'settings-save': (form) => {
    const r = D.validateSettings(readForm(form));
    if (!r.ok) { showFieldErrors(form, r.errors); return; }
    const res = trySave(() => { Object.assign(S.data().settings, r.values); S.log('settings_updated', 'Settings were updated.', {}); });
    if (!res.ok) { showFieldErrors(form, { _form: res.message }); return; }
    toast('Settings saved.');
    refresh({ keep: true });
  },
};

const banner = (title, lines, error) => `<div class="banner${error ? '' : ''}" role="${error ? 'alert' : 'status'}"><div><p><strong>${esc(title)}</strong></p>${lines.length ? `<ul class="plain-bullets">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}</div></div>`;

export const changes = {
  'data-import': async (el) => {
    const file = el.files && el.files[0];
    el.value = '';
    const show = (html) => { importResult = html; const box = document.getElementById('import-result'); if (box) box.innerHTML = html; };
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { show(banner('Could not restore this file. Nothing was changed.', ['The file is larger than 25 MB, which is far more than a ScopeLens backup.'], true)); return; }
    let parsed;
    try { parsed = JSON.parse(await file.text()); } catch { show(banner('Could not restore this file. Nothing was changed.', ['This file could not be read. It may be damaged, or it may not be a ScopeLens backup.'], true)); return; }
    const res = B.validateBackup(parsed);
    if (!res.ok) { show(banner('Could not restore this file. Nothing was changed.', res.errors, true)); return; }
    const incoming = B.COLLECTIONS.filter((c) => c !== 'activity').map((c) => `${res.counts[c]} ${B.LABELS[c]}`).join(', ');
    const now = S.data();
    const existing = B.COLLECTIONS.filter((c) => c !== 'activity').reduce((n, c) => n + now[c].length, 0);
    const ok = await confirmDialog({
      title: 'Replace your data with this backup?',
      message: `The backup contains ${incoming}.${res.warnings.length ? ` ${res.warnings.length} damaged entr${res.warnings.length === 1 ? 'y' : 'ies'} will be skipped.` : ''} ${existing ? `This will replace the ${plural(existing, 'record')} now in this browser. This cannot be undone. Download a backup of your current data first if you are not sure.` : 'Nothing is saved in this browser yet, so nothing will be lost.'}`,
      confirmLabel: 'Replace my data', danger: !!existing,
    });
    if (!ok) { show(banner('Restore cancelled. Nothing was changed.', [], false)); return; }
    try {
      S.importBackup(parsed);
    } catch (e) {
      show(banner('Could not restore this file. Nothing was changed.', [e.message || 'Saving failed.'], true));
      return;
    }
    importResult = banner('Backup restored.', [`Restored ${incoming}.`, ...res.warnings.slice(0, 5), 'Uploaded agreement files are not part of a backup, so files you saved before are only here if you restored into the same browser.'], false);
    toast('Backup restored.');
    refresh({ keep: false });
  },
};

export const actions = {
  'data-export': () => {
    const env = S.exportAll();
    downloadFile(`scopelens-backup-${today()}.json`, JSON.stringify(env, null, 2), 'application/json');
    toast('Backup downloaded. Keep it somewhere safe.');
  },

  'ws-demo-load': () => {
    const db = S.data();
    if ([...B.COLLECTIONS.map((c) => db[c])].flat().some((r) => r.demo)) { toast('Demo data is already loaded.'); return; }
    const demo = buildDemo(today(), db.settings.businessName);
    const r = saveWithToast(() => {
      const live = S.data();
      for (const c of B.COLLECTIONS) live[c].push(...demo[c]);
      S.log('demo_loaded', 'Demo data was loaded. It is made up and labelled “Demo”.', {});
    }, 'Demo data loaded. It is labelled “Demo”.');
    if (r.ok) go('#/');
  },
  'ws-demo-remove': async () => {
    const ok = await confirmDialog({ title: 'Remove the demo data?', message: 'All demo clients, projects, invoices and other demo records will be deleted. Anything you added yourself stays, unless it was linked to a demo client or project and cannot exist without it.', confirmLabel: 'Remove demo data', danger: true });
    if (!ok) return;
    const r = trySave(() => {
      const live = S.data();
      const kept = { ...live };
      for (const c of B.COLLECTIONS) kept[c] = live[c].filter((x) => !x.demo);
      const { db } = B.sanitizeDb(kept);
      for (const c of B.COLLECTIONS) live[c] = db[c];
      S.log('demo_removed', 'Demo data was removed.', {});
    });
    if (!r.ok) { toast(r.message, { error: true }); return; }
    toast('Demo data removed.');
    refresh({ keep: false });
  },

  'data-clear': async () => {
    const done = await formDialog({
      title: 'Clear all data?', submitLabel: 'Delete everything',
      intro: 'This permanently deletes every client, project, invoice, agreement, task, comparison, note and saved file in this browser. It cannot be undone.',
      bodyHtml: field({ id: 'cl-confirm', name: 'confirm', label: 'Type DELETE to confirm', required: true, max: 10 }),
      onSubmit: (raw) => {
        if (String(raw.confirm || '').trim() !== 'DELETE') return { errors: { confirm: 'Type the word DELETE in capital letters to go ahead.' } };
        return true;
      },
    });
    if (!done) return;
    S.clearAll();
    try { await Files.clearFiles(); } catch { /* no files saved */ }
    importResult = '';
    toast('All data was cleared from this browser.');
    go('#/');
  },
};

export { badge, sectionHead, options, go };
