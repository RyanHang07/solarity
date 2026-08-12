-- Solarity RLS, step 4c: identity
-- users, user_lifetime_stats
--
-- First step where visibility stops being "mine" and starts depending on
-- shared group membership, an opt-in flag, and blocking.

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
-- Readable by yourself, and by anyone you share a circle with — group rosters,
-- digests and member lists all need to resolve a username and avatar.
--
-- Blocking deliberately does NOT hide the basic user row. Section 20 describes
-- a block as preventing the blocked user from viewing the blocker's
-- "profile/galaxy (overriding the opt-in visibility toggle)", which points at
-- user_lifetime_stats rather than at identity itself. Hiding the users row too
-- would leave a member visible in a roster with no name or avatar to render,
-- which reveals the block rather than concealing it.

create policy users_select_self_or_groupmate on public.users
  for select to authenticated
  using (
    id = (select auth.uid())
    or private.shares_group_with(id)
  );

create policy users_update_self on public.users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

grant select on public.users to authenticated;

-- Deliberately NOT granted:
--   id, created_at, updated_at — immutable or trigger-maintained.
--   username        — changes are rate-limited to once per 14 days, must write
--                     a username_history row, and must pass the profanity
--                     filter. None of that can be enforced by a direct
--                     PostgREST UPDATE, so renames go through a server-side
--                     path under service_role.
--   checkin_timezone / checkin_day_started_at — frozen at each 2 AM rollover by
--                     server logic precisely so a client cannot move the day
--                     boundary at will (section 3, timezone travel).
grant update (first_name, last_name, avatar_url) on public.users to authenticated;

-- No INSERT: rows are created solely by handle_new_user() off auth.users.
-- No DELETE: account deletion is the Edge Function cascade in section 16, which
-- has to anonymize progress_entries rather than simply removing the user.

-- ---------------------------------------------------------------------------
-- user_lifetime_stats
-- ---------------------------------------------------------------------------
-- Own row always. Someone else's only when all three hold: you share a circle,
-- they opted in, and they have not blocked you. The block check is what section
-- 20 means by "overriding the opt-in visibility toggle" — a block beats a
-- public setting.

create policy user_lifetime_stats_select_visible on public.user_lifetime_stats
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      visible_on_profile
      and private.shares_group_with(user_id)
      and not private.is_blocked_by(user_id)
    )
  );

create policy user_lifetime_stats_update_own on public.user_lifetime_stats
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select on public.user_lifetime_stats to authenticated;

-- Only the opt-in toggle. Every counter is derived from daily_completion and
-- must never be client-writable — a user who could set longest_streak_ever
-- could fabricate their entire standing.
grant update (visible_on_profile) on public.user_lifetime_stats to authenticated;

-- No INSERT (created alongside the user by handle_new_user), no DELETE
-- (cascades with the user).;
