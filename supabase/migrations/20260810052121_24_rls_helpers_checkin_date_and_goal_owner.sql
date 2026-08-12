-- Additional RLS helpers required by step 4e.

-- Resolves "today" for the current user under the 2 AM boundary rule, using
-- their FROZEN checkin_timezone rather than anything the client sends.
--
-- This closes a real hole: check_in_date arrives from the client, so without a
-- server-side notion of the correct date, a user could POST check-ins dated
-- weeks back and fabricate an unbroken streak. Section 3 defines the rule; this
-- is what enforces it.
--
-- Subtracting 2 hours before casting to date implements the boundary: at 01:30
-- local Tuesday, minus 2 hours is 23:30 Monday, which resolves to Monday.
create function private.current_checkin_date()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (
    (now() at time zone coalesce(
      (select u.checkin_timezone from public.users u where u.id = (select auth.uid())),
      'UTC'
    )) - interval '2 hours'
  )::date;
$$;

-- Ownership check used by goal_group_visibility, which has no user column of
-- its own. SECURITY DEFINER so the lookup does not re-enter the goals policy.
create function private.owns_goal(p_goal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.goals g
    where g.id = p_goal_id
      and g.user_id = (select auth.uid())
  );
$$;

grant execute on function private.current_checkin_date() to authenticated;
grant execute on function private.owns_goal(uuid) to authenticated;;
