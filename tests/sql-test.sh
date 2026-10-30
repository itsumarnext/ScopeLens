#!/usr/bin/env bash
# Tests supabase/migrations/001_auth_analytics.sql against a throw-away local PostgreSQL
# using a minimal imitation of Supabase's auth schema. Needs PostgreSQL running; run as a user that can `su postgres`.
set -u
DB=scopelens_sqltest
SQL="$(dirname "$0")/../supabase/migrations/001_auth_analytics.sql"
P() { su postgres -c "psql -v ON_ERROR_STOP=1 -qtA $*"; }
su postgres -c "dropdb --if-exists $DB; createdb $DB"
cat > /tmp/mock_auth.sql <<'S'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now(),
  email_confirmed_at timestamptz, banned_until timestamptz, last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated; grant usage on schema public to anon, authenticated;
S
su postgres -c "psql -q -d $DB -f /tmp/mock_auth.sql" >/dev/null
su postgres -c "psql -q -v ON_ERROR_STOP=1 -d $DB -f $(readlink -f "$SQL")" || { echo "MIGRATION FAILED"; exit 1; }
su postgres -c "psql -q -v ON_ERROR_STOP=1 -d $DB -f $(readlink -f "$SQL")" || { echo "MIGRATION NOT RE-RUNNABLE"; exit 1; }
cat > /tmp/t.sql <<'S'
insert into auth.users(id,email,created_at,email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000000a1','itsumarnext@gmail.com', now()-interval '40 days', now()),
 ('00000000-0000-0000-0000-0000000000b2','bob@example.com', now()-interval '3 days', now()),
 ('00000000-0000-0000-0000-0000000000c3','fake@example.com', now(), null),
 ('00000000-0000-0000-0000-0000000000d4','ITSUMARNEXT@gmail.com.evil.com', now(), now()),
 ('00000000-0000-0000-0000-0000000000e5','unverified-admin@x.com', now(), null);
insert into public.login_events(user_id,created_at) values
 ('00000000-0000-0000-0000-0000000000a1', now()-interval '35 days'),
 ('00000000-0000-0000-0000-0000000000a1', now()-interval '1 days'),
 ('00000000-0000-0000-0000-0000000000b2', now()-interval '2 days'),
 ('00000000-0000-0000-0000-0000000000b2', now());
S
su postgres -c "psql -q -d $DB -f /tmp/t.sql" 
fail=0
check() { # name expected sql role sub
  out=$(su postgres -c "psql -d $DB -qtA -c \"set role $4; select set_config('request.jwt.claim.sub','$5',false); $3\"" 2>&1 | tr '\n' ' ')
  if [[ "$out" == *"$2"* ]]; then echo "PASS $1"; else echo "FAIL $1 (got: $out)"; fail=1; fi
}
ADM=00000000-0000-0000-0000-0000000000a1; BOB=00000000-0000-0000-0000-0000000000b2; FAKE=00000000-0000-0000-0000-0000000000e5
check "admin is_admin" "t" "select is_admin();" authenticated $ADM
check "normal user is not admin" "f" "select is_admin();" authenticated $BOB
check "unconfirmed lookalike is not admin" "f" "select is_admin();" authenticated $FAKE
check "anonymous cannot call is_admin" "permission denied" "select is_admin();" anon ""
check "user cannot call admin_overview" "not authorized" "select admin_overview('UTC');" authenticated $BOB
check "user cannot list users" "not authorized" "select admin_list_users();" authenticated $BOB
check "anonymous cannot call admin_overview" "permission denied" "select admin_overview();" anon ""
check "user cannot read login_events" "permission denied" "select count(*) from login_events;" authenticated $BOB
check "user cannot delete login_events" "permission denied" "delete from login_events;" authenticated $BOB
check "user cannot update login_events" "permission denied" "update login_events set created_at=now();" authenticated $BOB
check "user cannot insert for someone else" "row-level security" "insert into login_events(user_id) values ('$ADM');" authenticated $BOB
check "user can insert own event" "" "insert into login_events(user_id) values ('$FAKE');" authenticated $FAKE
check "rapid duplicate ignored" "" "insert into login_events(user_id) values ('$FAKE');" authenticated $FAKE
n=$(su postgres -c "psql -d $DB -qtA -c \"select count(*) from login_events where user_id='$FAKE'\"")
if [[ "$n" == "1" ]]; then echo "PASS exactly one event stored after two rapid inserts"; else echo "FAIL throttle (count=$n)"; fail=1; fi
check "anon cannot insert" "permission denied" "insert into login_events(user_id) values ('$BOB');" anon ""
check "admin totalUsers=5" "5" "select admin_overview('UTC')->>'totalUsers';" authenticated $ADM
check "admin totalLogins=5 (4 seeded + 1 inserted)" "5" "select admin_overview('UTC')->>'totalLogins';" authenticated $ADM
check "admin loginsToday=2 (bob now + fake now)" "2" "select admin_overview('UTC')->>'loginsToday';" authenticated $ADM
check "mau=3 (admin, bob, fake)" "3" "select admin_overview('UTC')->>'mau';" authenticated $ADM
check "newUsersToday=3" "3" "select admin_overview('UTC')->>'newUsersToday';" authenticated $ADM
check "returning users = admin & bob (2 days each)" "2" "select admin_overview('UTC')->>'returningUsers';" authenticated $ADM
check "30 daily points" "30" "select jsonb_array_length(admin_overview('UTC')->'dailyLogins');" authenticated $ADM
check "12 monthly points" "12" "select jsonb_array_length(admin_overview('UTC')->'userGrowth');" authenticated $ADM
check "invalid tz falls back to UTC" "UTC" "select admin_overview('Not/AZone')->>'timezone';" authenticated $ADM
check "kolkata tz accepted" "Asia/Kolkata" "select admin_overview('Asia/Kolkata')->>'timezone';" authenticated $ADM
check "list total" "5" "select admin_list_users()->>'total';" authenticated $ADM
check "search finds bob" "1" "select admin_list_users('bob')->>'total';" authenticated $ADM
check "search wildcard is escaped" "0" "select admin_list_users('%')->>'total';" authenticated $ADM
check "list exposes only safe keys" "{created_at,email,last_login,logins,status}" "select (select array_agg(k order by k) from jsonb_object_keys(admin_list_users('bob')->'users'->0) k);" authenticated $ADM
check "unverified status" "Unverified" "select admin_list_users('fake@')->'users'->0->>'status';" authenticated $ADM
su postgres -c "dropdb $DB"
exit $fail
