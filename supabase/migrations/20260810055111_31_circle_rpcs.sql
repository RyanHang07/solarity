-- Solarity step 5: multi-table operations as SECURITY DEFINER RPCs.
--
-- CRITICAL POSTURE NOTE: unlike the private.* policy helpers, these live in
-- `public` and ARE intentional API surface, reachable at /rest/v1/rpc/<name>.
-- SECURITY DEFINER means RLS is NOT applied inside them, so each function must
-- perform its own permission check in its own body. A function that forgets is
-- a function anyone can call.

-- ---------------------------------------------------------------------------
-- create_circle — group + owner membership + first cycle, atomically
-- ---------------------------------------------------------------------------
create function public.create_circle(p_name text, p_deadline timestamptz default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_group_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- A function body is a single transaction, which is the whole point: three
  -- separate client calls could fail between steps and leave a circle with no
  -- owner that nobody can see or clean up.
  insert into public.groups (name) values (p_name) returning id into v_group_id;

  insert into public.group_members (group_id, user_id, role)
  values (v_group_id, v_uid, 'owner');

  insert into public.group_cycles (group_id, deadline)
  values (v_group_id, p_deadline);

  insert into public.audit_log (actor_user_id, group_id, target_user_id, action_type, metadata)
  values (v_uid, v_group_id, v_uid, 'member_joined', jsonb_build_object('role', 'owner', 'via', 'created'));

  return v_group_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- circle_preview — minimal information for the join confirmation screen
-- ---------------------------------------------------------------------------
-- Name and size only. Member identities are deliberately withheld: a link may
-- have been forwarded to anyone, including a previously kicked member who kept
-- the URL. Returns no rows for an invalid, disabled or expired token.
create function public.circle_preview(p_token text)
returns table (circle_name text, member_count integer, is_full boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select g.name,
         cnt.n::integer,
         cnt.n >= 10
  from public.invite_links il
  join public.groups g on g.id = il.group_id
  cross join lateral (
    select count(*) as n from public.group_members gm where gm.group_id = g.id
  ) cnt
  where il.token = p_token
    and il.enabled
    and (il.expires_at is null or il.expires_at > now());
$$;

-- ---------------------------------------------------------------------------
-- join_circle — token validation, block check, capacity, streak grace
-- ---------------------------------------------------------------------------
create function public.join_circle(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_group_id uuid;
  v_cycle_id uuid;
  v_streak integer;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select il.group_id into v_group_id
  from public.invite_links il
  where il.token = p_token
    and il.enabled
    and (il.expires_at is null or il.expires_at > now());

  if v_group_id is null then
    -- Same message for invalid, disabled and expired: distinguishing them would
    -- let someone probe which tokens exist.
    raise exception 'This invite link is not valid' using errcode = 'invalid_parameter_value';
  end if;

  -- Idempotent: re-opening a link you already used is not an error.
  if exists (select 1 from public.group_members gm
             where gm.group_id = v_group_id and gm.user_id = v_uid) then
    return v_group_id;
  end if;

  -- Section 20: a block prevents joining any circle the blocker administers.
  if exists (
    select 1
    from public.user_blocks b
    join public.group_members gm
      on gm.user_id = b.blocker_user_id and gm.group_id = v_group_id
    where b.blocked_user_id = v_uid
      and gm.role in ('owner', 'admin')
  ) then
    -- Deliberately vague: confirming a block would tell the blocked user
    -- exactly who blocked them.
    raise exception 'This invite link is not valid' using errcode = 'invalid_parameter_value';
  end if;

  -- Capacity re-check at join time (section 9). The trigger enforces this too;
  -- checking here converts a raw constraint error into a usable message. Same
  -- FOR UPDATE lock so concurrent joins serialize.
  perform 1 from public.groups where id = v_group_id for update;

  select count(*) into v_count
  from public.group_members gm where gm.group_id = v_group_id;

  if v_count >= 10 then
    raise exception 'This circle is full' using errcode = 'check_violation';
  end if;

  select gc.id, gc.current_streak into v_cycle_id, v_streak
  from public.group_cycles gc
  where gc.group_id = v_group_id and gc.ended_at is null;

  -- Section 21: joining an active streak flags the member for grace and queues
  -- an owner decision, rather than breaking the streak on day one.
  insert into public.group_members (group_id, user_id, role, streak_grace)
  values (v_group_id, v_uid, 'member', coalesce(v_streak, 0) > 0);

  if coalesce(v_streak, 0) > 0 then
    update public.groups
    set streak_decision_pending = true,
        pending_streak_joiners = pending_streak_joiners || to_jsonb(v_uid::text)
    where id = v_group_id;
  end if;

  if v_cycle_id is not null then
    insert into public.group_cycle_stats (cycle_id, user_id)
    values (v_cycle_id, v_uid)
    on conflict do nothing;
  end if;

  insert into public.audit_log (actor_user_id, group_id, target_user_id, action_type, metadata)
  values (v_uid, v_group_id, v_uid, 'member_joined', jsonb_build_object('via', 'invite_link'));

  return v_group_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- transfer_ownership — ordered demote-then-promote
-- ---------------------------------------------------------------------------
create function public.transfer_ownership(p_group_id uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = v_uid and gm.role = 'owner'
  ) then
    raise exception 'Only the circle owner may transfer ownership'
      using errcode = 'insufficient_privilege';
  end if;

  if p_new_owner = v_uid then
    raise exception 'You already own this circle' using errcode = 'invalid_parameter_value';
  end if;

  if not exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = p_new_owner
  ) then
    raise exception 'That person is not a member of this circle'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Order matters: group_members_one_owner_idx forbids two owners existing even
  -- momentarily, so the outgoing owner must step down first.
  update public.group_members set role = 'member'
  where group_id = p_group_id and user_id = v_uid;

  update public.group_members set role = 'owner'
  where group_id = p_group_id and user_id = p_new_owner;

  insert into public.audit_log (actor_user_id, group_id, target_user_id, action_type)
  values (v_uid, p_group_id, p_new_owner, 'ownership_transferred');
end;
$$;

-- ---------------------------------------------------------------------------
-- cycle_continue — keep history, extend or remove the deadline
-- ---------------------------------------------------------------------------
create function public.cycle_continue(p_group_id uuid, p_new_deadline timestamptz default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_current_deadline timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = v_uid and gm.role in ('owner','admin')
  ) then
    raise exception 'Only an owner or admin may renew a cycle'
      using errcode = 'insufficient_privilege';
  end if;

  select gc.deadline into v_current_deadline
  from public.group_cycles gc
  where gc.group_id = p_group_id and gc.ended_at is null;

  -- Section 7: continuing is always an extension. Pulling a deadline SOONER
  -- reduces the time members have and would require the 2-day notice, so it is
  -- not available through this path.
  if p_new_deadline is not null
     and v_current_deadline is not null
     and p_new_deadline < v_current_deadline then
    raise exception 'Continuing a cycle can only extend or remove the deadline, not bring it forward'
      using errcode = 'invalid_parameter_value';
  end if;

  update public.group_cycles
  set deadline = p_new_deadline
  where group_id = p_group_id and ended_at is null;

  update public.groups set group_status = 'active' where id = p_group_id;

  insert into public.audit_log (actor_user_id, group_id, action_type, metadata)
  values (v_uid, p_group_id, 'group_cycle_extended',
          jsonb_build_object('old_deadline', v_current_deadline, 'new_deadline', p_new_deadline));
end;
$$;

-- ---------------------------------------------------------------------------
-- cycle_reset — close the cycle, open a fresh one
-- ---------------------------------------------------------------------------
create function public.cycle_reset(p_group_id uuid, p_new_deadline timestamptz default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old_cycle uuid;
  v_new_cycle uuid;
  v_persist boolean;
  v_streak integer;
  v_longest integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = v_uid and gm.role in ('owner','admin')
  ) then
    raise exception 'Only an owner or admin may reset a cycle'
      using errcode = 'insufficient_privilege';
  end if;

  select leaderboard_persists_across_cycles into v_persist
  from public.groups where id = p_group_id;

  select gc.id, gc.current_streak, gc.longest_streak
    into v_old_cycle, v_streak, v_longest
  from public.group_cycles gc
  where gc.group_id = p_group_id and gc.ended_at is null;

  if v_old_cycle is null then
    raise exception 'This circle has no active cycle' using errcode = 'invalid_parameter_value';
  end if;

  update public.group_cycles set ended_at = now() where id = v_old_cycle;

  -- Section 21: when the leaderboard persists across cycles, the group streak
  -- carries forward; otherwise the new cycle starts from zero.
  insert into public.group_cycles (group_id, deadline, current_streak, longest_streak)
  values (
    p_group_id,
    p_new_deadline,
    case when v_persist then coalesce(v_streak, 0) else 0 end,
    case when v_persist then coalesce(v_longest, 0) else 0 end
  )
  returning id into v_new_cycle;

  -- Fresh per-cycle stat rows for everyone currently in the circle.
  insert into public.group_cycle_stats (cycle_id, user_id)
  select v_new_cycle, gm.user_id
  from public.group_members gm
  where gm.group_id = p_group_id
  on conflict do nothing;

  if not v_persist then
    update public.group_member_category_stats
    set total_completions = 0, total_possible = 0,
        current_streak = 0, longest_streak = 0
    where group_id = p_group_id;
  end if;

  update public.groups set group_status = 'active' where id = p_group_id;

  insert into public.audit_log (actor_user_id, group_id, action_type, metadata)
  values (v_uid, p_group_id, 'group_cycle_reset',
          jsonb_build_object('closed_cycle', v_old_cycle, 'new_cycle', v_new_cycle,
                             'leaderboard_persisted', v_persist));

  return v_new_cycle;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: intentional API surface, but authenticated only. The default
-- EXECUTE-to-PUBLIC grant is revoked first, exactly as for the private helpers.
-- ---------------------------------------------------------------------------
revoke execute on function public.create_circle(text, timestamptz) from public;
revoke execute on function public.circle_preview(text) from public;
revoke execute on function public.join_circle(text) from public;
revoke execute on function public.transfer_ownership(uuid, uuid) from public;
revoke execute on function public.cycle_continue(uuid, timestamptz) from public;
revoke execute on function public.cycle_reset(uuid, timestamptz) from public;

grant execute on function public.create_circle(text, timestamptz) to authenticated;
grant execute on function public.circle_preview(text) to authenticated;
grant execute on function public.join_circle(text) to authenticated;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;
grant execute on function public.cycle_continue(uuid, timestamptz) to authenticated;
grant execute on function public.cycle_reset(uuid, timestamptz) to authenticated;;
