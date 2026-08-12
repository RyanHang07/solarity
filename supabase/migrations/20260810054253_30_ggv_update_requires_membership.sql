-- Cross-cutting probe finding: goal_group_visibility INSERT required both goal
-- ownership AND circle membership, but UPDATE required only ownership. An
-- ex-member could therefore still toggle the hidden flag for a circle they had
-- left.
--
-- Inert today (their goals aren't visible there anyway once membership ends),
-- but the stale value would apply if they rejoined, and the asymmetry between
-- INSERT and UPDATE is exactly the kind of inconsistency that becomes a real
-- bug when the pattern gets copied.

drop policy ggv_update_own_goal on public.goal_group_visibility;

create policy ggv_update_own_goal on public.goal_group_visibility
  for update to authenticated
  using (
    private.owns_goal(goal_id)
    and private.is_group_member(group_id)
  )
  with check (
    private.owns_goal(goal_id)
    and private.is_group_member(group_id)
  );

-- DELETE deliberately keeps the looser rule (ownership only): cleaning up a
-- stale row after leaving a circle should always be permitted, and removing a
-- row can only ever reveal less than it hid.;
