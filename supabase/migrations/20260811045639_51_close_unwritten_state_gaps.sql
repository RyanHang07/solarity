-- Audit finding: several declared states had a setter but no resolver, and
-- several notification/audit types had no writer at all. Each is a feature that
-- silently does nothing rather than an error anyone would notice.

-- ---------------------------------------------------------------------------
-- A. Streak decision — the worst of them.
-- ---------------------------------------------------------------------------
-- join_circle sets group_members.streak_grace and groups.streak_decision_pending,
-- and NOTHING ever cleared either. A member flagged on join was excluded from
-- group_daily_completion evaluation permanently, so the group streak quietly
-- ignored them forever. Section 13 describes an owner continue/reset choice;
-- this implements it.

create function public.resolve_streak_decision(p_group_id uuid, p_continue boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cycle uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- Owner-only: it's a judgment call about the Circle's standards, not routine
  -- admin work (section 13).
  if not exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = v_uid and gm.role = 'owner'
  ) then
    raise exception 'Only the circle owner can decide this'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.groups g
    where g.id = p_group_id and g.streak_decision_pending
  ) then
    raise exception 'There is no pending streak decision for this circle'
      using errcode = 'invalid_parameter_value';
  end if;

  select gc.id into v_cycle
  from public.group_cycles gc
  where gc.group_id = p_group_id and gc.ended_at is null;

  if not p_continue and v_cycle is not null then
    update public.group_cycles set current_streak = 0 where id = v_cycle;
  end if;

  -- Either way grace ends: the joiners are counted from here on.
  update public.group_members
  set streak_grace = false
  where group_id = p_group_id and streak_grace;

  update public.groups
  set streak_decision_pending = false,
      pending_streak_joiners = '[]'::jsonb
  where id = p_group_id;

  insert into public.audit_log (actor_user_id, group_id, action_type)
  values (v_uid, p_group_id,
          case when p_continue then 'group_streak_continued'
               else 'group_streak_reset' end::public.audit_action_type);
end;
$$;

