-- Step 19, and a rule this repository wrote down in migration 7 and I did not
-- follow.
--
-- **Three trigger functions in `public` are three PostgREST endpoints.** A
-- function in that schema is exposed at `/rest/v1/rpc/<name>` to whichever
-- roles hold EXECUTE, and the default is `public`. So migration 103 shipped
-- `trg_goal_achieved_notify`, `trg_day_completed_notify` and
-- `trg_first_checkin_notify` as callable endpoints for `anon` as well as
-- `authenticated`, which is exactly what migration 7 exists to prevent and what
-- the linter flagged the moment it ran (0028 and 0029).
--
-- **Not exploitable, and that is not the point.** plpgsql refuses a trigger
-- function invoked outside a trigger, so the calls fail. The defect is that
-- three `security definer` functions sat on the public API surface relying on a
-- language check rather than on a grant, and the next one might not be a
-- trigger function.
--
-- Triggers execute as the table owner and never consult these grants, so this
-- removes the endpoints without touching the behaviour.
revoke execute on function public.trg_goal_achieved_notify() from anon, authenticated, public;
revoke execute on function public.trg_day_completed_notify() from anon, authenticated, public;
revoke execute on function public.trg_first_checkin_notify() from anon, authenticated, public;
