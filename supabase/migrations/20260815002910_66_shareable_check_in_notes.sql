-- Step 7h. A check-in note can be shared with the Circle, one note at a time.
--
-- THE SHAPE OF THE PROBLEM, AFTER MIGRATION 64. Notes are already private:
-- `progress_entries_select_own` is `user_id = auth.uid()`, and `circle_roster`
-- never returned note text. So this is not "add privacy to public notes", it is
-- "add the ability to share one".
--
-- That decides the default without further argument. `note_shared` is false, so
-- every note ever written stays exactly as private as it is today and nothing
-- needs grandfathering. Forgetting the toggle fails toward silence rather than
-- toward exposure, which is the correct direction for text about your own life.
--
-- NOT PER-CIRCLE. A note-by-Circle table would mirror `goal_group_visibility`
-- for a distinction almost nobody wants, and notes are daily, so it would grow
-- fast for very little. Shared means shared with the Circles that can already
-- see the goal.
--
-- WHICH IS THE SUBTLE PART: sharing WIDENS what a viewer may see, it never
-- overrides the goal's own rule. A shared note on a goal hidden in this Circle
-- stays invisible here. That falls out of the existing join on
-- `goal_group_visibility` rather than needing a second check, and it is the
-- case a naive implementation gets wrong.

alter table public.progress_entries
  add column if not exists note_shared boolean not null default false;

comment on column public.progress_entries.note_shared is
  'Opt-in. When true, circle_roster returns this note to circle-mates who can '
  'already see the goal. Never overrides goal_group_visibility.';

-- Insert it with the check-in, and change your mind later. The flag is read at
-- query time, so un-sharing is retroactive with no extra machinery.
grant insert (note_shared) on public.progress_entries to authenticated;
grant update (note_shared) on public.progress_entries to authenticated;

-- ---------------------------------------------------------------------------
-- The roster starts carrying note text, under both conditions at once.
--
-- Only the `goals` element changes: `note` is added, non-null only when the
-- entry exists, is shared, and the goal is visible in this Circle. Everything
-- else is migration 64's function unchanged.
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
           pe.id is not null as checked,
           -- Your own note always comes back. Someone else's only if they
           -- shared it AND the goal is visible here.
           case
             when pe.note is null then null
             when m.user_id = v_uid then pe.note
             when pe.note_shared and not coalesce(v.hidden, false) then pe.note
             else null
           end as note
    from member m
    join public.goals g on g.user_id = m.user_id
    -- Sparse table: a missing row means visible, so LEFT JOIN and coalesce.
    left join public.goal_group_visibility v
           on v.goal_id = g.id and v.group_id = p_group_id
    left join public.progress_entries pe
           on pe.goal_id = g.id and pe.check_in_date = m.checkin_date
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

comment on function public.circle_roster(uuid) is
  'Circle roster with per-member counts for their own check-in date. Hidden '
  'goals come back with a null title but their real checked state. Notes only '
  'when shared and the goal is visible here. Members only; you first.';;
