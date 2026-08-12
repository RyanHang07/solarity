-- Security fix flagged by the Supabase linter (0028 / 0029).
--
-- Because handle_new_user() lives in the `public` schema, PostgREST exposes it
-- at /rest/v1/rpc/handle_new_user, callable by both anon and authenticated
-- roles. It is a SECURITY DEFINER function, so it runs with elevated
-- privileges. It is only ever meant to be invoked by the on_auth_user_created
-- trigger, never directly by a client.
--
-- Triggers execute as the table owner and do not consult these grants, so
-- revoking EXECUTE removes the API surface without affecting the trigger.

revoke execute on function public.handle_new_user() from anon, authenticated, public;;
