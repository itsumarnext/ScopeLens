-- WorkSphare: minimal account analytics + single-administrator access.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run.
--
-- What is stored here: one row per successful sign-in (user id + time). Nothing else.
-- Business data (clients, projects, invoices, agreements, tasks...) never reaches Supabase.
-- Emails, signup time and last sign-in already live in Supabase Auth (auth.users).

-- ---------------------------------------------------------------- login events
create table if not exists public.login_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists login_events_created_idx on public.login_events (created_at);
create index if not exists login_events_user_idx    on public.login_events (user_id, created_at);

alter table public.login_events enable row level security;
alter table public.login_events force  row level security;

-- Nobody can read, change or delete rows through the API (no SELECT/UPDATE/DELETE policy exists).
-- A signed-in user can only add a row for themselves.
revoke all on public.login_events from anon, authenticated;
grant insert on public.login_events to authenticated;

drop policy if exists login_events_insert_own on public.login_events;
create policy login_events_insert_own on public.login_events
  for insert to authenticated
  with check (user_id = auth.uid());

-- Anti-inflation guard: ignore a second event from the same user within 30 seconds.
create or replace function public.login_events_throttle() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.login_events e
             where e.user_id = new.user_id and e.created_at > now() - interval '30 seconds') then
    return null;
  end if;
  return new;
end $$;
revoke all on function public.login_events_throttle() from public, anon, authenticated;
drop trigger if exists login_events_throttle on public.login_events;
create trigger login_events_throttle before insert on public.login_events
  for each row execute function public.login_events_throttle();

-- ---------------------------------------------------------------- the one administrator
-- The check runs inside the database against the verified account record, so it cannot be
-- faked from the browser. The email must also be CONFIRMED, so nobody can claim the admin
-- address by registering it without owning the inbox.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and lower(u.email) = 'itsumarnext@gmail.com'
      and u.email_confirmed_at is not null
  );
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create or replace function public.admin_guard() returns void
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $$;
revoke all on function public.admin_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------- statistics
-- p_tz decides what "today" and "this month" mean (the browser's time zone). Invalid -> UTC.
create or replace function public.admin_overview(p_tz text default 'UTC') returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  tz text := case when exists (select 1 from pg_timezone_names where name = p_tz) then p_tz else 'UTC' end;
  today date := (now() at time zone tz)::date;
  m0 date := date_trunc('month', now() at time zone tz)::date;
  first_login_month date;
  r jsonb;
begin
  perform public.admin_guard();

  select date_trunc('month', min(created_at) at time zone tz)::date into first_login_month from public.login_events;

  with ev as (select user_id, (created_at at time zone tz) as t from public.login_events),
  usr as (select id, (created_at at time zone tz) as t from auth.users),
  months as (select generate_series(m0 - interval '11 months', m0, interval '1 month')::date as m),
  days as (select generate_series(today - 29, today, interval '1 day')::date as d),
  all_months as (
    select generate_series(first_login_month, m0, interval '1 month')::date as m
    where first_login_month is not null
  ),
  mau_by_month as (
    select a.m, (select count(distinct user_id) from ev where date_trunc('month', ev.t)::date = a.m) as n from all_months a
  )
  select jsonb_build_object(
    'timezone', tz,
    'generatedAt', now(),
    'totalUsers',      (select count(*) from usr),
    'totalLogins',     (select count(*) from ev),
    'loginsThisMonth', (select count(*) from ev where ev.t >= m0),
    'loginsToday',     (select count(*) from ev where ev.t::date = today),
    'mau',             (select count(distinct user_id) from ev where ev.t >= m0),
    'avgMau',          coalesce((select round(avg(n)::numeric, 1) from mau_by_month), 0),
    'monthsCounted',   (select count(*) from all_months),
    'newUsersThisMonth', (select count(*) from usr where usr.t >= m0),
    'newUsersToday',     (select count(*) from usr where usr.t::date = today),
    'returningUsers',  (select count(*) from (select user_id from ev group by user_id having count(distinct ev.t::date) >= 2) x),
    'registrationsDaily', (select coalesce(jsonb_agg(jsonb_build_object('label', d, 'value', (select count(*) from usr where usr.t::date = days.d)) order by d), '[]') from days),
    'registrationsMonthly', (select coalesce(jsonb_agg(jsonb_build_object('label', m, 'value', (select count(*) from usr where date_trunc('month', usr.t)::date = months.m)) order by m), '[]') from months),
    'dailyLogins', (select coalesce(jsonb_agg(jsonb_build_object('label', d,
        'value', (select count(*) from ev where ev.t::date = days.d),
        'users', (select count(distinct user_id) from ev where ev.t::date = days.d)) order by d), '[]') from days),
    'monthlyLogins', (select coalesce(jsonb_agg(jsonb_build_object('label', m,
        'value', (select count(*) from ev where date_trunc('month', ev.t)::date = months.m)) order by m), '[]') from months),
    'mauByMonth', (select coalesce(jsonb_agg(jsonb_build_object('label', m,
        'value', (select count(distinct user_id) from ev where date_trunc('month', ev.t)::date = months.m)) order by m), '[]') from months),
    'userGrowth', (select coalesce(jsonb_agg(jsonb_build_object('label', m,
        'value', (select count(*) from usr where usr.t < (months.m + interval '1 month'))) order by m), '[]') from months)
  ) into r;
  return r;
end $$;
revoke all on function public.admin_overview(text) from public, anon;
grant execute on function public.admin_overview(text) to authenticated;

-- ---------------------------------------------------------------- user list
-- Returns only: email, signup time, last sign-in time, status, number of sign-ins.
create or replace function public.admin_list_users(p_search text default null, p_limit int default 100, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  q text := nullif(trim(coalesce(p_search, '')), '');
  lim int := least(greatest(coalesce(p_limit, 100), 1), 500);
  off int := greatest(coalesce(p_offset, 0), 0);
  pat text;
  r jsonb;
begin
  perform public.admin_guard();
  if q is not null then
    pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  select jsonb_build_object(
    'total', (select count(*) from auth.users u where pat is null or u.email ilike pat),
    'users', coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
        select u.email,
               u.created_at,
               (select max(e.created_at) from public.login_events e where e.user_id = u.id) as last_login,
               (select count(*) from public.login_events e where e.user_id = u.id) as logins,
               case when u.banned_until is not null and u.banned_until > now() then 'Disabled'
                    when u.email_confirmed_at is null then 'Unverified'
                    else 'Active' end as status
        from auth.users u
        where pat is null or u.email ilike pat
        order by u.created_at desc limit lim offset off) x), '[]'::jsonb)
  ) into r;
  return r;
end $$;
revoke all on function public.admin_list_users(text, int, int) from public, anon;
grant execute on function public.admin_list_users(text, int, int) to authenticated;
