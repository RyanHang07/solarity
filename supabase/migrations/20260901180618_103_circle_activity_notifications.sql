-- Step 19. The triggers that make a Circle talk during the day.
--
-- Every one of these writes rows into *other people's* notification lists, so
-- the ceilings are structural rather than remembered. See build-plan.md step 19
-- for the volume arithmetic that ruled out the obvious version.

/**
 * Who in a Circle may hear about what somebody else did.
 *
 * One place for the three exclusions that apply to every type, because three
 * copies of this is three chances for one of them to be forgotten:
 *   - never the actor themselves
 *   - never across a block, in either direction
 *   - never somebody who turned this kind off
 *
 * **The preference is a CASE rather than dynamic SQL.** A column name passed as
 * text and interpolated would be an injection surface in a `security definer`
 * function for the sake of saving four lines.
 */
create or replace function private.eligible_peers(
  p_group_id uuid,
  p_actor uuid,
  p_pref text
)
returns table (user_id uuid)
language sql
stable
security definer
set search_path to ''
as $$
  select gm.user_id
  from public.group_members gm
  join public.users u on u.id = gm.user_id
  where gm.group_id = p_group_id
    and gm.user_id <> p_actor
    and case p_pref
          when 'goal_achieved'   then u.notify_goal_achieved
          when 'first_finisher'  then u.notify_first_finisher
          when 'last_one_left'   then u.notify_last_one_left
          when 'circle_activity' then u.notify_circle_activity
          -- An unknown preference name is a programming error, and silence is
          -- the wrong failure: it would look exactly like everybody opting out.
          else true
        end
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_user_id = gm.user_id and b.blocked_user_id = p_actor)
         or (b.blocker_user_id = p_actor and b.blocked_user_id = gm.user_id)
    );
$$;

