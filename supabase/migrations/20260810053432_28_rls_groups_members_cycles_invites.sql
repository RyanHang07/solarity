-- Solarity RLS, step 4f: circles, membership, cycles, invites
--
-- Four operations are deliberately NOT exposed as direct table writes because
-- each spans multiple tables and cannot be made safe by a policy alone:
--   create circle      (group + owner membership + first cycle, atomically)
--   join via invite    (RLS cannot see the token; needs capacity + block checks)
--   transfer ownership (ordered demote-then-promote under the one-owner index)
--   cycle continue/reset (close one cycle, open another, zero stats)
-- These become server-side operations; see section 4 notes.

-- ---------------------------------------------------------------------------
-- groups
-- ---------------------------------------------------------------------------

create policy groups_select_member on public.groups
  for select to authenticated
  using (private.is_group_member(id));

create policy groups_update_admin on public.groups
  for update to authenticated
  using (private.is_group_admin(id))
  with check (private.is_group_admin(id));

grant select on public.groups to authenticated;

-- Owner-only columns are guarded by trigger, not by grant, because grants
-- cannot distinguish owner from admin.
grant update (name, leaderboard_persists_across_cycles, default_stats_view)
  on public.groups to authenticated;

-- group_status, streak_decision_pending and pending_streak_joiners are
-- server-managed lifecycle state (sections 7 and 21), never client-writable.
-- No INSERT (creation is atomic, server-side). No DELETE (archival is the
-- retirement path, and deleting would cascade away every member's history).

-- ---------------------------------------------------------------------------
-- group_members
-- ---------------------------------------------------------------------------

create policy group_members_select_circlemate on public.group_members
  for select to authenticated
  using (private.is_group_member(group_id));

-- Promotion and demotion are owner-only (section 9). An admin promoted by the
-- owner cannot promote others, nor demote the person who promoted them.
-- The owner's own row is excluded as a target: the only way it changes is the
-- transfer flow, which runs server-side.
create policy group_members_update_role_owner on public.group_members
  for update to authenticated
  using (
    private.is_group_owner(group_id)
    and role <> 'owner'
  )
  with check (
    private.is_group_owner(group_id)
    and role <> 'owner'
  );

-- Covers both leaving and kicking. The owner can never be the target: an owner
-- must transfer before leaving, and no admin may remove them.
create policy group_members_delete_self_or_kick on public.group_members
  for delete to authenticated
  using (
    role <> 'owner'
    and (
      user_id = (select auth.uid())          -- leaving
      or private.is_group_admin(group_id)    -- kicking
    )
  );

grant select, delete on public.group_members to authenticated;

-- Only role. streak_grace is section 21 machinery; joined_at is history.
grant update (role) on public.group_members to authenticated;

-- No INSERT: joining requires token validation, a capacity check and a block
-- check that no policy can perform.

-- ---------------------------------------------------------------------------
-- group_cycles
-- ---------------------------------------------------------------------------

create policy group_cycles_select_member on public.group_cycles
  for select to authenticated
  using (private.is_group_member(group_id));

grant select on public.group_cycles to authenticated;

-- No client writes. Cycles are opened and closed server-side, and
-- current_streak / longest_streak are derived by the 2 AM rollover.

-- ---------------------------------------------------------------------------
-- invite_links
-- ---------------------------------------------------------------------------
-- Admins only, including for SELECT. A plain member has no need to read the
-- raw token, and section 9 scopes link management to owner/admin. Members who
-- want to invite someone ask an admin to share the link.

create policy invite_links_select_admin on public.invite_links
  for select to authenticated
  using (private.is_group_admin(group_id));

create policy invite_links_insert_admin on public.invite_links
  for insert to authenticated
  with check (
    private.is_group_admin(group_id)
    and created_by = (select auth.uid())
  );

create policy invite_links_update_admin on public.invite_links
  for update to authenticated
  using (private.is_group_admin(group_id))
  with check (private.is_group_admin(group_id));

grant select on public.invite_links to authenticated;
grant insert (group_id, token, created_by, expires_at) on public.invite_links to authenticated;

-- Only the on/off switch. Rotating a token means inserting a new row and
-- disabling the old one, which preserves the audit trail (section 3).
grant update (enabled) on public.invite_links to authenticated;

-- No DELETE: revoked and regenerated links are retained deliberately.;
