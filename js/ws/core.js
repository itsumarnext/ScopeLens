// ws/core.js — shared plumbing for workspace screens: saving with friendly errors, refreshing, dialogs.

import { toast, confirmDialog, formDialog, infoDialog, showFieldErrors, readForm } from '../ui.js';
import * as S from '../store.js';

export { toast, confirmDialog, formDialog, infoDialog, showFieldErrors, readForm };

let keepScroll = false;

/** Re-draws the current screen (keeps the scroll position by default). */
export function refresh({ keep = true } = {}) {
  keepScroll = keep;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
export const takeKeepScroll = () => { const k = keepScroll; keepScroll = false; return k; };
export const go = (hash) => { if (location.hash === hash) refresh({ keep: false }); else location.hash = hash; };

/** Runs a change through the store. Returns { ok, out } or { ok:false, message }. Never throws. */
export function trySave(fn) {
  try {
    return { ok: true, out: S.mutate(fn) };
  } catch (e) {
    console.error(e);
    return { ok: false, message: e instanceof S.StoreError ? e.message : 'Something went wrong. Nothing was changed.' };
  }
}

/** Like trySave, but shows an error toast when it fails and a success toast when it works. */
export function saveWithToast(fn, okMessage) {
  const r = trySave(fn);
  if (!r.ok) toast(r.message, { error: true });
  else if (okMessage) toast(okMessage);
  return r;
}

/** For dialog onSubmit handlers: returns the errors object to show when saving failed. */
export const failForm = (r) => ({ errors: { _form: r.message } });

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Links the "recently changed" screens use when they show an activity entry. */
export function activityHref(db, a) {
  const r = a.refs || {};
  const has = (coll, id) => id && db[coll].some((x) => x.id === id);
  if (has('invoices', r.invoiceId)) return `#/payments/invoice/${r.invoiceId}`;
  if (has('comparisons', r.comparisonId)) return `#/ai/result/${r.comparisonId}`;
  if (has('projects', r.projectId)) return `#/projects/details/${r.projectId}`;
  if (has('agreements', r.agreementId)) return `#/agreements/details/${r.agreementId}`;
  if (has('clients', r.clientId)) return `#/clients/history/${r.clientId}`;
  if (has('tasks', r.taskId)) return '#/tasks';
  if (has('leads', r.leadId)) return '#/clients/leads';
  if (has('scopeChanges', r.changeId)) return '#/ai/changes';
  return '';
}
