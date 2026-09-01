-- Step 19. One switch per kind of interruption.
--
-- **Per type, not one master switch**, and the reason is what happens without
-- it. The only control today is per device, all or nothing, and it also governs
-- the digest. Somebody who finds intraday activity noisy would have to turn off
-- the one notification they actually wanted to keep, so the app would be
-- teaching people to disable it entirely.
--
-- **Columns rather than a jsonb bag**, matching `push_shows_circle_name` and
-- `today_screen_mode`. A column is greppable, typed, defaultable and shows up
-- in `database.types.ts`; a bag of keys is none of those and drifts silently.
--
-- **Default true, and that is a real decision.** Off by default means a feature
-- nobody discovers; the mitigation for noise is the ceilings built into each
-- type in migration 103, not a switch people never find.
alter table public.users
  add column if not exists notify_goal_achieved   boolean not null default true,
  add column if not exists notify_first_finisher  boolean not null default true,
  add column if not exists notify_last_one_left   boolean not null default true,
  add column if not exists notify_circle_activity boolean not null default true;

-- Column-level, exactly like every other user-editable preference. `role` and
-- `username` are absent from this list on purpose: the first is site admin and
-- the second has its own RPC with a rename cooldown.
grant select (
  notify_goal_achieved,
  notify_first_finisher,
  notify_last_one_left,
  notify_circle_activity
) on public.users to authenticated;

grant update (
  notify_goal_achieved,
  notify_first_finisher,
  notify_last_one_left,
  notify_circle_activity
) on public.users to authenticated;
