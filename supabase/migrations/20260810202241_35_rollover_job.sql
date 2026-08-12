-- Solarity: derived-table population, part 2 — the 2 AM rollover.
--
-- Everything that can only be known once a day has ENDED lives here: individual
-- streaks, lifetime totals, the leaderboard, the group streak, and cycle locking.
--
-- Scheduling is separate (pg_cron or Vercel Cron). This function is the unit of
-- work, written so it can be called for any date and safely re-run.

create function private.rollover_user_day(p_user_id uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_complete boolean;
  v_prev boolean;
  v_new_streak integer;
begin
  -- Finalize the day. A user who never checked in has no daily_completion row
  -- at all, and a goal-less day must still be recorded as a failure (section 3),
  -- so this writes the row rather than assuming one exists.
  perform private.recompute_daily_completion(p_user_id, p_date);

  select all_completed into v_complete
  from public.daily_completion where user_id = p_user_id and date = p_date;

  select all_completed into v_prev
  from public.daily_completion where user_id = p_user_id and date = p_date - 1;

  if v_complete then
    -- Continue the run if yesterday also held, otherwise start a new one.
    select case when coalesce(v_prev, false)
                then uls.current_streak + 1
                else 1 end
      into v_new_streak
    from public.user_lifetime_stats uls where uls.user_id = p_user_id;

    update public.user_lifetime_stats
    set current_streak = v_new_streak,
        longest_streak_ever = greatest(longest_streak_ever, v_new_streak),
        total_days_completed = total_days_completed + 1
    where user_id = p_user_id;
  else
    update public.user_lifetime_stats
    set current_streak = 0
    where user_id = p_user_id;
  end if;

  -- Per-cycle streaks, for every active cycle this user belongs to.
  update public.group_cycle_stats gcs
  set current_streak = case when v_complete then gcs.current_streak + 1 else 0 end,
      longest_streak_in_cycle = case when v_complete
        then greatest(gcs.longest_streak_in_cycle, gcs.current_streak + 1)
        else gcs.longest_streak_in_cycle end
  from public.group_cycles gc
  where gcs.cycle_id = gc.id
    and gcs.user_id = p_user_id
    and gc.ended_at is null;

  -- Leaderboard. Both counters move together here, which is why the
  -- total_completions <= total_possible invariant can never be transiently
  -- violated: every active goal adds 1 to possible, and adds 1 to completions
  -- only if it was checked in.
  insert into public.group_member_category_stats
    (group_id, user_id, category_id, total_completions, total_possible)
  select gm.group_id,
         p_user_id,
         g.category_id,
         count(*) filter (where pe.id is not null),
         count(*)
  from public.goals g
  join public.group_members gm on gm.user_id = p_user_id
  left join public.progress_entries pe
    on pe.goal_id = g.id and pe.check_in_date = p_date
  where g.user_id = p_user_id
    and g.achieved_at is null
    and g.archived_at is null
  group by gm.group_id, g.category_id
  on conflict (group_id, user_id, category_id) do update
    set total_completions = public.group_member_category_stats.total_completions
                            + excluded.total_completions,
        total_possible    = public.group_member_category_stats.total_possible
                            + excluded.total_possible;
end;
$$;

-- Group streak: holds only if EVERY current member completed everything.
-- Members flagged streak_grace are excluded entirely — they neither break nor
-- extend it (section 21).
create function private.rollover_group_day(p_cycle_id uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid;
  v_all boolean;
begin
  select gc.group_id into v_group from public.group_cycles gc where gc.id = p_cycle_id;

  select bool_and(coalesce(dc.all_completed, false)) into v_all
  from public.group_members gm
  left join public.daily_completion dc
    on dc.user_id = gm.user_id and dc.date = p_date
  where gm.group_id = v_group
    and not gm.streak_grace;

  -- A circle where every member is in grace has nothing to evaluate.
  v_all := coalesce(v_all, false);

  insert into public.group_daily_completion (cycle_id, date, all_members_completed)
  values (p_cycle_id, p_date, v_all)
  on conflict (cycle_id, date) do update set all_members_completed = excluded.all_members_completed;

  update public.group_cycles
  set current_streak = case when v_all then current_streak + 1 else 0 end,
      longest_streak = case when v_all then greatest(longest_streak, current_streak + 1)
                            else longest_streak end
  where id = p_cycle_id;
end;
$$;

-- The scheduled entry point. Idempotent: re-running for the same date recomputes
-- daily_completion and group_daily_completion identically, though streak counters
-- are incremental and must not be double-run for the same day.
create function public.run_daily_rollover(p_date date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select u.id as user_id,
           coalesce(p_date, private.checkin_date_for(u.id) - 1) as d
    from public.users u
  loop
    perform private.rollover_user_day(r.user_id, r.d);
  end loop;

  for r in
    select gc.id as cycle_id,
           coalesce(p_date, (current_date - 1)) as d
    from public.group_cycles gc
    where gc.ended_at is null
  loop
    perform private.rollover_group_day(r.cycle_id, r.d);
  end loop;

  -- Section 7: the deadline date is the last playable day, so a circle locks at
  -- the rollover AFTER it. Comparing the deadline's own date to the day just
  -- finalized gives exactly that.
  update public.groups g
  set group_status = 'locked'
  from public.group_cycles gc
  where gc.group_id = g.id
    and gc.ended_at is null
    and gc.deadline is not null
    and g.group_status = 'active'
    and gc.deadline::date <= coalesce(p_date, current_date - 1);
end;
$$;

-- Scheduled work only. Never callable by a client: a user who could invoke this
-- could advance their own streak counters.
revoke execute on function public.run_daily_rollover(date) from anon, authenticated, public;
revoke execute on function private.rollover_user_day(uuid, date) from public;
revoke execute on function private.rollover_group_day(uuid, date) from public;;