revoke execute on function public.resolve_streak_decision(uuid, boolean) from public;
grant execute on function public.resolve_streak_decision(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- B. Kicked members were never notified.
-- ---------------------------------------------------------------------------
-- Section 10 says a kicked member receives an immediate notification. The
-- removal trigger audited the kick but told nobody.

create or replace function public.handle_membership_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_actor uuid;
  v_target uuid;
  v_account_deleted boolean;
  v_self boolean;
  v_action public.audit_action_type;
  v_successor uuid;
  v_group_name text;
begin
  select id into v_actor  from public.users where id = v_uid;
  select id into v_target from public.users where id = old.user_id;

  v_account_deleted := (v_target is null);
  v_self := (v_uid is not null and v_uid = old.user_id);

  v_action := case
    when v_account_deleted then 'member_left'
    when v_self           then 'member_left'
    else                       'member_kicked'
  end;

  insert into public.audit_log (actor_user_id, group_id, target_user_id, action_type, metadata)
  values (
    case when v_account_deleted then null else v_actor end,
    old.group_id, v_target, v_action,
    jsonb_build_object(
      'role_at_removal', old.role,
      'via', case when v_account_deleted then 'account_deletion'
                  when v_self then 'left' else 'kicked' end
    )
  );

  if v_action = 'member_kicked' then
    update public.group_member_category_stats
    set total_completions = 0, total_possible = 0,
        current_streak = 0, longest_streak = 0
    where group_id = old.group_id and user_id = old.user_id;

    -- Tell them. Circle name is denormalized into the payload, per the
    -- immutable-snapshot rule for notifications.
    select name into v_group_name from public.groups where id = old.group_id;
    insert into public.notifications (user_id, type, payload)
    values (old.user_id, 'kicked',
            jsonb_build_object('group_id', old.group_id, 'circle_name', v_group_name));
  end if;

  if old.role = 'owner' then
    select gm.user_id into v_successor
    from public.group_members gm
    where gm.group_id = old.group_id
    order by gm.joined_at asc
    limit 1;

    if v_successor is not null then
      update public.group_members set role = 'owner'
      where group_id = old.group_id and user_id = v_successor;

      insert into public.audit_log (actor_user_id, group_id, target_user_id, action_type, metadata)
      values (null, old.group_id, v_successor, 'ownership_transferred',
              jsonb_build_object('reason', 'owner_departed', 'automatic', true));
    else
      update public.groups set group_status = 'archived' where id = old.group_id;
    end if;
  end if;

  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- C. Role changes and invite-link toggles were unaudited.
-- ---------------------------------------------------------------------------
-- Both happen through a direct UPDATE, so no RPC could record them, and
-- admin_promoted / admin_demoted / invite_link_toggled had no writer at all.

create function public.trg_audit_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role then
    insert into public.audit_log (actor_user_id, group_id, target_user_id, action_type, metadata)
    values (
      (select auth.uid()), new.group_id, new.user_id,
      case when new.role = 'admin' then 'admin_promoted'
           when old.role = 'admin' and new.role = 'member' then 'admin_demoted'
           else 'ownership_transferred' end::public.audit_action_type,
      jsonb_build_object('from', old.role, 'to', new.role)
    );
  end if;
  return new;
end;
$$;

revoke execute on function public.trg_audit_role_change() from anon, authenticated, public;

create trigger group_members_audit_role_change
  after update of role on public.group_members
  for each row execute function public.trg_audit_role_change();

create function public.trg_audit_invite_toggle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only a deliberate toggle. Regeneration also disables the old row, but
  -- create_invite_link already audits that as invite_link_regenerated, and
  -- double-logging one action would make the trail misleading.
  if new.enabled is distinct from old.enabled and (select auth.uid()) is not null then
    insert into public.audit_log (actor_user_id, group_id, action_type, metadata)
    values ((select auth.uid()), new.group_id, 'invite_link_toggled',
            jsonb_build_object('enabled', new.enabled));
  end if;
  return new;
end;
$$;

revoke execute on function public.trg_audit_invite_toggle() from anon, authenticated, public;

create trigger invite_links_audit_toggle
  after update of enabled on public.invite_links
  for each row execute function public.trg_audit_invite_toggle();

-- ---------------------------------------------------------------------------
-- D. Joining notified nobody.
-- ---------------------------------------------------------------------------
create or replace function public.join_circle(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_link record;
  v_cycle_id uuid;
  v_streak integer;
  v_count integer;
  v_owners integer;
  v_username text;
begin
  if v_uid is null then
    raise exception 'You need to be signed in to join a circle.'
      using errcode = 'insufficient_privilege', hint = 'NOT_AUTHENTICATED';
  end if;

  select il.group_id, il.enabled, il.expires_at, g.group_status, g.name
    into v_link
  from public.invite_links il
  join public.groups g on g.id = il.group_id
  where il.token = p_token;

  if v_link is null then
    raise exception 'This invite link isn''t valid. Ask whoever invited you for a new one.'
      using errcode = 'invalid_parameter_value', hint = 'INVITE_INVALID';
  end if;

  if exists (select 1 from public.group_members gm
             where gm.group_id = v_link.group_id and gm.user_id = v_uid) then
    return v_link.group_id;
  end if;

  if not v_link.enabled then
    raise exception 'This invite link was turned off. Ask for a new one.'
      using errcode = 'invalid_parameter_value', hint = 'INVITE_REVOKED';
  end if;

  if v_link.expires_at is not null and v_link.expires_at <= now() then
    raise exception 'This invite link has expired. Ask for a new one.'
      using errcode = 'invalid_parameter_value', hint = 'INVITE_EXPIRED';
  end if;

  if v_link.group_status = 'locked' then
    raise exception '% has finished its current cycle and isn''t taking new members right now.', v_link.name
      using errcode = 'invalid_parameter_value', hint = 'CIRCLE_LOCKED';
  end if;

  if v_link.group_status = 'archived' then
    raise exception '% is no longer active.', v_link.name
      using errcode = 'invalid_parameter_value', hint = 'CIRCLE_ARCHIVED';
  end if;

  if exists (
    select 1 from public.user_blocks b
    join public.group_members gm
      on gm.user_id = b.blocker_user_id and gm.group_id = v_link.group_id
    where b.blocked_user_id = v_uid and gm.role in ('owner','admin')
  ) then
    raise exception 'This invite link isn''t valid. Ask whoever invited you for a new one.'
      using errcode = 'invalid_parameter_value', hint = 'INVITE_INVALID';
  end if;

  perform 1 from public.groups where id = v_link.group_id for update;

  select count(*) into v_count from public.group_members gm where gm.group_id = v_link.group_id;
  if v_count >= 10 then
    raise exception '% is full (10 members).', v_link.name
      using errcode = 'check_violation', hint = 'CIRCLE_FULL';
  end if;

  select count(*) into v_owners from public.group_members gm
  where gm.group_id = v_link.group_id and gm.role = 'owner';
  if v_owners = 0 then
    raise exception 'This circle is no longer available.'
      using errcode = 'invalid_parameter_value', hint = 'CIRCLE_ORPHANED';
  end if;

  select gc.id, gc.current_streak into v_cycle_id, v_streak
  from public.group_cycles gc
  where gc.group_id = v_link.group_id and gc.ended_at is null;

  insert into public.group_members (group_id, user_id, role, streak_grace)
  values (v_link.group_id, v_uid, 'member', coalesce(v_streak, 0) > 0);

  if coalesce(v_streak, 0) > 0 then
    update public.groups
    set streak_decision_pending = true,
        pending_streak_joiners = pending_streak_joiners || to_jsonb(v_uid::text)
    where id = v_link.group_id;
  end if;

  if v_cycle_id is not null then
    insert into public.group_cycle_stats (cycle_id, user_id)
    values (v_cycle_id, v_uid) on conflict do nothing;
  end if;

  insert into public.audit_log (actor_user_id, group_id, target_user_id, action_type, metadata)
  values (v_uid, v_link.group_id, v_uid, 'member_joined', jsonb_build_object('via', 'invite_link'));

  -- Tell the existing members someone arrived.
  select username into v_username from public.users where id = v_uid;
  insert into public.notifications (user_id, type, payload)
  select gm.user_id, 'invite_accepted',
         jsonb_build_object('group_id', v_link.group_id,
                            'circle_name', v_link.name,
                            'joined_username', v_username)
  from public.group_members gm
  where gm.group_id = v_link.group_id and gm.user_id <> v_uid;

  return v_link.group_id;
end;
$$;

revoke execute on function public.join_circle(text) from public;
grant execute on function public.join_circle(text) to authenticated;;
