-- Migration 68 froze the roster to the closing *date*. It should be the closing
-- *instant*.
--
-- WHAT WAS WRONG. Goals were filtered as of `v_at`, but check-ins were matched
-- on `check_in_date` alone. A Circle archived at 09:00 therefore kept counting
-- check-ins made at 17:00 the same day, because they carry the same date. The
-- frozen number moved after the Circle stopped, which is the whole thing this
-- was meant to prevent.
--
-- Found by testing it, and only because the test asked the awkward question:
-- archive the Circle, then check off another goal, and see whether the number
-- holds. Asserting the frozen value once would have passed.
--
-- Adding `pe.created_at <= v_at` closes it. With `v_at = now()` the predicate is
-- always true, so the live path is untouched: a row cannot have been created
-- after the statement reading it.
--
-- ON THE BOUNDARY: `>` rather than `>=` for goals, and `<=` for entries. A goal
-- archived at exactly the closing instant reads as already gone; a check-in
-- made at exactly that instant reads as counted. Both are arbitrary at the
-- microsecond, and both are stated here so the next person does not have to
-- rediscover which way they went.

create or replace function public.circle_roster(p_group_id uuid)
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
  v_as_of timestamptz;
  v_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated'
      using errcode = 'insufficient_privilege', hint = 'NOT_AUTHENTICATED';
  end if;

  if not private.is_group_member(p_group_id) then
    raise exception 'You are not a member of this Circle'
      using errcode = 'insufficient_privilege', hint = 'NOT_A_MEMBER';
  end if;

  select g.group_status into v_status from public.groups g where g.id = p_group_id;

  if v_status <> 'active' then
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
    -- `created_at <= v_at` is the fix. Matching on the date alone let a
    -- check-in made hours after the Circle closed still land in the frozen
    -- view, because it carried the same date.
    left join public.progress_entries pe
           on pe.goal_id = g.id
          and pe.check_in_date = m.checkin_date
          and pe.created_at <= v_at
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
grant execute on function public.circle_roster(uuid) to authenticated;;
