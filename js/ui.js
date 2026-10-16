// ui.js — small UI helpers: icons, toasts, and accessible dialogs (native <dialog>).

import { esc } from './utils.js';

export const icon = (name, cls = '') =>
  `<svg class="icon ${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;

export function toast(message, { error = false, timeout = 3600 } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' toast-error' : '');
  el.textContent = message;
  while (host.children.length >= 2) host.firstElementChild.remove(); // keep the stack short
  el.addEventListener('click', () => el.remove());
  host.appendChild(el);
  setTimeout(() => el.remove(), error ? timeout + 2500 : timeout);
}

function focusableFirst(root) {
  return root.querySelector('[autofocus], input:not([type=hidden]), textarea, select');
}

/** Clears and sets inline field errors inside a form. Focuses the first invalid field. */
export function showFieldErrors(form, errors = {}) {
  form.querySelectorAll('[data-error-for]').forEach((el) => { el.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  const summary = form.querySelector('[data-form-error]');
  if (summary) summary.textContent = errors._form || '';
  let first = null;
  for (const [name, msg] of Object.entries(errors)) {
    if (name === '_form') continue;
    const target = form.querySelector(`[data-error-for="${name}"]`);
    if (target) target.textContent = msg;
    const input = form.querySelector(`[name="${name}"]`);
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      if (!first) first = input;
    }
  }
  if (first) first.focus();
  else if (summary && errors._form) summary.focus?.();
}

export function readForm(form) {
  const data = {};
  new FormData(form).forEach((v, k) => { data[k] = typeof v === 'string' ? v : ''; });
  return data;
}

function mountDialog(html, cls = '') {
  const dlg = document.createElement('dialog');
  dlg.className = 'dlg ' + cls;
  dlg.innerHTML = html;
  document.body.appendChild(dlg);
  return dlg;
}

/**
 * Opens a modal confirmation. Resolves true (confirmed) or false (cancelled, Esc or backdrop).
 */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const dlg = mountDialog(`
      <form method="dialog" class="dlg-form" novalidate>
        <div class="dlg-head"><h2 class="dlg-title">${esc(title)}</h2></div>
        <div class="dlg-body"><p>${esc(message)}</p></div>
        <div class="dlg-foot">
          <button type="button" class="btn" data-dlg="cancel" autofocus>${esc(cancelLabel)}</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-dlg="ok">${esc(confirmLabel)}</button>
        </div>
      </form>`, 'dlg-small');
    let result = false;
    dlg.addEventListener('click', (e) => {
      const act = e.target.closest('[data-dlg]')?.dataset.dlg;
      if (act === 'ok') { result = true; dlg.close(); }
      else if (act === 'cancel') dlg.close();
      else if (e.target === dlg) dlg.close();
    });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    dlg.showModal();
  });
}

/** Informational dialog with a single Close button. */
export function infoDialog({ title, bodyHtml, closeLabel = 'Close', wide = false }) {
  return new Promise((resolve) => {
    const dlg = mountDialog(`
      <div class="dlg-form">
        <div class="dlg-head"><h2 class="dlg-title">${esc(title)}</h2>
          <button type="button" class="icon-btn" data-dlg="cancel" aria-label="Close">${icon('x')}</button></div>
        <div class="dlg-body">${bodyHtml}</div>
        <div class="dlg-foot"><button type="button" class="btn" data-dlg="cancel" autofocus>${esc(closeLabel)}</button></div>
      </div>`, wide ? 'dlg-wide' : '');
    dlg.addEventListener('click', (e) => {
      if (e.target.closest('[data-dlg="cancel"]') || e.target === dlg) dlg.close();
    });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(); });
    dlg.showModal();
  });
}

/**
 * Opens a modal form.
 * onSubmit(values) may return { errors:{field:msg} } to keep the dialog open, or anything else to close.
 * Resolves with the submit result, or null when cancelled.
 */
export function formDialog({ title, intro = '', bodyHtml, submitLabel = 'Save', onSubmit, wide = false }) {
  return new Promise((resolve) => {
    const dlg = mountDialog(`
      <form class="dlg-form" novalidate>
        <div class="dlg-head"><h2 class="dlg-title">${esc(title)}</h2>
          <button type="button" class="icon-btn" data-dlg="cancel" aria-label="Close">${icon('x')}</button></div>
        <div class="dlg-body">
          ${intro ? `<p class="muted">${esc(intro)}</p>` : ''}
          <p class="form-error" data-form-error role="alert" tabindex="-1"></p>
          ${bodyHtml}
        </div>
        <div class="dlg-foot">
          <button type="button" class="btn" data-dlg="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>
        </div>
      </form>`, wide ? 'dlg-wide' : '');
    const form = dlg.querySelector('form');
    let result = null;
    dlg.addEventListener('click', (e) => {
      if (e.target.closest('[data-dlg="cancel"]')) dlg.close();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const out = await onSubmit(readForm(form));
        if (out && out.errors) {
          showFieldErrors(form, out.errors);
          btn.disabled = false;
          return;
        }
        result = out === undefined ? true : out;
        dlg.close();
      } catch (err) {
        showFieldErrors(form, { _form: (err && err.message) || 'Something went wrong. Please try again.' });
        btn.disabled = false;
      }
    });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    dlg.showModal();
    const first = focusableFirst(dlg);
    if (first) first.focus();
  });
}
