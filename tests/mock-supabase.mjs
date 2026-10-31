// A small in-memory imitation of the Supabase endpoints WorkSphare uses, installed with Playwright
// request interception. It lets the browser tests run without internet or a real project.
// It mirrors the rules of supabase/migrations/001_auth_analytics.sql (tested separately in PostgreSQL).
export const SUPA = 'https://yrkvlunvpjmuprlftauy.supabase.co';
export const ADMIN_EMAIL = 'itsumarnext@gmail.com';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

export function createState({ confirmEmail = true } = {}) {
  return { users: [], events: [], sent: [], requests: [], confirmEmail, tokens: new Map(), seq: 0 };
}
const uid = (st) => `00000000-0000-4000-8000-${String(++st.seq).padStart(12, '0')}`;

function issue(st, user) {
  const access = `at_${user.id}_${++st.seq}`, refresh = `rt_${user.id}_${++st.seq}`;
  st.tokens.set(access, user.id); st.tokens.set(refresh, user.id);
  return { access_token: access, refresh_token: refresh, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: pub(user) };
}
const pub = (u) => ({ id: u.id, email: u.email, email_confirmed_at: u.confirmed ? u.created : null, identities: [{}] });
const bearer = (st, h) => { const m = /^Bearer (.+)$/.exec(h.authorization || ''); return m && st.tokens.has(m[1]) ? st.users.find((u) => u.id === st.tokens.get(m[1])) : null; };
const isAdmin = (u) => !!u && u.email.toLowerCase() === ADMIN_EMAIL && u.confirmed;
const ymd = (d) => d.toISOString().slice(0, 10);

export function addUser(st, email, password, confirmed = true, daysAgo = 0) {
  const u = { id: uid(st), email, password, confirmed, created: new Date(Date.now() - daysAgo * 864e5).toISOString() };
  st.users.push(u); return u;
}
export function seedSession(st, email, password = 'password123') {
  let u = st.users.find((x) => x.email === email);
  if (!u) u = addUser(st, email, password, true);
  return issue(st, u);
}
export function confirmLink(st, email, type = 'signup') {
  const u = st.users.find((x) => x.email === email); if (type === 'signup') u.confirmed = true;
  const s = issue(st, u);
  return `#access_token=${s.access_token}&refresh_token=${s.refresh_token}&expires_in=3600&token_type=bearer&type=${type}`;
}

function overview(st) {
  const day = (n) => ymd(new Date(Date.now() - n * 864e5));
  const today = ymd(new Date()), month = today.slice(0, 7);
  const byUser = new Map(); for (const e of st.events) byUser.set(e.user_id, [...(byUser.get(e.user_id) || []), e.t.slice(0, 10)]);
  const monthsSeen = [...new Set(st.events.map((e) => e.t.slice(0, 7)))];
  const mauOf = (m) => new Set(st.events.filter((e) => e.t.startsWith(m)).map((e) => e.user_id)).size;
  const days = Array.from({ length: 30 }, (_, i) => day(29 - i));
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - (11 - i)); return ymd(d).slice(0, 7); });
  return {
    timezone: 'UTC', totalUsers: st.users.length, totalLogins: st.events.length,
    loginsThisMonth: st.events.filter((e) => e.t.startsWith(month)).length, loginsToday: st.events.filter((e) => e.t.startsWith(today)).length,
    mau: mauOf(month), avgMau: monthsSeen.length ? +(monthsSeen.reduce((a, m) => a + mauOf(m), 0) / monthsSeen.length).toFixed(1) : 0, monthsCounted: monthsSeen.length,
    newUsersThisMonth: st.users.filter((u) => u.created.startsWith(month)).length, newUsersToday: st.users.filter((u) => u.created.startsWith(today)).length,
    returningUsers: [...byUser.values()].filter((d) => new Set(d).size >= 2).length,
    registrationsDaily: days.map((d) => ({ label: d, value: st.users.filter((u) => u.created.startsWith(d)).length })),
    registrationsMonthly: months.map((m) => ({ label: `${m}-01`, value: st.users.filter((u) => u.created.startsWith(m)).length })),
    dailyLogins: days.map((d) => ({ label: d, value: st.events.filter((e) => e.t.startsWith(d)).length, users: 0 })),
    monthlyLogins: months.map((m) => ({ label: `${m}-01`, value: st.events.filter((e) => e.t.startsWith(m)).length })),
    mauByMonth: months.map((m) => ({ label: `${m}-01`, value: mauOf(m) })),
    userGrowth: months.map((m) => ({ label: `${m}-01`, value: st.users.filter((u) => u.created.slice(0, 7) <= m).length })),
  };
}

