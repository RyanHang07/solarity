-- Solarity: pre-RLS hardening.
--
-- 1. Revoke TRUNCATE from every client role on every table in public.
--
--    This matters more than it appears. TRUNCATE BYPASSES ROW LEVEL SECURITY
--    entirely — policies are never consulted — so a single statement would
--    empty a table regardless of anything written in section 4. It is not
--    currently reachable, because PostgREST only ever issues SELECT / INSERT /
--    UPDATE / DELETE, but no role in this system has any use for it, and
--    relying on the API surface staying narrow forever is not a security
--    argument.
--
--    REFERENCES and TRIGGER are left in place: both require ownership-level
--    access to actually exercise and neither can read or modify row data.

revoke truncate on all tables in schema public from anon, authenticated, service_role;

-- Ensure future tables do not reacquire it.
alter default privileges in schema public
  revoke truncate on tables from anon, authenticated, service_role;

-- 2. Close the last standing linter warnings (0028 / 0029).
--
--    rls_auto_enable() is Supabase's own function, backing the "Enable
--    automatic RLS" project setting. Because it lives in the public schema it
--    is published at /rest/v1/rpc/rls_auto_enable and callable by anon. It is
--    an EVENT TRIGGER function; event triggers fire on DDL and do not consult
--    EXECUTE grants, so revoking removes the API surface without disabling the
--    feature.

revoke execute on function public.rls_auto_enable() from anon, authenticated, public;;
