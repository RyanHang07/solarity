-- 72. Masking is a statement about other people. It never applies to you.
--
-- ## The bug
--
-- Found by the rolled-back proof for migration 71, the first test ever to look
-- at a hidden goal from the side of the person who hid it.
--
-- `circle_roster` masked the title with `case when ag.hidden then null end`,
-- unconditionally. The note two fields below it has carried a
-- `when m.user_id = v_uid` exemption since migration 66; the title never got
-- one. So your own row in a Circle handed you your own note, your own
-- `entry_id` and your own `note_shared`, and then withheld your own title:
--
--     {"title": null, "hidden": true, "note": "…", "entry_id": "…"}
--
-- The screen rendered "Hidden goal" to the one person on earth who already
-- knew what it said.
--
-- `private.can_view_checkin_photo` had the same hole and worse consequences.
-- It joins `group_members` to itself, so when you ask about your own goal both
-- sides of the join match you, the hidden check runs, and it returns false.
-- Marking a goal hidden took your own check-in photo away from you.
--
-- ## The shape
--
-- One rule, applied per field, exempted in one field only. Both halves were
-- written by hand in two places and only one of them learned about `is_self`.
-- This is why migration 71 moved the *hidden* rule into a single function, and
-- it is the argument for doing the same to anything else that gets masked.
--
-- ## What this does not change
--
-- `hidden` still reports true on your own row. That is not a leftover: it is
-- the only signal the screen has that this goal is concealed here, and the
-- marker beside your own title is the one place you can see, from inside the
-- Circle, what this Circle cannot.
--
-- Nothing about what a circle-mate sees changes. The proof asserts both
-- directions, because an exemption is exactly the kind of change that fixes
-- one view by opening another.

create or replace function private.can_view_checkin_photo(p_owner uuid, p_goal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- Yours is always yours. Without this line `mine` and `theirs` both match
    -- you and the hidden check runs against the person it was meant to protect.
    p_owner = (select auth.uid())
    or exists (
      select 1
      from public.group_members mine
      join public.group_members theirs on theirs.group_id = mine.group_id
      where mine.user_id = (select auth.uid())
        and theirs.user_id = p_owner
        and not private.is_goal_hidden_in_group(p_goal_id, mine.group_id)
    );
$$;

-- Unchanged from migration 71 except for `is_self` in `active_goal` and the
-- title case that reads it.
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
           m.user_id = v_uid as is_self,
           private.is_goal_hidden_in_group(g.id, p_group_id) as hidden,
           pe.id is not null as checked,
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
         coalesce(count(ag.goal_id), 0)::integer as total_count,
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', ag.goal_id,
               'title', case when ag.hidden and not ag.is_self then null
                             else ag.title end,
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

do $$
begin
  if not has_function_privilege('authenticated', 'public.circle_roster(uuid)', 'EXECUTE') then
    raise exception 'authenticated lost EXECUTE on circle_roster';
  end if;
  if has_function_privilege('anon', 'public.circle_roster(uuid)', 'EXECUTE') then
    raise exception 'anon gained EXECUTE on circle_roster';
  end if;
  if not has_function_privilege('authenticated', 'private.can_view_checkin_photo(uuid, uuid)', 'EXECUTE') then
    raise exception 'authenticated lost EXECUTE on can_view_checkin_photo';
  end if;
  if has_function_privilege('anon', 'private.can_view_checkin_photo(uuid, uuid)', 'EXECUTE') then
    raise exception 'anon gained EXECUTE on can_view_checkin_photo';
  end if;
end;
$$;
