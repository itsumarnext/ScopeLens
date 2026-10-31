// views.js — the single sign-in screen: "Continue with Google". No email or password forms exist.
import { esc } from '../utils.js';

export const ANALYTICS_NOTE = `<p class="small muted"><strong>What WorkSphare collects:</strong> the email address of your Google account, when you first signed in, and the time of each successful sign-in, so the owner can see how many people use the app. That is all. Your clients, projects, invoices, payments, agreements, tasks and every other piece of business data stay in this browser and are never uploaded. Google handles your sign-in; WorkSphare never sees your Google password.</p>`;

const GOOGLE_G = '<svg class="g-logo" viewBox="0 0 48 48" width="20" height="20" aria-hidden="true" focusable="false"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';

export function login() {
  return `<div class="auth-wrap">
  <div class="auth-card card auth-center">
    <img class="brand-logo auth-logo" src="assets/worksphare-logo.png" alt="WorkSphare" width="220" height="52">
    <h1>Welcome to WorkSphare</h1>
    <p class="sub">Your whole client business in one place. Continue with your Google account to open your workspace.</p>
    <div data-auth-flash role="status" aria-live="polite"></div>
    <button type="button" class="btn btn-google btn-block" data-auth-action="google" data-busy-label="Opening Google…">${GOOGLE_G}<span>Continue with Google</span></button>
    <p class="small muted">New here? Continuing with Google creates your account automatically.</p>
  </div>
  <div class="auth-note">${ANALYTICS_NOTE}</div>
</div>`;
}

export function checking() { return `<div class="auth-wrap"><p class="muted">${esc('Checking access…')}</p></div>`; }
