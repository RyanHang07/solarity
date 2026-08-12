-- Posture audit finding: five private.* helpers created after migration 19 had
-- EXECUTE granted to PUBLIC (and therefore anon):
--   current_checkin_date, is_cycle_member, member_role, owns_active_goal, owns_goal
--
-- The ALTER DEFAULT PRIVILEGES set in migration 19 did not carry to them. Not
-- exploitable — anon still lacks USAGE on the `private` schema, and the linter
-- correctly did not flag it for that reason — but it leaves exactly one barrier
-- where two were intended, which was the whole argument for revoking in the
-- first place. Caught by a direct grant audit rather than by the linter.

revoke execute on all functions in schema private from public;

-- Re-assert only what policies actually need. Anything used solely by triggers
-- or the rollover job stays unreachable by any client role.
grant execute on function private.is_group_member(uuid)            to authenticated;
grant execute on function private.is_group_admin(uuid)             to authenticated;
grant execute on function private.is_group_owner(uuid)             to authenticated;
grant execute on function private.is_cycle_member(uuid)            to authenticated;
grant execute on function private.shares_group_with(uuid)          to authenticated;
grant execute on function private.is_blocked_by(uuid)              to authenticated;
grant execute on function private.is_goal_hidden_in_group(uuid, uuid) to authenticated;
grant execute on function private.owns_goal(uuid)                  to authenticated;
grant execute on function private.owns_active_goal(uuid)           to authenticated;
grant execute on function private.current_checkin_date()           to authenticated;

-- Deliberately NOT granted (trigger/job internals):
--   checkin_date_for, recompute_daily_completion,
--   rollover_user_day, rollover_group_day

-- private.member_role() was written for step 4f but never used: the policies
-- express "never target the owner" as `role <> 'owner'` directly against the row
-- being acted on, which is simpler and avoids a function call per row. Dropping
-- it rather than leaving unreferenced SECURITY DEFINER code in place.
drop function private.member_role(uuid, uuid);;
