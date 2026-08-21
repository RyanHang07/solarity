-- 73. Every notification payload that names a Circle carries the name.
--
-- ## What this closes
--
-- `payload.group_id` is a jsonb value with **no foreign key**. Deleting a
-- Circle orphans every notification about it, and a live join then returns
-- nothing, so the row renders blank. Two of the three existing writers already
-- knew this: `join_circle` and `handle_membership_removal` both denormalise
-- `circle_name`, and the latter says so in a comment.
--
-- `build_daily_digests` was the one outlier, which is why 51 of the 52 rows in
-- the table could not name their own Circle.
--
-- ## The rule
--
--   A payload naming a CIRCLE carries `group_id` AND `circle_name`.
--   A payload naming a PERSON carries their `username`, frozen at write time.
--
-- `circle_name` is a **fallback, not a display source.** The name is joined
-- live from `groups` at render time so a rename reads correctly; the stored
-- copy renders only when the join finds nothing, as `<name> (no longer
-- available)`. This is the person/object split: crediting a past act to
-- whoever holds a username today is a bug, but a renamed Circle is the same
-- Circle.
--
-- ## Why a constraint rather than a note in the docs
--
-- `goal_group_visibility` had four policies, grants, two consumers enforcing
-- it, a documented rule, and zero rows, for weeks. A rule nothing checks has
-- already been broken somewhere nobody has looked.
--
-- ## What this does NOT do
--
-- It does not put a Circle name on a lock screen. `send-digest-push` builds
-- its body from `completed_count` and `member_count` alone and states in its
-- own header that names are deliberately kept out of push bodies "even though
-- the payload carries them for in-app rendering". This key is for the in-app
-- list. Anything that later wants it in a body is making a new decision.

create or replace function public.build_daily_digests(p_date date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_summary jsonb;
  v_completed integer;
  v_total integer;
  v_written integer := 0;
begin
  for r in
    select gc.group_id,
           gc.id as cycle_id,
           gc.current_streak,
           g.name as group_name,
           coalesce(p_date, private.circle_checkin_date(gc.group_id) - 1) as d
    from public.group_cycles gc
    join public.groups g on g.id = gc.group_id
    where gc.ended_at is null
      and g.group_status = 'active'
  loop
    if exists (
      select 1 from public.digest_snapshots ds
      where ds.group_id = r.group_id and ds.date = r.d
    ) then
      continue;
    end if;

    -- Usernames are denormalized INTO the snapshot at write time. Joining live
    -- would let a past digest silently relabel itself when someone renames.
    select
      jsonb_agg(
        jsonb_build_object(
          'user_id',   m.user_id,
          'username',  m.username,
          'completed', m.completed,
          'streak',    m.streak
        ) order by m.username
      ),
      count(*) filter (where m.completed),
      count(*)
    into v_summary, v_completed, v_total
    from (
      select gm.user_id,
             u.username,
             coalesce(dc.all_completed, false) as completed,
             coalesce(gcs.current_streak, 0)   as streak
      from public.group_members gm
      join public.users u on u.id = gm.user_id
      left join public.daily_completion dc
        on dc.user_id = gm.user_id and dc.date = r.d
      left join public.group_cycle_stats gcs
        on gcs.cycle_id = r.cycle_id and gcs.user_id = gm.user_id
      where gm.group_id = r.group_id
    ) m;

    if v_total is null or v_total = 0 then
      continue;
    end if;

    -- The snapshot carries no Circle name and does not need one: `group_id` is
    -- a real column here with a real foreign key, unlike in a jsonb payload.
    insert into public.digest_snapshots (group_id, date, summary)
    values (
      r.group_id,
      r.d,
      jsonb_build_object(
        'members',        coalesce(v_summary, '[]'::jsonb),
        'completed_count', v_completed,
        'member_count',    v_total,
        'group_streak',    r.current_streak
      )
    )
    on conflict (group_id, date) do nothing;

    -- One notification per member per Circle, never one combined across
    -- Circles. Teaser only: iOS truncates long bodies, and a detailed payload
    -- risks surfacing hidden-goal-adjacent detail on a lock screen, outside the
    -- app's access controls.
    --
    -- `circle_name` is a fallback for in-app rendering. See the header.
    insert into public.notifications (user_id, type, payload)
    select gm.user_id,
           'digest',
           jsonb_build_object(
             'group_id',        r.group_id,
             'circle_name',     r.group_name,
             'date',            r.d,
             'completed_count', v_completed,
             'member_count',    v_total,
             'group_streak',    r.current_streak
           )
    from public.group_members gm
    where gm.group_id = r.group_id;

    v_written := v_written + 1;
  end loop;

  return v_written;
end;
$$;

-- Backfill, so the constraint lands validated rather than NOT VALID. A NOT
-- VALID constraint is a rule that does not apply to the rows you already have,
-- which is the half hardest to reason about later. Checked first: every
-- existing row's Circle is alive, so none is left without a name.
update public.notifications n
set payload = n.payload || jsonb_build_object('circle_name', g.name)
from public.groups g
where g.id = (n.payload->>'group_id')::uuid
  and n.payload ? 'group_id'
  and not (n.payload ? 'circle_name');

alter table public.notifications
  add constraint notifications_payload_names_its_circle
  check (
    case when type in ('digest','invite_accepted','kicked',
                       'group_locked_renewal','deadline_changed')
         then payload ? 'group_id' and payload ? 'circle_name'
         else true
    end
  );

comment on constraint notifications_payload_names_its_circle on public.notifications is
  'Every payload naming a Circle carries group_id AND circle_name. The name is a fallback for when the Circle is gone: payload.group_id is jsonb with no foreign key, so a deleted Circle orphans the row and a live join returns nothing. Keyed on type with an else-true branch so a sixth notification type is unconstrained until someone designs its shape, rather than being unable to insert at all.';

do $$
declare v_missing integer;
begin
  select count(*) into v_missing
  from public.notifications
  where payload ? 'group_id' and not (payload ? 'circle_name');
  if v_missing > 0 then
    raise exception '% notification rows still name no Circle', v_missing;
  end if;

  -- Reachable by the scheduler and by nobody else.
  --
  -- pg_cron runs every job in this project as `postgres`, so that is the only
  -- role that needs EXECUTE. The first draft of this migration asserted
  -- `service_role` instead and aborted the whole thing, which is the assertion
  -- working: `build_daily_digests` writes a notification to every member of
  -- every Circle, and a client role able to call it could spam the lot.
  if not has_function_privilege('postgres', 'public.build_daily_digests(date)', 'EXECUTE') then
    raise exception 'the scheduler lost EXECUTE on build_daily_digests';
  end if;
  if has_function_privilege('service_role', 'public.build_daily_digests(date)', 'EXECUTE') then
    raise exception 'service_role gained EXECUTE on build_daily_digests';
  end if;
  if has_function_privilege('authenticated', 'public.build_daily_digests(date)', 'EXECUTE') then
    raise exception 'authenticated gained EXECUTE on build_daily_digests';
  end if;
  if has_function_privilege('anon', 'public.build_daily_digests(date)', 'EXECUTE') then
    raise exception 'anon gained EXECUTE on build_daily_digests';
  end if;
end;
$$;
