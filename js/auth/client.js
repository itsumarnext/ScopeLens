// client.js — tiny Supabase Auth client using plain fetch (no library, no dependency).
// Stores only the session (tokens + email) in this browser. Business data is never sent anywhere.

import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const KEY = 'scopelens_auth_v1';
const SKEW = 30; // seconds: refresh a little before expiry

export class AuthError extends Error {
  constructor(code, message, status = 0) { super(message); this.code = code; this.status = status; }
}

let session = null;
let refreshing = null;
const subscribers = new Set();

/* ---------------------------------- storage ---------------------------------- */

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const s = raw ? JSON.parse(raw) : null;
    if (s && typeof s.access_token === 'string' && typeof s.refresh_token === 'string' && s.user && typeof s.user.email === 'string') return s;
  } catch { /* unreadable: treat as signed out */ }
  return null;
}
function save(s) {
  session = s;
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* storage blocked: session lasts for this tab only */ }
}
export function onChange(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }
const notify = () => subscribers.forEach((fn) => { try { fn(session); } catch { /* ignore */ } });

window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  session = load();
  notify();
});

const now = () => Math.floor(Date.now() / 1000);

function normalize(data) {
  if (!data || !data.access_token || !data.user) return null;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || now() + (data.expires_in || 3600),
    user: { id: data.user.id, email: data.user.email, confirmed: !!data.user.email_confirmed_at },
  };
}

/* ----------------------------------- http ------------------------------------ */

async function http(path, { method = 'GET', body, token, headers = {} } = {}) {
  // Publishable keys are not JWTs: send them only as `apikey`. Authorization carries the user's token.
  const h = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new AuthError('network', 'Could not reach the server. Check your internet connection and try again.');
  }
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 200) }; } }
  if (!res.ok) {
    const code = (data && (data.error_code || data.code || data.error)) || `http_${res.status}`;
    const msg = (data && (data.msg || data.message || data.error_description)) || `Request failed (${res.status})`;
    throw new AuthError(String(code), String(msg), res.status);
  }
  return data;
}

export function friendly(err) {
  if (!(err instanceof AuthError)) return 'Something went wrong. Please try again.';
  switch (err.code) {
    case 'network': return err.message;
    case 'access_denied': return 'Google sign-in was cancelled or not allowed. Please try again.';
    case 'provider_disabled': case 'validation_failed': return 'Google sign-in is not switched on for this app yet. Please contact the owner.';
    case 'bad_oauth_state': case 'bad_oauth_callback': case 'oauth_provider_not_supported': return 'Google sign-in could not be completed. Please try again.';
    case 'over_request_rate_limit': case 'over_email_send_rate_limit': case 'over_sms_send_rate_limit': return 'Too many attempts. Please wait a few minutes and try again.';
    case 'user_banned': return 'This account has been disabled.';
    case 'otp_expired': case 'bad_jwt': case 'session_not_found': return 'This link has expired. Please request a new one.';
    default:
      return err.status === 429 ? 'Too many attempts. Please wait a few minutes and try again.' : 'Something went wrong. Please try again.';
  }
}

const redirectTo = () => encodeURIComponent(`${location.origin}${location.pathname}`);

/* --------------------------------- session ----------------------------------- */

export function current() { return session; }
export function isSignedIn() { return !!session; }

/** Loads any saved session. Call once at start. */
export function restore() { session = load(); return session; }

async function doRefresh() {
  if (!session) return null;
  if (refreshing) return refreshing;
  const rt = session.refresh_token;
  refreshing = (async () => {
    try {
      const data = await http('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: rt } });
      const s = normalize(data);
      if (s) { save(s); notify(); }
      return session;
    } catch (e) {
      if (e instanceof AuthError && e.code !== 'network' && e.status >= 400 && e.status < 500) { save(null); notify(); return null; } // refresh token rejected
      return session; // offline or server hiccup: keep the session, try again later
    } finally { refreshing = null; }
  })();
  return refreshing;
}

/** Returns a usable session (refreshing if close to expiry) or null. Never counts as a login. */
export async function ensureSession() {
  if (!session) return null;
  if (session.expires_at - now() <= SKEW) await doRefresh();
  return session;
}

/** Records one successful sign-in (user id + time only). Failures never block the user. */
async function recordLogin() {
  if (!session) return;
  try {
    await http('/rest/v1/login_events', { method: 'POST', token: session.access_token, headers: { Prefer: 'return=minimal' }, body: { user_id: session.user.id } });
  } catch (e) { console.warn('Could not record sign-in analytics:', e.code); }
}

/* ---------------------------------- actions ---------------------------------- */

/**
 * Starts Google sign-in. This is exactly what supabase.auth.signInWithOAuth({ provider: 'google' })
 * does in the browser: it sends the visitor to Supabase's /authorize endpoint, which hands them to
 * Google and then returns here with a session in the address fragment (read by readLinkFragment).
 * No Google client secret is ever needed or present in this app; it lives only in the Supabase dashboard.
 */
export function googleUrl() {
  return `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${redirectTo()}`;
}
export function signInWithGoogle() { location.assign(googleUrl()); }

export async function signOut() {
  const token = session && session.access_token;
  save(null); notify();
  if (token) { try { await http('/auth/v1/logout', { method: 'POST', token }); } catch { /* already signed out locally */ } }
}

/** Finishes sign-in after returning from Google: verifies the token with Supabase, saves the session, counts one login. */
export async function adoptTokens({ access_token, refresh_token, expires_in }) {
  const user = await http('/auth/v1/user', { token: access_token });
  const s = normalize({ access_token, refresh_token, expires_in: Number(expires_in) || 3600, user });
  if (!s) throw new AuthError('unknown', 'Unexpected reply from the server.');
  save(s); notify();
  await recordLogin();
  return s;
}

/* ------------------------------ authorised calls ------------------------------ */

/** Calls a database function. The database decides whether the caller is allowed. */
export async function rpc(name, args = {}) {
  const s = await ensureSession();
  if (!s) throw new AuthError('signed_out', 'You are signed out.', 401);
  try {
    return await http(`/rest/v1/rpc/${name}`, { method: 'POST', token: s.access_token, body: args });
  } catch (e) {
    if (e.status === 401) { // token may have just expired
      const s2 = await doRefresh();
      if (s2) return http(`/rest/v1/rpc/${name}`, { method: 'POST', token: s2.access_token, body: args });
    }
    throw e;
  }
}

/** Reads what Google/Supabase put in the address when sending the visitor back: #access_token=… or an error (in # or ?). */
export function readLinkFragment(hash, search = '') {
  const qs = new URLSearchParams((search || '').replace(/^\?/, ''));
  if (qs.get('error') || qs.get('error_code')) return { error: qs.get('error_code') || qs.get('error'), description: qs.get('error_description') || '' };
  const h = (hash || '').replace(/^#/, '');
  if (!h || h.startsWith('/')) return null;
  const q = new URLSearchParams(h);
  if (q.get('error') || q.get('error_code')) return { error: q.get('error_code') || q.get('error'), description: q.get('error_description') || '' };
  if (q.get('access_token')) return { access_token: q.get('access_token'), refresh_token: q.get('refresh_token') || '', expires_in: q.get('expires_in'), type: q.get('type') || '' };
  return null;
}
