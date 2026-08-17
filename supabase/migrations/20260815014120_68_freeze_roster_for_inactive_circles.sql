-- 8a. An archived Circle stops reporting today's numbers.
--
-- THE PROBLEM. `circle_roster` computed against `now()` unconditionally, so a
-- retired Circle rendered live counts as though it were still running. Nothing
-- can change them, which makes them meaningless at best and current-looking at
-- worst.
--
-- REFUSING WAS THE OTHER OPTION, and it answers a state question with an access
-- answer. Archived is not a permission problem: the member is still entitled to
-- look. It would also make the tab unreachable rather than empty.
--
-- SO: FREEZE. The roster shows the Circle as it ended.
--
-- The fix is to stop hard-coding "now". Every part of this already computed
-- against an instant and merely assumed that instant was the present. Passing
-- it in makes the live case and the frozen case the same code, with no branch
-- in the query itself.

-- ---------------------------------------------------------------------------
-- 1. The 2 AM rule, at an arbitrary instant.
--
-- `current_checkin_date(user)` becomes one call of this. Still exactly one
-- implementation of the boundary; it just stops assuming which moment.
-- ---------------------------------------------------------------------------
create or replace function private.checkin_date_at(p_user_id uuid, p_at timestamptz)
returns date
language sql
stable
security definer
set search_path to ''
as $function$
  select (
    (p_at at time zone coalesce(
      (select u.checkin_timezone from public.users u where u.id = p_user_id),
      'UTC'
    )) - interval '2 hours'
  )::date;
$function$;

-- Migration 67's lesson, applied at the point of creation rather than after an
-- audit: a new signature is a new object and inherits none of its siblings'
-- grants, so Postgres would leave EXECUTE with PUBLIC.
revoke execute on function private.checkin_date_at(uuid, timestamptz) from public, anon;
grant execute on function private.checkin_date_at(uuid, timestamptz) to authenticated;

create or replace function private.current_checkin_date(p_user_id uuid)
returns date
language sql
stable
security definer
set search_path to ''
as $function$
  select private.checkin_date_at(p_user_id, now());
$function$;

-- ---------------------------------------------------------------------------
-- 2. The roster, frozen when the Circle is not active.
--
-- Return type changes, so the old signature has to go first.
-- ---------------------------------------------------------------------------
drop function if exists public.circle_roster(uuid);

create function public.circle_roster(p_group_id uuid)
returns table (
  user_id uuid,
  username text,
  display_name text,
  role text,
  is_self boolean,
  streak_grace boolean,
  circle_status text,
  as_of timestamptz,
  checkin_date date,
  checked_count integer,
  total_count integer,
  goals jsonb
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_status public.group_status;
  v_as_of timestamptz;   -- null while the Circle is live
  v_at timestamptz;      -- the instant everything is computed against
begin
  if v_uid is null then
    raise exception 'Not authenticated'
      using errcode = 'insufficient_privilege', hint = 'NOT_AUTHENTICATED';
  end if;

  -- SECURITY DEFINER bypasses RLS, so membership is checked explicitly.
  if not private.is_group_member(p_group_id) then
    raise exception 'You are not a member of this Circle'
      using errcode = 'insufficient_privilege', hint = 'NOT_A_MEMBER';
  end if;

  select g.group_status into v_status from public.groups g where g.id = p_group_id;

  if v_status <> 'active' then
    -- The closing instant. `archive_circle` sets `ended_at`, but the succession
    -- path in `handle_membership_removal` archives a Circle when its last
    -- member leaves WITHOUT closing the cycle, so this can legitimately be
    -- null. `updated_at` is the fallback rather than `now()`, which would
    -- silently un-freeze the thing this function exists to freeze.
    select max(gc.ended_at) into v_as_of
    from public.group_cycles gc where gc.group_id = p_group_id;

    if v_as_of is null then
      select g.updated_at into v_as_of from public.groups g where g.id = p_group_id;
    end if;
  end if;

  v_at := coalesce(v_as_of, now());

  return query
  with member as (
    select gm.user_id, gm.role::text as role, gm.joined_at, gm.streak_grace,
           private.checkin_date_at(gm.user_id, v_at) as checkin_date
    from public.group_members gm
    where gm.group_id = p_group_id
  ),
  active_goal as (
    select m.user_id, g.id as goal_id, g.title, m.checkin_date,
           coalesce(v.hidden, false) as hidden,
           pe.id is not null as checked,
           case
             when pe.note is null then null
             when m.user_id = v_uid then pe.note
             when pe.note_shared and not coalesce(v.hidden, false) then pe.note
             else null
           end as note
    from member m
    join public.goals g on g.user_id = m.user_id
    left join public.goal_group_visibility v
           on v.goal_id = g.id and v.group_id = p_group_id
    left join public.progress_entries pe
           on pe.goal_id = g.id and pe.check_in_date = m.checkin_date
    -- Goals as they stood at `v_at`, not as they stand now. Someone archiving
    -- three goals next week must not retroactively change what this Circle
    -- looked like when it closed.
    --
    -- With v_at = now() this reduces to the live rule on its own: `created_at`
    -- is always in the past, and a CHECK already forbids `archived_at` from
    -- being in the future. One expression, no branch.
    where g.created_at <= v_at
      and (g.archived_at is null or g.archived_at > v_at)
      and (g.achieved_at is null or g.achieved_at > v_at)
  )
  select m.user_id,
         u.username,
         u.display_name,
         m.role,
         m.user_id = v_uid as is_self,
         m.streak_grace,
         v_status::text as circle_status,
         v_as_of as as_of,
         m.checkin_date,
         coalesce(count(*) filter (where ag.checked), 0)::integer as checked_count,
         coalesce(count(ag.goal_id), 0)::integer as total_count,
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', ag.goal_id,
               'title', case when ag.hidden then null else ag.title end,
               'hidden', ag.hidden,
               'checked', ag.checked,
               'note', ag.note
             )
             order by ag.hidden, ag.title
           ) filter (where ag.goal_id is not null),
           '[]'::jsonb
         ) as goals
  from member m
  join public.users u on u.id = m.user_id
  left join active_goal ag on ag.user_id = m.user_id
  group by m.user_id, u.username, u.display_name, m.role, m.streak_grace,
           m.checkin_date, m.joined_at
  order by (m.user_id = v_uid) desc, m.joined_at asc;
end;
$function$;

revoke execute on function public.circle_roster(uuid) from public, anon;
grant execute on function public.circle_roster(uuid) to authenticated;

comment on function public.circle_roster(uuid) is
  'Circle roster. Live counts while the Circle is active; frozen to the closing '
  'instant once it is not, with as_of set. Hidden goals return a null title and '
  'their real checked state. Notes only when shared and the goal is visible.';;
