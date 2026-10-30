// Gives a browser context a signed-in test session and a fake Supabase, so tests of the app itself
// get past the login gate without internet.
import { createState, installMock, seedSession } from './mock-supabase.mjs';
export async function signedIn(ctx, email = 'tester@example.com') {
  const st = createState();
  await installMock(ctx, st);
  const s = seedSession(st, email);
  await ctx.addInitScript((sess) => { try { if (!localStorage.getItem('scopelens_auth_v1')) localStorage.setItem('scopelens_auth_v1', JSON.stringify(sess)); } catch { /* ignore */ } }, s);
  return st;
}
