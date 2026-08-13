-- Expose the caller's current check-in date to the application.
--
-- WHY THIS IS NEEDED. `progress_entries.check_in_date` is NOT NULL with no
-- default, and the INSERT policy demands
--   check_in_date = private.current_checkin_date()
-- so the client must supply a value it has no way to compute. PostgREST cannot
-- address the `private` schema (section 4), and `private` deliberately is not
-- exposed, so the existing function is reachable from policies and from nothing
-- else.
--
-- The read path needs the same value independently: the dashboard has to show
-- which goals are already checked in *today*, which means filtering
-- progress_entries by exactly this date. So the app needs it regardless of how
-- the write is shaped, and an RPC wrapping the insert would not remove the
-- need.
--
-- WHY NOT COMPUTE IT IN TYPESCRIPT. The rule is "now in the user's frozen
-- timezone, minus two hours, cast to date". Reimplementing that in JS means two
-- implementations of one rule, drifting across DST boundaries, and the failure
-- mode is a rejected insert with an opaque RLS error rather than a wrong date.
-- One implementation, in the database, read by everything.
--
-- SECURITY INVOKER, not DEFINER. `authenticated` already holds USAGE on
-- `private` and EXECUTE on the underlying function, because RLS policies call
-- it with the caller's own privileges. This wrapper therefore grants no new
-- capability; it only makes an existing one reachable over HTTP. A DEFINER
-- wrapper would be a privilege escalation with nothing to escalate for.

create or replace function public.current_checkin_date()
returns date
language sql
stable
security invoker
set search_path to ''
as $function$
  select private.current_checkin_date();
$function$;

revoke execute on function public.current_checkin_date() from public, anon;
grant execute on function public.current_checkin_date() to authenticated;

comment on function public.current_checkin_date() is
  'Today under the caller''s frozen check-in timezone and the 2 AM boundary. '
  'Thin invoker-rights wrapper over private.current_checkin_date(), which '
  'PostgREST cannot reach. Never compute this date client-side.';;
