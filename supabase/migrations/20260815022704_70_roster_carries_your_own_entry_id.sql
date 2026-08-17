-- 8d. The roster gains what it needs to let you un-share your own note.
--
-- `setNoteSharing` takes an entry id, and the roster returned goal ids only, so
-- there was no way to wire the control to the note it sits under.
--
-- TWO FIELDS, AND ONLY FOR YOUR OWN ROWS:
--
--   entry_id     the check-in the note belongs to
--   note_shared  whether it is currently shared, so the control can say which
--                way it will go
--
-- Both are null and false respectively for everyone else. Not because an entry
-- id is especially sensitive, but because the whole point of this function is
-- that it returns the least it can: a viewer who cannot act on a row has no use
-- for its primary key.
--
-- `note_shared` for another member would also be a small leak of its own. You
-- can already see a shared note; being told that someone's *invisible* note
-- exists but is private tells you something they chose not to tell you.

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
           -- Yours only. See the header.
           case when m.user_id = v_uid then pe.id else null end as entry_id,
           case when m.user_id = v_uid then coalesce(pe.note_shared, false)
                else false end as note_shared,
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
$function$;

revoke execute on function public.circle_roster(uuid) from public, anon;
grant execute on function public.circle_roster(uuid) to authenticated;;
