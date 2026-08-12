-- BUG: every Edge Function was failing with a 500.
--
-- When "Automatically expose new tables" was disabled and grants were rebuilt as
-- an explicit allowlist, everything was granted to `authenticated` and nothing to
-- `service_role`. Postgres checks grants BEFORE RLS, so bypassing RLS doesn't
-- help a role that can't touch the table at all — every query the Edge Functions
-- made failed.
--
-- Not caught earlier because the pg_cron jobs run as the table owner, not as
-- service_role, so the SQL half of the system worked fine. Only the Edge
-- Functions exercise this path.
--
-- service_role gets blanket DML deliberately. It already bypasses RLS, so
-- per-table grants add no meaningful restriction — they only produce failures
-- like this one. The actual control on service_role is that its key never leaves
-- server-side contexts (section 4).

grant select, insert, update, delete on all tables in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

-- TRUNCATE stays revoked even here: it bypasses RLS *and* skips triggers, and
-- nothing in this system has any use for it.
revoke truncate on all tables in schema public from service_role;
alter default privileges in schema public revoke truncate on tables from service_role;

-- Sequences, in case any are added later.
grant usage, select on all sequences in schema public to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;

-- The job helpers live in `private`, which service_role could not reach either.
grant usage on schema private to service_role;

grant execute on function private.list_expired_photos(integer, integer) to service_role;
grant execute on function private.mark_photos_purged(uuid[])           to service_role;
grant execute on function private.scrub_and_list_user_media(uuid)      to service_role;

-- Future helpers in `private` should NOT be automatically reachable; grant them
-- explicitly as jobs need them, the same discipline used for authenticated.;