revoke execute on function private.eligible_peers(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- achieved --
--
-- **Rare by construction.** Migration 83 refuses to clear or move
-- `achieved_at`, so this fires exactly once per goal, ever.
--
-- **Masked per Circle, not once.** A goal hidden everywhere says nothing at
-- all; a goal hidden in one Circle announces itself in the others. The title
-- never travels: `send-digest-push` has never named a goal and a lock screen is
-- outside every masking rule the app has.
create or replace function public.trg_goal_achieved_notify()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_who text;
  v_group record;
begin
  if new.hidden_everywhere then
    return new;
  end if;

  select u.username into v_who from public.users u where u.id = new.user_id;
  if v_who is null then
    return new;
  end if;

  for v_group in
    select g.id, g.name
    from public.group_members gm
    join public.groups g on g.id = gm.group_id
    where gm.user_id = new.user_id
      and g.group_status = 'active'
      and not exists (
        select 1 from public.goal_group_visibility v
        where v.goal_id = new.id and v.group_id = g.id and v.hidden
      )
  loop
    insert into public.notifications (user_id, type, payload)
    select p.user_id,
           'goal_achieved',
           jsonb_build_object(
             'group_id', v_group.id,
             'circle_name', v_group.name,
             'who', v_who
           )
    from private.eligible_peers(v_group.id, new.user_id, 'goal_achieved') p;
  end loop;

  return new;
end;
$$;

drop trigger if exists goals_notify_achievement on public.goals;
create trigger goals_notify_achievement
  after update of achieved_at on public.goals
  for each row
  when (new.achieved_at is not null and old.achieved_at is null)
  execute function public.trg_goal_achieved_notify();

-- --------------------------------------------------- finished, and last out --
--
-- **Each member is measured against their own day.** `checkin_date_for` resolves
-- the 2 AM boundary in that member's timezone, so a Circle spanning two
-- timezones does not report somebody as unfinished because it is already
-- tomorrow for them.
--
-- **Both events are guarded on the payload's date rather than trusting that
-- completions only go up.** Undoing a check-in flips `all_completed` back to
-- false, and redoing it would otherwise fire a second time the same day.
create or replace function public.trg_day_completed_notify()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_who text;
  v_group record;
  v_members integer;
  v_done integer;
  v_last uuid;
begin
  if not new.all_completed then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.all_completed then
    return new;
  end if;

  select u.username into v_who from public.users u where u.id = new.user_id;
  if v_who is null then
    return new;
  end if;

  for v_group in
    select g.id, g.name
    from public.group_members gm
    join public.groups g on g.id = gm.group_id
    where gm.user_id = new.user_id and g.group_status = 'active'
  loop
    select count(*) into v_members
    from public.group_members gm where gm.group_id = v_group.id;

    select count(*) into v_done
    from public.group_members gm
    where gm.group_id = v_group.id
      and exists (
        select 1 from public.daily_completion dc
        where dc.user_id = gm.user_id
          and dc.date = private.checkin_date_for(gm.user_id)
          and dc.all_completed
      );

    -- First out of the gate. A Circle of one has nobody to tell, and telling
    -- them they were first would be absurd.
    if v_done = 1 and v_members > 1 then
      insert into public.notifications (user_id, type, payload)
      select p.user_id,
             'circle_first_finisher',
             jsonb_build_object(
               'group_id', v_group.id,
               'circle_name', v_group.name,
               'who', v_who,
               'date', new.date
             )
      from private.eligible_peers(v_group.id, new.user_id, 'first_finisher') p
      where not exists (
        select 1 from public.notifications n
        where n.user_id = p.user_id
          and n.type = 'circle_first_finisher'
          and n.payload ->> 'group_id' = v_group.id::text
          and n.payload ->> 'date' = new.date::text
      );
    end if;

    -- And the other end of the same fact. Addressed to one person, about
    -- themselves, which is why no block check applies: it names nobody.
    if v_members - v_done = 1 then
      select gm.user_id into v_last
      from public.group_members gm
      join public.users u on u.id = gm.user_id
      where gm.group_id = v_group.id
        and u.notify_last_one_left
        and not exists (
          select 1 from public.daily_completion dc
          where dc.user_id = gm.user_id
            and dc.date = private.checkin_date_for(gm.user_id)
            and dc.all_completed
        )
      limit 1;

      if v_last is not null then
        insert into public.notifications (user_id, type, payload)
        select v_last,
               'last_one_left',
               jsonb_build_object(
                 'group_id', v_group.id,
                 'circle_name', v_group.name,
                 'date', private.checkin_date_for(v_last)
               )
        where not exists (
          select 1 from public.notifications n
          where n.user_id = v_last
            and n.type = 'last_one_left'
            and n.payload ->> 'group_id' = v_group.id::text
            and n.payload ->> 'date' = private.checkin_date_for(v_last)::text
        );
      end if;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists daily_completion_notify on public.daily_completion;
create trigger daily_completion_notify
  after insert or update of all_completed on public.daily_completion
  for each row execute function public.trg_day_completed_notify();

-- --------------------------------------------------------------- activity ---
--
-- **The only high-frequency type, and the only one that appends.**
--
-- One row per recipient per Circle per delivery cycle: if the recipient already
-- has an undelivered `circle_activity` row for this Circle, the new name joins
-- its payload instead of a second row appearing. `send-digest-push` clears
-- `pushed_at` hourly, so the ceiling falls out of the delivery schedule rather
-- than from a number somebody has to maintain.
--
-- **The four-hour bound is not belt and braces.** A recipient with no push
-- subscription may never have `pushed_at` set at all, and without a window
-- their row would accumulate names indefinitely. Four hours is wide enough that
-- the hourly cron always wins the race and narrow enough to bound the worst
-- case.
create or replace function public.trg_first_checkin_notify()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_who text;
  v_group record;
  v_peer uuid;
  v_count integer;
begin
  -- First check-in of this user's day, and only that. Every later one is the
  -- same news.
  select count(*) into v_count
  from public.progress_entries pe
  where pe.user_id = new.user_id and pe.check_in_date = new.check_in_date;

  if v_count <> 1 then
    return new;
  end if;

  select u.username into v_who from public.users u where u.id = new.user_id;
  if v_who is null then
    return new;
  end if;

  for v_group in
    select g.id, g.name
    from public.group_members gm
    join public.groups g on g.id = gm.group_id
    where gm.user_id = new.user_id and g.group_status = 'active'
  loop
    for v_peer in
      select p.user_id
      from private.eligible_peers(v_group.id, new.user_id, 'circle_activity') p
    loop
      update public.notifications n
         set payload = jsonb_set(
               n.payload,
               '{names}',
               case
                 when n.payload -> 'names' @> to_jsonb(v_who) then n.payload -> 'names'
                 else (n.payload -> 'names') || to_jsonb(v_who)
               end
             )
       where n.user_id = v_peer
         and n.type = 'circle_activity'
         and n.pushed_at is null
         and n.created_at > now() - interval '4 hours'
         and n.payload ->> 'group_id' = v_group.id::text;

      if not found then
        insert into public.notifications (user_id, type, payload)
        values (
          v_peer,
          'circle_activity',
          jsonb_build_object(
            'group_id', v_group.id,
            'circle_name', v_group.name,
            'names', jsonb_build_array(v_who)
          )
        );
      end if;
    end loop;
  end loop;

  return new;
end;
$$;

drop trigger if exists progress_entries_notify_first on public.progress_entries;
create trigger progress_entries_notify_first
  after insert on public.progress_entries
  for each row execute function public.trg_first_checkin_notify();
