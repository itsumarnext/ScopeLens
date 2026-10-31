// index.js — session gate, auth page handlers and Admin routing.
import { toast } from '../ui.js';
import * as C from './client.js';
import * as V from './views.js';
import * as A from './admin.js';

const AUTH_PAGES = ['login'];
const RETIRED_PAGES = ['signup', 'forgot', 'check-email', 'reset-password']; // email/password pages no longer exist
const NEXT_KEY = 'scopelens_next';
let flash = null;           // one message shown on the next auth page
let adminKnown = null;      // null = unknown, true/false after the database answered
let rerender = () => {};

const first = (parts) => (parts[0] || '').split('?')[0];

/* ------------------------------------ start ----------------------------------- */

export async function init(onRoute) {
  rerender = onRoute;
  const frag = C.readLinkFragment(location.hash, location.search);
  if (frag) {
    history.replaceState(null, '', location.pathname); // never leave tokens or error details in the address bar
    if (frag.error) { flash = { error: true, text: C.friendly(new C.AuthError(frag.error, frag.description)) }; location.hash = '#/login'; }
    else if (frag.type === 'recovery' || frag.type === 'signup' || frag.type === 'invite' || frag.type === 'email_change' || frag.type === 'magiclink') {
      flash = { error: true, text: 'Email links are no longer used. Please continue with Google.' }; location.hash = '#/login';
    } else {
      try { await C.adoptTokens(frag); flash = null; location.hash = takeNext(); }
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

  if (RETIRED_PAGES.includes(page)) return { redirect: signedIn ? '#/' : '#/login' };
  if (!signedIn) {
    if (AUTH_PAGES.includes(page)) return { html: V.login(), title: 'Sign in', auth: true };
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
  if (page === 'login') document.querySelector('[data-auth-action="google"]')?.focus({ preventScroll: true });
}

/* ---------------------------------- handlers ---------------------------------- */

function startGoogle(btn) {
  btn.dataset.label = btn.querySelector('span').textContent;
  btn.querySelector('span').textContent = btn.dataset.busyLabel || 'Opening Google…';
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try { C.signInWithGoogle(); } catch (err) { console.error(err); resetGoogle(btn); showError('Could not start Google sign-in. Please try again.'); }
}
function resetGoogle(btn) {
  if (!btn || !btn.dataset.label) return;
  btn.querySelector('span').textContent = btn.dataset.label; btn.disabled = false; btn.removeAttribute('aria-busy');
}
function showError(text) {
  const box = document.querySelector('[data-auth-flash]');
  if (box) box.innerHTML = `<p class="form-error" role="alert">${text.replace(/[<>&]/g, '')}</p>`;
}

export function bind() {
  // Coming back with the back button can restore the page with the button still "busy".
  window.addEventListener('pageshow', (e) => { if (e.persisted) document.querySelectorAll('[data-auth-action="google"]').forEach(resetGoogle); });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-auth-action],[data-admin-action]');
    if (!b) return;
    if (b.dataset.authAction === 'google') { startGoogle(b); return; }
    if (b.dataset.authAction === 'logout') {
      try { sessionStorage.removeItem(NEXT_KEY); } catch { /* ignore */ }
      await C.signOut(); toast('You are logged out.'); return;
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
