-- Solarity RLS, step 4e: goals and check-ins
-- goals, progress_entries, daily_completion, goal_group_visibility
--
-- Where the shared-circle visibility rule lands.

-- ---------------------------------------------------------------------------
-- goals
-- ---------------------------------------------------------------------------
-- Hidden goals are STILL readable here, deliberately. Section 4: RLS allows the
-- row through because aggregate completion counts depend on it; the API layer
-- masks title/note/photo for viewers who shouldn't see the detail. Hiding is a
-- display rule, not an access rule — the accountability math must still count
-- the goal.

create policy goals_select_own_or_groupmate on public.goals
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.shares_group_with(user_id)
  );

create policy goals_insert_own on public.goals
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy goals_update_own on public.goals
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select on public.goals to authenticated;

-- A goal cannot be created already-achieved or already-archived.
grant insert (user_id, title, category_id, deadline) on public.goals to authenticated;

-- user_id is omitted: goals are never transferable between users.
grant update (title, category_id, deadline, achieved_at, archived_at)
  on public.goals to authenticated;

-- No DELETE. archived_at is the intended retirement path (section 3): it keeps
-- the goal's check-in history intact and countable in historical stats, where a
-- delete would strand progress_entries with a null goal_id.

-- ---------------------------------------------------------------------------
-- progress_entries
-- ---------------------------------------------------------------------------

create policy progress_entries_select_own_or_groupmate on public.progress_entries
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.shares_group_with(user_id)
  );

-- The date is pinned server-side. Without this a client could POST a check-in
-- dated months ago and manufacture an unbroken streak.
create policy progress_entries_insert_today_own on public.progress_entries
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.owns_goal(goal_id)
    and check_in_date = private.current_checkin_date()
  );

create policy progress_entries_update_own on public.progress_entries
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Undoing an accidental check-in is legitimate, and can only ever hurt the
-- user's own streak. The unique constraint on (goal_id, check_in_date) plus the
-- pinned insert date mean delete-and-reinsert gains nothing.
create policy progress_entries_delete_own on public.progress_entries
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, delete on public.progress_entries to authenticated;
grant insert (goal_id, user_id, check_in_date, note, photo_url)
  on public.progress_entries to authenticated;

-- check_in_date is NOT updatable: allowing it would reopen the backdating hole
-- that the insert policy just closed. goal_id and user_id are likewise fixed.
grant update (note, photo_url) on public.progress_entries to authenticated;

-- ---------------------------------------------------------------------------
-- daily_completion — derived, read-only to clients
-- ---------------------------------------------------------------------------
-- Same visibility rule as progress_entries: completion status surfaces in
-- group-facing UI (digest, member lists), so circle-mates can read it.

create policy daily_completion_select_own_or_groupmate on public.daily_completion
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.shares_group_with(user_id)
  );

grant select on public.daily_completion to authenticated;

-- No write access of any kind: written solely by the post-check-in trigger and
-- the 2 AM rollover job under service_role. This is the table the entire streak
-- system is built on.

-- ---------------------------------------------------------------------------
-- goal_group_visibility
-- ---------------------------------------------------------------------------
-- Circle members need to READ this to know a goal should render as "hidden".
-- Only the goal's owner may write it, and only for circles they belong to.

create policy ggv_select_owner_or_member on public.goal_group_visibility
  for select to authenticated
  using (
    private.owns_goal(goal_id)
    or private.is_group_member(group_id)
  );

create policy ggv_insert_own_goal on public.goal_group_visibility
  for insert to authenticated
  with check (
    private.owns_goal(goal_id)
    and private.is_group_member(group_id)
  );

create policy ggv_update_own_goal on public.goal_group_visibility
  for update to authenticated
  using (private.owns_goal(goal_id))
  with check (private.owns_goal(goal_id));

create policy ggv_delete_own_goal on public.goal_group_visibility
  for delete to authenticated
  using (private.owns_goal(goal_id));

grant select, delete on public.goal_group_visibility to authenticated;
grant insert (goal_id, group_id, hidden) on public.goal_group_visibility to authenticated;
grant update (hidden) on public.goal_group_visibility to authenticated;;
