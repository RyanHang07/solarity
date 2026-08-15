-- Close the hidden-goal leak, and give the Circle roster something to read.
--
-- THE HOLE. `goals_select_own_or_groupmate` was `user_id = auth.uid() OR
-- shares_group_with(user_id)` and consulted `goal_group_visibility` nowhere, so
-- any circle-mate could GET /rest/v1/goals and read every title, hidden or not.
-- `progress_entries` was the same, notes included.
--
-- The design always said "the API masks title/note/photo_url". There is no API:
-- the client talks to PostgREST directly, so the masking layer never existed.
-- Nothing leaked in practice only because nothing rendered another member's
-- titles. Step 8 is the feature that starts rendering them.
--
-- WHY RLS CANNOT FIX IT. Policies are row-level. Returning a row to a viewer
-- with one column blanked, and to another with it intact, is not something a
-- USING clause can express. So the rows stop being reachable directly and a
-- SECURITY DEFINER function returns the shape the roster needs, already masked.
--
-- WHAT THIS COSTS. Any future read of a circle-mate's goals must go through the
-- RPC. That is the point rather than a side effect.

-- ---------------------------------------------------------------------------
-- 1. Narrow the two tables to their owner.
-- ---------------------------------------------------------------------------
drop policy if exists goals_select_own_or_groupmate on public.goals;
create policy goals_select_own on public.goals
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists progress_entries_select_own_or_groupmate on public.progress_entries;
create policy progress_entries_select_own on public.progress_entries
  for select to authenticated
  using (user_id = (select auth.uid()));

-- `daily_completion` and `users` stay readable by circle-mates on purpose:
-- whether someone finished their day, and their name, are the product. Neither
-- carries free text that could need masking.

-- ---------------------------------------------------------------------------
-- 2. Each member's own check-in date.
--
-- The no-argument version answered only for the caller, so a roster could not
-- say what "today" means for someone in another timezone. One implementation of
-- the 2 AM rule, now parameterised; the old signature delegates to it so the
-- rule still lives in exactly one place.
-- ---------------------------------------------------------------------------
create or replace function private.current_checkin_date(p_user_id uuid)
returns date
language sql
stable
security definer
set search_path to ''
as $function$
  select (
    (now() at time zone coalesce(
      (select u.checkin_timezone from public.users u where u.id = p_user_id),
      'UTC'
    )) - interval '2 hours'
  )::date;
$function$;

create or replace function private.current_checkin_date()
returns date
language sql
stable
security definer
set search_path to ''
as $function$
  select private.current_checkin_date((select auth.uid()));
$function$;

-- ---------------------------------------------------------------------------
-- 3. The roster.
--
-- Returns every member of a Circle with their counts for THEIR day, and their
-- goals with `title` nulled where the goal is hidden in THIS Circle.
--
-- `hidden` is returned alongside so the UI can render a placeholder, and
-- `checked` is returned for hidden goals too: hiding a goal means "do not show
-- what it is", not "do not show whether it was done". A hidden goal still
-- counts toward the streak everyone shares, so hiding its state as well would
-- opt out of the accountability while keeping the benefit.
--
-- The denominator therefore includes hidden goals, which does reveal how many
-- someone has. Unavoidable once the counts have to add up, and deliberate.
--
-- Ordered you-first, then by joined_at. Not by completion: a roster that
-- reshuffles as the day progresses cannot be looked at twice, and ranking
-- belongs to the leaderboard.
-- ---------------------------------------------------------------------------
create or replace function public.circle_roster(p_group_id uuid)
returns table (
  user_id uuid,
  username text,
  display_name text,
  role text,
  is_self boolean,
  streak_grace boolean,
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
begin
  if v_uid is null then
    raise exception 'Not authenticated'
      using errcode = 'insufficient_privilege', hint = 'NOT_AUTHENTICATED';
  end if;

  -- SECURITY DEFINER bypasses RLS, so membership is checked explicitly. Without
  -- this the function would hand any Circle's roster to anyone who guessed an
  -- id, which is the whole class of bug the definer flag invites.
  if not private.is_group_member(p_group_id) then
    raise exception 'You are not a member of this Circle'
      using errcode = 'insufficient_privilege', hint = 'NOT_A_MEMBER';
  end if;

  return query
  with member as (
    select gm.user_id, gm.role::text as role, gm.joined_at, gm.streak_grace,
           private.current_checkin_date(gm.user_id) as checkin_date
    from public.group_members gm
    where gm.group_id = p_group_id
  ),
  active_goal as (
    select m.user_id, g.id as goal_id, g.title, m.checkin_date,
           coalesce(v.hidden, false) as hidden,
           exists (
             select 1 from public.progress_entries pe
             where pe.goal_id = g.id and pe.check_in_date = m.checkin_date
           ) as checked
    from member m
    join public.goals g on g.user_id = m.user_id
    -- Sparse table: a missing row means visible, so LEFT JOIN and coalesce.
    left join public.goal_group_visibility v
           on v.goal_id = g.id and v.group_id = p_group_id
    where g.archived_at is null and g.achieved_at is null
  )
  select m.user_id,
         u.username,
         u.display_name,
         m.role,
         m.user_id = v_uid as is_self,
         m.streak_grace,
         m.checkin_date,
         coalesce(count(*) filter (where ag.checked), 0)::integer as checked_count,
         coalesce(count(ag.goal_id), 0)::integer as total_count,
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', ag.goal_id,
               -- The masking, and the only place it happens.
               'title', case when ag.hidden then null else ag.title end,
               'hidden', ag.hidden,
               'checked', ag.checked
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
  'Circle roster with per-member counts for their own check-in date. Hidden '
  'goals come back with a null title but their real checked state. Members '
  'only; you first, then joined order.';

-- ---------------------------------------------------------------------------
-- 4. `owns_active_goal` finally gets its caller.
--
-- The photo INSERT policy checked only that the folder was the uploader's, not
-- that the second path segment was a goal they own and can still check in on.
-- So a fabricated or archived goal id was an acceptable upload target, which is
-- exactly what this helper was written to prevent and never wired to do.
-- ---------------------------------------------------------------------------
drop policy if exists checkin_photos_insert on storage.objects;
create policy checkin_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'checkin-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and array_length(storage.foldername(name), 1) = 2
    and private.owns_active_goal(((storage.foldername(name))[2])::uuid)
  );;
