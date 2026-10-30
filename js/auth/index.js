// index.js — session gate, auth page handlers and Admin routing.
import { toast, showFieldErrors, readForm } from '../ui.js';
import * as C from './client.js';
import * as V from './views.js';
import * as A from './admin.js';
import { MIN_PASSWORD } from './config.js';

const AUTH_PAGES = ['login', 'signup', 'forgot', 'check-email'];
const NEXT_KEY = 'scopelens_next';
let recovery = null;        // tokens from a password-reset link (memory only)
let flash = null;           // one message shown on the next auth page
let adminKnown = null;      // null = unknown, true/false after the database answered
let mailNote = { addr: '', kind: 'signup' };
let rerender = () => {};

const first = (parts) => (parts[0] || '').split('?')[0];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* ------------------------------------ start ----------------------------------- */

export async function init(onRoute) {
  rerender = onRoute;
  const frag = C.readLinkFragment(location.hash);
  if (frag) {
    history.replaceState(null, '', location.pathname + location.search); // never leave tokens in the address bar
    if (frag.error) { flash = { error: true, text: 'That link is invalid or has expired. Please request a new one.' }; location.hash = '#/login'; }
    else if (frag.type === 'recovery') { recovery = frag; location.hash = '#/reset-password'; }
    else {
      try { await C.adoptTokens(frag); flash = { text: 'Your email is confirmed. Welcome to WorkSphare.' }; location.hash = '#/'; }
      catch (e) { flash = { error: true, text: C.friendly(e) }; location.hash = '#/login'; }
    }
  }
  C.restore();
  await C.ensureSession();
  C.onChange((s) => {
    adminKnown = null;
    chrome();
    if (!s) { location.hash = '#/login'; rerender(); } else checkAdmin();
  });
  chrome();
  if (C.isSignedIn()) checkAdmin();
}

/* ------------------------------------ chrome ---------------------------------- */

function chrome() {
  const s = C.current();
  document.body.classList.toggle('signed-in', !!s);
  const who = document.getElementById('auth-user');
  if (who) who.textContent = s ? s.user.email : '';
  const link = document.getElementById('admin-link');
  if (link) link.hidden = !(s && adminKnown === true);
}

/** Asks the database (not the browser) whether this account is the administrator. */
async function checkAdmin() {
  try { adminKnown = (await C.rpc('is_admin')) === true; } catch { adminKnown = false; }
  chrome();
  return adminKnown;
}

/* ------------------------------------ gate ------------------------------------ */

/**
 * Decides what to show for a route.
 * Returns { redirect } | { html, title, auth, nav } | null (null = continue with the normal app).
 */
export async function guard(parts) {
  const page = first(parts);
  await C.ensureSession();
  const signedIn = C.isSignedIn();
  chrome();

  if (page === 'reset-password') {
    if (!recovery) return { redirect: signedIn ? '#/' : '#/login' };
    return { html: V.resetPassword(), title: 'New password', auth: true };
  }
  if (!signedIn) {
    if (AUTH_PAGES.includes(page)) return { html: pageHtml(page), title: titleFor(page), auth: true };
    try { sessionStorage.setItem(NEXT_KEY, location.hash || '#/'); } catch { /* ignore */ }
    return { redirect: '#/login' };
  }
  if (AUTH_PAGES.includes(page)) return { redirect: takeNext() };
  if (page === 'admin') return adminPage();
  return null;
}

function takeNext() {
  let n = '#/';
  try { n = sessionStorage.getItem(NEXT_KEY) || '#/'; sessionStorage.removeItem(NEXT_KEY); } catch { /* ignore */ }
  return /^#\/(?!login|signup|forgot|check-email|reset-password)/.test(n) || n === '#/' ? n : '#/';
}
const titleFor = (p) => ({ login: 'Log in', signup: 'Create account', forgot: 'Reset password', 'check-email': 'Check your email' }[p] || 'Account');
function pageHtml(p) {
  if (p === 'signup') return V.signup();
  if (p === 'forgot') return V.forgot();
  if (p === 'check-email') return V.checkEmail(mailNote.addr, mailNote.kind);
  return V.login();
}

async function adminPage() {
  // The database decides. If it says no (or cannot answer), the user is sent to the normal app.
  let ok = false;
  try { ok = (await C.rpc('is_admin')) === true; } catch { ok = false; }
  adminKnown = ok; chrome();
  if (!ok) return { redirect: '#/' };
  try {
    const [o, u] = await Promise.all([A.loadOverview(), A.loadUsers('')]);
    return { html: A.dashboard(o, u), title: 'Admin', nav: 'admin' };
  } catch (e) {
    if (e && (e.status === 401 || e.status === 403 || e.code === '42501')) return { redirect: '#/' };
    return { html: `<div class="page-head"><h1>Admin dashboard</h1></div><div class="empty"><h2>Could not load the statistics</h2><p>${e && e.code === 'network' ? 'Check your internet connection.' : 'The analytics database may not be set up yet. Run supabase/migrations/001_auth_analytics.sql in Supabase, then refresh.'}</p><button class="btn" data-admin-action="refresh">Try again</button></div>`, title: 'Admin', nav: 'admin' };
  }
}

/** Called after an auth page is drawn: shows a pending message and focuses the first field. */
export function afterRender(parts) {
  const page = first(parts);
  if (!document.querySelector('.auth-card')) return;
  const box = document.querySelector('[data-auth-flash]');
  if (flash && box) { box.innerHTML = `<p class="${flash.error ? 'form-error' : 'banner'}" role="${flash.error ? 'alert' : 'status'}">${flash.text.replace(/[<>&]/g, '')}</p>`; flash = null; }
  if (page === 'login' || page === 'signup' || page === 'forgot') document.getElementById('au-email')?.focus({ preventScroll: true });
  if (page === 'reset-password') document.getElementById('au-password')?.focus({ preventScroll: true });
}

