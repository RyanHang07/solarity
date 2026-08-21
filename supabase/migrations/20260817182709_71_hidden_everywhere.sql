-- 71. `goals.hidden_everywhere`, and one definition of what "hidden" means.
--
-- ## What this closes
--
-- `goal_group_visibility` has a table, a primary key, four RLS policies, grants
-- and two consumers enforcing it. It has never had a row, because nothing in
-- the app can write one. Migration 64's entire masking argument rests on a flag
-- no person can set. This is the first half of turning that on.
--
-- ## Why a column and not rows
--
-- `goal_group_visibility` is sparse: a missing row means visible. So "hide this
-- goal from everyone", expressed as one hidden row per Circle, is only true of
-- the Circles that existed when you said it. Join a new Circle tomorrow and the
-- goal is visible there, silently, because no row says otherwise. Nothing
-- errors; a title just appears in front of people you never chose.
--
-- Hiding everywhere is a property of the goal, so it lives on the goal.
--
-- ## Why the rule moves into the helper
--
-- The rule
--
--     hidden(goal, circle) := goals.hidden_everywhere
--                             OR coalesce(goal_group_visibility.hidden, false)
--
-- already existed in two places. `private.is_goal_hidden_in_group` is what
-- `can_view_checkin_photo` calls; `circle_roster` re-implemented the same thing
-- inline as a `left join`. Two copies agreed only because each was one line.
-- Adding a second term to a rule that lives twice is how you get a title masked
-- on the roster and served with the photo.
--
-- So the helper becomes the definition and `circle_roster` calls it, computing
-- it once per goal in `active_goal` and reusing the result for both the title
-- and the note. At most ten members by ten goals is 100 evaluations of a
-- `stable sql` function over a two-column primary key, on a page that already
-- runs one query. The alternative is the rule living in two places forever.

-- ---------------------------------------------------------------------------
-- The column
-- ---------------------------------------------------------------------------

alter table public.goals
  add column hidden_everywhere boolean not null default false;

comment on column public.goals.hidden_everywhere is
  'Masks this goal''s title in every Circle, including ones joined later. '
  'The per-Circle equivalent is goal_group_visibility.hidden; this is the same '
  'condition applied to all of them, which is why it shares the word. Hiding '
  'never removes the goal from anyone''s counts.';

-- Column-level, because that is the only kind of grant `goals` has.
--
-- `authenticated` holds SELECT on nine named columns and UPDATE on five; there
-- is no table-level grant to inherit from. A new column is therefore invisible
-- and unwritable to every ordinary user until named here, and the failure would
-- be a dashboard that cannot read the switch it is rendering.
grant select (hidden_everywhere), update (hidden_everywhere)
  on public.goals to authenticated;

-- ---------------------------------------------------------------------------
-- The rule, in one place
-- ---------------------------------------------------------------------------

-- CREATE OR REPLACE at an unchanged signature, so the existing EXECUTE grants
-- survive. Changing the signature would make this a new object inheriting no
-- grants at all, which is migration 67's lesson; the assertions at the bottom
-- are what would catch it.
create or replace function private.is_goal_hidden_in_group(
  p_goal_id uuid,
  p_group_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(
      (select g.hidden_everywhere from public.goals g where g.id = p_goal_id),
      false
    )
    or coalesce(
      (
        select v.hidden
        from public.goal_group_visibility v
        where v.goal_id = p_goal_id and v.group_id = p_group_id
      ),
      false
    );
$$;

comment on function private.is_goal_hidden_in_group(uuid, uuid) is
  'The single definition of whether a goal is hidden from a Circle. Both '
  'circle_roster and can_view_checkin_photo call this. Do not re-implement it '
  'inline: the two consumers mask different things (titles, photos) and a rule '
  'that exists twice will eventually disagree with itself.';

-- ---------------------------------------------------------------------------
-- The roster, reading the rule rather than restating it
-- ---------------------------------------------------------------------------
--
-- Unchanged from migration 70 except for `hidden`, which was
-- `coalesce(v.hidden, false)` over a `left join goal_group_visibility` and is
-- now the helper. The join goes with it, since nothing else used it.
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
set search_path = ''
as $$
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
           -- The one definition. See the header.
           private.is_goal_hidden_in_group(g.id, p_group_id) as hidden,
           pe.id is not null as checked,
           -- Yours only. See migration 70.
           case when m.user_id = v_uid then pe.id else null end as entry_id,
           case when m.user_id = v_uid then coalesce(pe.note_shared, false)
                else false end as note_shared,
           case
             when pe.note is null then null
             when m.user_id = v_uid then pe.note
             when pe.note_shared
              and not private.is_goal_hidden_in_group(g.id, p_group_id) then pe.note
             else null
           end as note
    from member m
    join public.goals g on g.user_id = m.user_id
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
         -- Hidden goals are counted. Hiding conceals the title, never the
         -- commitment: a goal you can hide out of your own denominator is a
         -- goal you can quietly abandon. It also keeps this figure agreeing
         -- with daily_completion and the group streak, which count every
         -- active goal and know nothing about visibility.
         coalesce(count(ag.goal_id), 0)::integer as total_count,
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', ag.goal_id,
               'title', case when ag.hidden then null else ag.title end,
               'hidden', ag.hidden,
               'checked', ag.checked,
               'note', ag.note,
               'entry_id', ag.entry_id,
               'note_shared', ag.note_shared
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
$$;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------
--
-- Grants are checked before RLS, and a replaced function at a changed signature
-- is a new object with none. Both failures are silent at deploy time and show
-- up later as "permission denied" from a screen that used to work, so the
-- migration refuses to land instead.
do $$
begin
  if not has_column_privilege('authenticated', 'public.goals', 'hidden_everywhere', 'SELECT') then
    raise exception 'authenticated cannot read goals.hidden_everywhere';
  end if;
  if not has_column_privilege('authenticated', 'public.goals', 'hidden_everywhere', 'UPDATE') then
    raise exception 'authenticated cannot write goals.hidden_everywhere';
  end if;
  if has_column_privilege('anon', 'public.goals', 'hidden_everywhere', 'SELECT') then
    raise exception 'anon can read goals.hidden_everywhere';
  end if;

  if not has_function_privilege('authenticated', 'public.circle_roster(uuid)', 'EXECUTE') then
    raise exception 'authenticated lost EXECUTE on circle_roster';
  end if;
  if has_function_privilege('anon', 'public.circle_roster(uuid)', 'EXECUTE') then
    raise exception 'anon gained EXECUTE on circle_roster';
  end if;

  if not has_function_privilege(
       'authenticated', 'private.is_goal_hidden_in_group(uuid, uuid)', 'EXECUTE') then
    raise exception 'authenticated lost EXECUTE on is_goal_hidden_in_group';
  end if;
  if has_function_privilege(
       'anon', 'private.is_goal_hidden_in_group(uuid, uuid)', 'EXECUTE') then
    raise exception 'anon gained EXECUTE on is_goal_hidden_in_group';
  end if;
end;
$$;
