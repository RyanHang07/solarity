-- Probe finding: invite links ignored the circle's lifecycle entirely.
--
--   A. An archived circle still previewed via an old link.
--   B. Joining an archived, EMPTY circle succeeded and produced a circle with a
--      member but no owner — the same unrecoverable state fixed in migration 38,
--      reached from the opposite direction. The succession trigger guards
--      departures; nothing guarded arrivals.
--   C. A locked circle (deadline passed) accepted new members, even though
--      check-ins are blocked in that state, so the joiner could do nothing.
--
-- Both entry points now require group_status = 'active'. join_circle
-- additionally refuses a circle with no owner as a belt-and-braces check: that
-- state should be unreachable now, but it is the one state with no way to
-- recover, so it is worth failing loudly rather than trusting an invariant.

create or replace function public.circle_preview(p_token text)
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
    and (il.expires_at is null or il.expires_at > now())
    and g.group_status = 'active';
$$;

create or replace function public.join_circle(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_group_id uuid;
  v_status public.group_status;
  v_cycle_id uuid;
  v_streak integer;
  v_count integer;
  v_owners integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select il.group_id, g.group_status
    into v_group_id, v_status
  from public.invite_links il
  join public.groups g on g.id = il.group_id
  where il.token = p_token
    and il.enabled
    and (il.expires_at is null or il.expires_at > now());

  -- Same message for invalid, disabled, expired, locked, archived and blocked:
  -- distinguishing them lets someone probe which tokens exist, and naming a
  -- block tells the blocked user exactly who blocked them.
  if v_group_id is null or v_status <> 'active' then
    raise exception 'This invite link is not valid' using errcode = 'invalid_parameter_value';
  end if;

  if exists (select 1 from public.group_members gm
             where gm.group_id = v_group_id and gm.user_id = v_uid) then
    return v_group_id;
  end if;

  if exists (
    select 1
    from public.user_blocks b
    join public.group_members gm
      on gm.user_id = b.blocker_user_id and gm.group_id = v_group_id
    where b.blocked_user_id = v_uid
      and gm.role in ('owner', 'admin')
  ) then
    raise exception 'This invite link is not valid' using errcode = 'invalid_parameter_value';
  end if;

  perform 1 from public.groups where id = v_group_id for update;

  select count(*) into v_count
  from public.group_members gm where gm.group_id = v_group_id;

  if v_count >= 10 then
    raise exception 'This circle is full' using errcode = 'check_violation';
  end if;

  -- Defensive: never let someone join a circle that has no owner. Unreachable
  -- given the status check above plus the succession trigger, but an ownerless
  -- circle is the one state with no recovery path, so fail loudly.
  select count(*) into v_owners
  from public.group_members gm
  where gm.group_id = v_group_id and gm.role = 'owner';

  if v_owners = 0 then
    raise exception 'This invite link is not valid' using errcode = 'invalid_parameter_value';
  end if;

  select gc.id, gc.current_streak into v_cycle_id, v_streak
  from public.group_cycles gc
  where gc.group_id = v_group_id and gc.ended_at is null;

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

-- Disable outstanding links whenever a circle leaves the active state, so a
-- forwarded URL cannot sit waiting for the circle to be renewed later.
create function public.trg_disable_links_on_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.group_status <> 'active' and old.group_status = 'active' then
    update public.invite_links set enabled = false
    where group_id = new.id and enabled;
  end if;
  return new;
end;
$$;

revoke execute on function public.trg_disable_links_on_status_change()
  from anon, authenticated, public;

create trigger groups_disable_links_on_status_change
  after update of group_status on public.groups
  for each row execute function public.trg_disable_links_on_status_change();;
