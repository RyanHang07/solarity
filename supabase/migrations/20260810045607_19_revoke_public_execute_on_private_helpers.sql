-- Follow-up to 4a, caught by structural verification.
--
-- Postgres grants EXECUTE to PUBLIC by default on every newly created function,
-- and PUBLIC includes `anon`. Granting explicitly to `authenticated` does not
-- displace that default.
--
-- These functions are not currently reachable by anon, because calling a
-- function also requires USAGE on its schema and anon has none on `private`.
-- But that leaves exactly one thing standing between an anonymous request and a
-- set of SECURITY DEFINER functions that bypass RLS. Two independent barriers
-- is the intent, so revoke the redundant grant as well.

revoke execute on all functions in schema private from public;

-- Re-assert the intended grant, since the blanket revoke above also strips it.
grant execute on function private.is_group_member(uuid) to authenticated;
grant execute on function private.is_group_admin(uuid) to authenticated;
grant execute on function private.is_group_owner(uuid) to authenticated;
grant execute on function private.shares_group_with(uuid) to authenticated;
grant execute on function private.is_blocked_by(uuid) to authenticated;
grant execute on function private.is_goal_hidden_in_group(uuid, uuid) to authenticated;

-- Future helpers added to this schema inherit the same posture rather than
-- depending on someone remembering to revoke.
alter default privileges in schema private
  revoke execute on functions from public;;
