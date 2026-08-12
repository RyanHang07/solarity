-- Solarity RLS, step 4b: self-owned tables
-- notifications, push_subscriptions, user_blocks, username_history
--
-- Every rule here is a variant of "the row is mine". Grants are paired with
-- policies in the same migration so the two cannot drift, and INSERT/UPDATE
-- grants are column-scoped wherever a table has fields a client has no business
-- setting: a column that was never granted cannot be targeted at all, which is
-- a stronger guarantee than a WITH CHECK expression someone has to write
-- correctly.

-- ---------------------------------------------------------------------------
-- notifications — read your own, mark them read, nothing else
-- ---------------------------------------------------------------------------
-- No INSERT policy or grant by design: notifications are written exclusively by
-- triggers and the digest job under service_role. A client that could insert
-- could forge a "you were kicked" notification for itself, or for the feed to
-- disagree with what actually happened.

create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select on public.notifications to authenticated;

-- Only read_at. type and payload are an immutable record of what happened
-- (section 3), and user_id cannot be reassigned because it was never granted.
grant update (read_at) on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- push_subscriptions — full self-management, since devices come and go
-- ---------------------------------------------------------------------------

create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy push_subscriptions_update_own on public.push_subscriptions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, delete on public.push_subscriptions to authenticated;

-- id and created_at are omitted: both have defaults and neither should be
-- client-supplied.
grant insert (user_id, endpoint, p256dh, auth, device_label)
  on public.push_subscriptions to authenticated;

-- Renaming a device is the only sensible edit. Rotating keys means a new
-- subscription, which is an insert.
grant update (device_label) on public.push_subscriptions to authenticated;

-- Hardening: reject obviously invalid endpoints at write time. Web Push
-- endpoints are always absolute HTTPS URLs.
alter table public.push_subscriptions
  add constraint push_subscriptions_endpoint_is_https
  check (endpoint ~ '^https://');

-- ---------------------------------------------------------------------------
-- user_blocks — visible only to the blocker
-- ---------------------------------------------------------------------------
-- Section 4: the blocked user gets no read access. Being able to query whether
-- you have been blocked turns a quiet safety tool into a notification, which is
-- the opposite of what it is for. Blocking's effects are enforced server-side
-- in the queries that matter, never by letting the blocked party inspect this
-- table.

create policy user_blocks_select_own on public.user_blocks
  for select to authenticated
  using (blocker_user_id = (select auth.uid()));

create policy user_blocks_insert_own on public.user_blocks
  for insert to authenticated
  with check (blocker_user_id = (select auth.uid()));

create policy user_blocks_delete_own on public.user_blocks
  for delete to authenticated
  using (blocker_user_id = (select auth.uid()));

grant select, delete on public.user_blocks to authenticated;
grant insert (blocker_user_id, blocked_user_id) on public.user_blocks to authenticated;

-- No UPDATE policy or grant: a block has nothing editable. Changing your mind
-- is a DELETE, and re-blocking is an INSERT, which keeps created_at honest.

-- ---------------------------------------------------------------------------
-- username_history — deliberately no policy and no grant
-- ---------------------------------------------------------------------------
-- Section 4 specifies no client read policy at all. It is a support and
-- moderation trail, never surfaced in the UI, written and read only under
-- service_role. Leaving it with RLS enabled and zero policies is the intended
-- end state, not an oversight: the linter will keep reporting
-- rls_enabled_no_policy for this table permanently and that report is correct.

comment on table public.username_history is
  'No client access by design. RLS enabled with zero policies is the intended '
  'end state; service_role only. The rls_enabled_no_policy linter notice for '
  'this table is expected and should not be "fixed".';;