export async function installMock(ctx, st) {
  await ctx.route(`${SUPA}/**`, async (route) => {
    const req = route.request(); const url = new URL(req.url()); const h = req.headers();
    const send = (status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: body === undefined ? '' : JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch { /* none */ }
    st.requests.push({ method: req.method(), path: url.pathname, body: req.postData() || '' });
    const p = url.pathname;
    if (!h.apikey && p !== '/auth/v1/authorize') return send(401, { message: 'No API key found in request' });

    if (p === '/auth/v1/authorize') {
      // What Supabase + Google do: send the visitor to Google, then back to redirect_to with a session in the fragment.
      st.authorizeCalls = (st.authorizeCalls || 0) + 1;
      const back = url.searchParams.get('redirect_to') || '';
      if (url.searchParams.get('provider') !== 'google') return route.fulfill({ status: 302, headers: { ...CORS, location: `${back}#error=invalid_request&error_code=oauth_provider_not_supported&error_description=Unsupported+provider` } });
      const g = st.google || { error: 'access_denied', description: 'The user cancelled' };
      if (g.error) return route.fulfill({ status: 302, headers: { ...CORS, location: `${back}#error=${g.error}&error_code=${g.errorCode || g.error}&error_description=${encodeURIComponent(g.description || '')}` } });
      let u = st.users.find((x) => x.email.toLowerCase() === g.email.toLowerCase());
      if (!u) u = addUser(st, g.email, null, true);
      u.confirmed = true;
      const t = issue(st, u);
      return route.fulfill({ status: 302, headers: { ...CORS, location: `${back}#access_token=${t.access_token}&refresh_token=${t.refresh_token}&expires_in=3600&token_type=bearer&provider_token=google-token-should-be-ignored` } });
    }
    if (p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const id = st.tokens.get(body.refresh_token); const u = st.users.find((x) => x.id === id);
      return u ? send(200, issue(st, u)) : send(400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
    }
    if (p === '/auth/v1/logout') { return send(204); }
    if (p === '/auth/v1/user') {
      const u = bearer(st, h); if (!u) return send(401, { error_code: 'bad_jwt', msg: 'invalid JWT' });
      return send(200, pub(u));
    }
    if (p === '/rest/v1/login_events' && req.method() === 'POST') {
      const u = bearer(st, h); if (!u) return send(401, { message: 'JWT required' });
      if (body.user_id !== u.id) return send(403, { code: '42501', message: 'new row violates row-level security policy' });
      st.events.push({ user_id: u.id, t: new Date().toISOString() }); return send(201);
    }
    if (p.startsWith('/rest/v1/rpc/')) {
      const u = bearer(st, h); if (!u) return send(401, { message: 'JWT required' });
      const name = p.split('/').pop();
      if (name === 'is_admin') return send(200, isAdmin(u));
      if (!isAdmin(u)) return send(403, { code: '42501', message: 'not authorized' });
      if (name === 'admin_overview') return send(200, overview(st));
      if (name === 'admin_list_users') {
        const q = (body.p_search || '').toLowerCase();
        const rows = st.users.filter((x) => !q || x.email.toLowerCase().includes(q)).sort((a, b) => b.created.localeCompare(a.created))
          .map((x) => { const ev = st.events.filter((e) => e.user_id === x.id); return { email: x.email, created_at: x.created, last_login: ev.length ? ev[ev.length - 1].t : null, logins: ev.length, status: x.confirmed ? 'Active' : 'Unverified' }; });
        return send(200, { total: rows.length, users: rows });
      }
    }
    return send(404, { message: 'not found' });
  });
}
