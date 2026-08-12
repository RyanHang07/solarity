-- Solarity: derived-table population, part 1 — the live layer.
--
-- Only daily_completion and total_goals_achieved update immediately. Streaks
-- and leaderboard counters are computed at the 2 AM rollover (part 2), because
-- a day is not final until it has ended, and because incrementing
-- total_completions on check-in while total_possible only grows at rollover
-- would violate gmcs_completions_within_possible on a user's first day.

-- Resolve the 2 AM check-in date for an ARBITRARY user, not just the caller.
-- Triggers run in contexts where auth.uid() may be null (jobs, service_role),
-- so current_checkin_date() cannot be reused here.
create function private.checkin_date_for(p_user_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (
    (now() at time zone coalesce(
      (select u.checkin_timezone from public.users u where u.id = p_user_id),
      'UTC'
    )) - interval '2 hours'
  )::date;
$$;

-- Recompute whether a user completed ALL their active goals on a given date.
--
-- Note a deliberate limitation: "active goals" is evaluated as of NOW, not as of
-- p_date. That is correct for today (the only date this is called with) but means
-- this must never be used to backfill history — a goal archived since would be
-- excluded from a past day it was actually part of.
create function private.recompute_daily_completion(p_user_id uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active integer;
  v_done integer;
begin
  select count(*) into v_active
  from public.goals g
  where g.user_id = p_user_id
    and g.achieved_at is null
    and g.archived_at is null;

  select count(*) into v_done
  from public.progress_entries pe
  join public.goals g on g.id = pe.goal_id
  where pe.user_id = p_user_id
    and pe.check_in_date = p_date
    and g.achieved_at is null
    and g.archived_at is null;

  -- Section 3: a day with ZERO active goals is false, not vacuously true.
  insert into public.daily_completion (user_id, date, all_completed)
  values (p_user_id, p_date, v_active > 0 and v_done >= v_active)
  on conflict (user_id, date) do update
    set all_completed = excluded.all_completed;
end;
$$;

-- Check-in created or undone -> recompute that user's day.
create function public.trg_progress_entry_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.user_id is not null then
      perform private.recompute_daily_completion(old.user_id, old.check_in_date);
    end if;
    return old;
  else
    perform private.recompute_daily_completion(new.user_id, new.check_in_date);
    return new;
  end if;
end;
$$;

create trigger progress_entries_maintain_completion
  after insert or delete on public.progress_entries
  for each row execute function public.trg_progress_entry_completion();

-- Creating, achieving or archiving a goal changes the denominator, so today's
-- completion has to be re-evaluated even though no check-in occurred.
create function public.trg_goal_completion_recount()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.recompute_daily_completion(
    new.user_id,
    private.checkin_date_for(new.user_id)
  );
  return new;
end;
$$;

create trigger goals_maintain_completion
  after insert or update of achieved_at, archived_at on public.goals
  for each row execute function public.trg_goal_completion_recount();

-- Achieving a goal is a one-time lifetime event, independent of daily tracking.
create function public.trg_goal_achieved_counter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.user_lifetime_stats
  set total_goals_achieved = total_goals_achieved + 1
  where user_id = new.user_id;
  return new;
end;
$$;

create trigger goals_count_achievement
  after update of achieved_at on public.goals
  for each row
  when (old.achieved_at is null and new.achieved_at is not null)
  execute function public.trg_goal_achieved_counter();

revoke execute on function public.trg_progress_entry_completion() from anon, authenticated, public;
revoke execute on function public.trg_goal_completion_recount() from anon, authenticated, public;
revoke execute on function public.trg_goal_achieved_counter() from anon, authenticated, public;
revoke execute on function private.recompute_daily_completion(uuid, date) from public;
revoke execute on function private.checkin_date_for(uuid) from public;;
