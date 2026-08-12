-- Gap closure found by probing step 4e.
--
-- GAP: check-ins were accepted on archived and achieved goals. The 10-active-
-- goal cap only bounds ACTIVE goals, so a user could accumulate unlimited
-- archived goals and check into all of them daily. Section 21 ranks partly on
-- raw total_completions, and total_possible only counts goals that were active
-- and eligible — so the two counters would drift apart until
-- gmcs_completions_within_possible began rejecting legitimate writes.

create function private.owns_active_goal(p_goal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.goals g
    where g.id = p_goal_id
      and g.user_id = (select auth.uid())
      and g.achieved_at is null
      and g.archived_at is null
  );
$$;

grant execute on function private.owns_active_goal(uuid) to authenticated;

comment on function private.owns_active_goal(uuid) is
  'Check-in eligibility. Stricter than owns_goal(): the goal must also be '
  'neither achieved nor archived, so check-ins cannot route around the '
  '10-active-goal cap.';

drop policy progress_entries_insert_today_own on public.progress_entries;

create policy progress_entries_insert_today_own on public.progress_entries
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.owns_active_goal(goal_id)
    and check_in_date = private.current_checkin_date()
  );

-- Data-quality: a goal cannot be finished in the future. total_goals_achieved
-- increments on achieved_at regardless of its value, and the deferred galaxy
-- generates stars at achievement time, so a future timestamp would produce a
-- goal that is simultaneously achieved and not-yet-achieved depending on which
-- code path asks.
alter table public.goals
  add constraint goals_achieved_not_future check (achieved_at is null or achieved_at <= now()),
  add constraint goals_archived_not_future check (archived_at is null or archived_at <= now());

-- goals.deadline is deliberately left unconstrained: a personal deadline is
-- informational, affects only the owner's own view, and recording a missed or
-- historical one is legitimate.;
