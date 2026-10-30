// views.js — authentication pages (HTML strings). Styling reuses the ScopeLens design.
import { esc } from '../utils.js';
import { field, formError } from '../ws/ui.js';
import { MIN_PASSWORD } from './config.js';

export const ANALYTICS_NOTE = `<p class="small muted"><strong>What ScopeLens collects:</strong> your email address, when you created your account, and the time of each successful login, so the owner can see how many people use the app. That is all. Your clients, projects, invoices, payments, agreements, tasks and every other piece of business data stay in this browser and are never uploaded. Passwords are handled by Supabase Auth; ScopeLens cannot see them.</p>`;

const shell = (title, sub, body) => `<div class="auth-wrap">
  <div class="auth-card card">
    <a class="brand auth-brand" href="#/login"><img src="assets/logo.svg" alt="" width="32" height="32"><span>ScopeLens</span></a>
    <h1>${esc(title)}</h1>
    ${sub ? `<p class="sub">${esc(sub)}</p>` : ''}
    <div data-auth-flash role="status"></div>
    ${body}
  </div>
  <div class="auth-note">${ANALYTICS_NOTE}</div>
</div>`;

const email = (v = '') => field({ id: 'au-email', name: 'email', label: 'Email', kind: 'email', value: v, required: true, max: 200, extra: 'autocomplete="email" autocapitalize="none" spellcheck="false" inputmode="email"' });
const pass = (label = 'Password', name = 'password', ac = 'current-password', hint = '') => field({ id: `au-${name}`, name, label, value: '', required: true, hint, max: 200, extra: `autocomplete="${ac}"` })
  .replace('type="text"', 'type="password"');
const showPw = '<label class="check-line"><input type="checkbox" data-auth-toggle> Show password</label>';
const submit = (label) => `<button type="submit" class="btn btn-primary btn-block" data-busy-label="Please wait…">${esc(label)}</button>`;

export function login(prefill = '') {
  return shell('Log in', 'Welcome back. Log in to open your workspace.', `<form class="form" data-auth-form="login" novalidate>${formError()}
    ${email(prefill)}${pass('Password', 'password', 'current-password')}${showPw}
    ${submit('Log in')}
    <div data-auth-extra></div>
    <p class="auth-links"><a href="#/forgot">Forgot your password?</a><span>New here? <a href="#/signup">Create an account</a></span></p></form>`);
}

export function signup() {
  return shell('Create your account', 'Free. Your business data stays in your browser.', `<form class="form" data-auth-form="signup" novalidate>${formError()}
    ${email()}${pass('Password', 'password', 'new-password', `At least ${MIN_PASSWORD} characters.`)}${pass('Confirm password', 'confirm', 'new-password')}${showPw}
    ${submit('Create account')}
    <p class="auth-links"><span>Already have an account? <a href="#/login">Log in</a></span></p></form>`);
}

export function forgot() {
  return shell('Reset your password', 'Enter your email and we will send you a link to choose a new password.', `<form class="form" data-auth-form="forgot" novalidate>${formError()}
    ${email()}${submit('Send reset link')}
    <p class="auth-links"><a href="#/login">Back to log in</a></p></form>`);
}

export function resetPassword() {
  return shell('Choose a new password', `Use at least ${MIN_PASSWORD} characters.`, `<form class="form" data-auth-form="reset" novalidate>${formError()}
    ${pass('New password', 'password', 'new-password')}${pass('Confirm new password', 'confirm', 'new-password')}${showPw}
    ${submit('Save new password')}</form>`);
}

export function checkEmail(addr, kind) {
  const reset = kind === 'reset';
  return shell('Check your email', '', `<div class="stack">
    <p>${reset ? 'If an account exists for' : 'We sent a confirmation link to'} <strong>${esc(addr)}</strong>${reset ? ', we have sent a link to reset the password.' : '. Open it to finish creating your account.'}</p>
    <p class="muted small">It can take a few minutes. Check your spam folder too. The link opens ScopeLens in this browser.</p>
    ${reset ? '' : `<button type="button" class="btn" data-auth-action="resend" data-email="${esc(addr)}">Send the email again</button>`}
    <a class="btn btn-primary" href="#/login">Go to log in</a></div>`);
}

export function checking() { return '<div class="auth-wrap"><p class="muted">Checking access…</p></div>'; }
