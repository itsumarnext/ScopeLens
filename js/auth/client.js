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
    case 'invalid_credentials': return 'The email or password is not correct.';
    case 'email_not_confirmed': return 'Please confirm your email first. Check your inbox for our message.';
    case 'user_already_exists': case 'email_exists': return 'An account with this email may already exist. Try logging in or resetting your password.';
    case 'weak_password': return 'That password is too easy to guess. Use a longer, less common one.';
    case 'over_request_rate_limit': case 'over_email_send_rate_limit': case 'over_sms_send_rate_limit': return 'Too many attempts. Please wait a few minutes and try again.';
    case 'signup_disabled': return 'New sign-ups are turned off right now.';
    case 'user_banned': return 'This account has been disabled.';
    case 'same_password': return 'Choose a password you have not used before.';
    case 'validation_failed': return 'Please check the email address and try again.';
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

export async function signUp(email, password) {
  const data = await http(`/auth/v1/signup?redirect_to=${redirectTo()}`, { method: 'POST', body: { email, password } });
  const s = normalize(data);
  if (s) { save(s); notify(); await recordLogin(); return { status: 'signed-in' }; } // email confirmation is switched off in Supabase
  // Supabase hides whether an address is already registered: such replies have an empty identities list.
  if (data && data.identities && data.identities.length === 0) return { status: 'check-email', existing: true };
  return { status: 'check-email' };
}

export async function signIn(email, password) {
  const data = await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  const s = normalize(data);
  if (!s) throw new AuthError('unknown', 'Unexpected reply from the server.');
  save(s); notify();
  await recordLogin();
  return s;
}

export async function signOut() {
  const token = session && session.access_token;
  save(null); notify();
  if (token) { try { await http('/auth/v1/logout', { method: 'POST', token }); } catch { /* already signed out locally */ } }
}

export async function resendConfirmation(email) {
  await http(`/auth/v1/resend?redirect_to=${redirectTo()}`, { method: 'POST', body: { type: 'signup', email } });
}

export async function requestReset(email) {
  await http(`/auth/v1/recover?redirect_to=${redirectTo()}`, { method: 'POST', body: { email } });
}

/** Sets a new password using the temporary token from the emailed link, then signs the user in. */
export async function setNewPassword(password, token) {
  await http('/auth/v1/user', { method: 'PUT', token, body: { password } });
  const user = await http('/auth/v1/user', { token });
  return { token, user };
}

/** Finishes sign-in after a verified link (email confirmation or password reset). */
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

/** Parses the #access_token=… part of the link in a confirmation or reset email. */
export function readLinkFragment(hash) {
  const h = (hash || '').replace(/^#/, '');
  if (!h || h.startsWith('/')) return null;
  const q = new URLSearchParams(h);
  if (q.get('error') || q.get('error_code')) return { error: q.get('error_code') || q.get('error'), description: q.get('error_description') || '' };
  if (q.get('access_token')) return { access_token: q.get('access_token'), refresh_token: q.get('refresh_token') || '', expires_in: q.get('expires_in'), type: q.get('type') || '' };
  return null;
}