/* ---------------------------------- handlers ---------------------------------- */

function busy(form, on) {
  const b = form.querySelector('button[type=submit]');
  if (!b) return;
  if (on) { b.dataset.label = b.textContent; b.textContent = b.dataset.busyLabel || 'Please wait…'; b.disabled = true; form.setAttribute('aria-busy', 'true'); }
  else { b.textContent = b.dataset.label || b.textContent; b.disabled = false; form.removeAttribute('aria-busy'); }
}
function passwordErrors(pw, confirm, email = '') {
  const e = {};
  if (!pw) e.password = 'Enter a password.';
  else if (pw.length < MIN_PASSWORD) e.password = `Use at least ${MIN_PASSWORD} characters.`;
  else if (email && pw.toLowerCase() === email.toLowerCase()) e.password = 'The password should not be your email address.';
  if (confirm !== undefined && !e.password && pw !== confirm) e.confirm = 'The two passwords do not match.';
  return e;
}

const FORMS = {
  async login(form) {
    const { email, password } = readForm(form);
    const e = {};
    if (!email.trim()) e.email = 'Enter your email.'; else if (!EMAIL_RE.test(email.trim())) e.email = 'Enter a valid email address.';
    if (!password) e.password = 'Enter your password.';
    showFieldErrors(form, e); if (Object.keys(e).length) return;
    busy(form, true);
    try { await C.signIn(email.trim(), password); location.hash = takeNext(); rerender(); }
    catch (err) {
      showFieldErrors(form, { _form: C.friendly(err) });
      const extra = form.querySelector('[data-auth-extra]');
      if (extra) extra.innerHTML = err.code === 'email_not_confirmed' ? `<button type="button" class="btn" data-auth-action="resend" data-email="${email.trim().replace(/"/g, '')}">Send the confirmation email again</button>` : '';
    } finally { busy(form, false); }
  },
  async signup(form) {
    const { email, password, confirm } = readForm(form);
    const e = passwordErrors(password, confirm, email.trim());
    if (!email.trim()) e.email = 'Enter your email.'; else if (!EMAIL_RE.test(email.trim())) e.email = 'Enter a valid email address.';
    showFieldErrors(form, e); if (Object.keys(e).length) return;
    busy(form, true);
    try {
      const r = await C.signUp(email.trim(), password);
      if (r.status === 'signed-in') { location.hash = '#/'; rerender(); }
      else { mailNote = { addr: email.trim(), kind: 'signup' }; location.hash = '#/check-email'; rerender(); }
    } catch (err) { showFieldErrors(form, { _form: C.friendly(err) }); } finally { busy(form, false); }
  },
  async forgot(form) {
    const { email } = readForm(form);
    const e = {};
    if (!email.trim()) e.email = 'Enter your email.'; else if (!EMAIL_RE.test(email.trim())) e.email = 'Enter a valid email address.';
    showFieldErrors(form, e); if (Object.keys(e).length) return;
    busy(form, true);
    try { await C.requestReset(email.trim()); mailNote = { addr: email.trim(), kind: 'reset' }; location.hash = '#/check-email'; rerender(); }
    catch (err) { showFieldErrors(form, { _form: C.friendly(err) }); } finally { busy(form, false); }
  },
  async reset(form) {
    const { password, confirm } = readForm(form);
    const e = passwordErrors(password, confirm);
    showFieldErrors(form, e); if (Object.keys(e).length) return;
    if (!recovery) { location.hash = '#/login'; return; }
    busy(form, true);
    try {
      await C.setNewPassword(password, recovery.access_token);
      await C.adoptTokens(recovery);
      recovery = null; flash = { text: 'Your password was changed.' };
      location.hash = '#/'; rerender(); toast('Password changed. You are logged in.');
    } catch (err) {
      showFieldErrors(form, { _form: C.friendly(err) });
      if (err.code === 'otp_expired' || err.status === 401) { recovery = null; }
    } finally { busy(form, false); }
  },
};

export function bind() {
  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-auth-form]');
    if (!form) return;
    e.preventDefault();
    try { await FORMS[form.dataset.authForm](form); } catch (err) { console.error(err); showFieldErrors(form, { _form: 'Something went wrong. Please try again.' }); busy(form, false); }
  });
  document.addEventListener('change', (e) => {
    if (e.target.matches('[data-auth-toggle]')) e.target.closest('form').querySelectorAll('input[type=password],input[data-pw]').forEach((i) => { i.type = e.target.checked ? 'text' : 'password'; i.dataset.pw = '1'; });
  });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-auth-action],[data-admin-action]');
    if (!b) return;
    if (b.dataset.authAction === 'logout') {
      try { sessionStorage.removeItem(NEXT_KEY); } catch { /* ignore */ }
      await C.signOut(); toast('You are logged out.'); return;
    }
    if (b.dataset.authAction === 'resend') {
      b.disabled = true;
      try { await C.resendConfirmation(b.dataset.email); toast('Email sent. Check your inbox.'); } catch (err) { toast(C.friendly(err), { error: true }); }
      setTimeout(() => { b.disabled = false; }, 15000); return;
    }
    if (b.dataset.adminAction === 'refresh') { rerender(); }
  });
  let t = null;
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'admin-search') return;
    clearTimeout(t);
    const v = e.target.value;
    t = setTimeout(async () => {
      const host = document.getElementById('admin-users');
      if (!host) return;
      try { host.innerHTML = A.usersTable(await A.loadUsers(v.trim().slice(0, 100))); } catch { host.innerHTML = '<p class="form-error">Could not search. Try again.</p>'; }
    }, 300);
  });
}
