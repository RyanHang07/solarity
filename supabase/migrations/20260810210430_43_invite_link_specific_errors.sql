-- Invite links are the main way people bring each other into the product, so a
-- single catch-all "not valid" made the most social moment in the app the most
-- confusing one. Failures are now distinguished — with two deliberate exceptions.
--
-- WHAT STAYS GENERIC, AND WHY
--   * A token that does not exist. Distinguishing "no such token" from any other
--     outcome turns the endpoint into an oracle for guessing tokens.
--   * A blocked user. Saying "you have been blocked" confirms the block and
--     points at whoever administers the circle. Section 20 is explicit that the
--     blocked user learns nothing, so this returns the same message as a
--     nonexistent token.
--
-- Everything else is safe to name: the caller demonstrably HELD a real token, so
-- telling them it expired, was turned off, or that the circle is full or closed
-- reveals nothing they could not already infer.
--
-- Each error carries a stable machine code in HINT alongside the human message,
-- so the client can branch on the code instead of matching on prose.

-- circle_preview now reports a status, so the join screen can explain the
-- situation BEFORE the user taps anything.
drop function if exists public.circle_preview(text);

create function public.circle_preview(p_token text)
returns table (
  status text,
  circle_name text,
  member_count integer,
  is_full boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_link record;
  v_count integer;
begin
  select il.enabled, il.expires_at, g.name, g.group_status, g.id as group_id
    into v_link
  from public.invite_links il
  join public.groups g on g.id = il.group_id
  where il.token = p_token;

  -- Unknown token: reveal nothing at all, not even that a circle exists.
  if v_link is null then
    return query select 'not_found'::text, null::text, null::integer, null::boolean;
    return;
  end if;

  select count(*) into v_count
  from public.group_members gm where gm.group_id = v_link.group_id;

  if not v_link.enabled then
    return query select 'revoked'::text, v_link.name, v_count, v_count >= 10;
  elsif v_link.expires_at is not null and v_link.expires_at <= now() then
    return query select 'expired'::text, v_link.name, v_count, v_count >= 10;
  elsif v_link.group_status = 'locked' then
    return query select 'circle_locked'::text, v_link.name, v_count, v_count >= 10;
  elsif v_link.group_status = 'archived' then
    return query select 'circle_archived'::text, v_link.name, v_count, v_count >= 10;
  elsif v_count >= 10 then
    return query select 'circle_full'::text, v_link.name, v_count, true;
  else
    return query select 'ok'::text, v_link.name, v_count, false;
  end if;
end;
$$;

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

  -- Generic on purpose: naming this case would allow token enumeration.
  if v_link is null then
    raise exception 'This invite link isn''t valid. Ask whoever invited you for a new one.'
      using errcode = 'invalid_parameter_value', hint = 'INVITE_INVALID';
  end if;

  -- Idempotent, and checked before any refusal: someone re-opening a link they
  -- already used should land in the circle, not hit an error.
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

  -- Generic on purpose: a specific message would confirm the block and point at
  -- whoever administers the circle (section 20).
  if exists (
    select 1
    from public.user_blocks b
    join public.group_members gm
      on gm.user_id = b.blocker_user_id and gm.group_id = v_link.group_id
    where b.blocked_user_id = v_uid
      and gm.role in ('owner', 'admin')
  ) then
    raise exception 'This invite link isn''t valid. Ask whoever invited you for a new one.'
      using errcode = 'invalid_parameter_value', hint = 'INVITE_INVALID';
  end if;

  perform 1 from public.groups where id = v_link.group_id for update;

  select count(*) into v_count
  from public.group_members gm where gm.group_id = v_link.group_id;

  if v_count >= 10 then
    raise exception '% is full (10 members).', v_link.name
      using errcode = 'check_violation', hint = 'CIRCLE_FULL';
  end if;

  select count(*) into v_owners
  from public.group_members gm
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
    values (v_cycle_id, v_uid)
    on conflict do nothing;
  end if;

  insert into public.audit_log (actor_user_id, group_id, target_user_id, action_type, metadata)
  values (v_uid, v_link.group_id, v_uid, 'member_joined', jsonb_build_object('via', 'invite_link'));

  return v_link.group_id;
end;
$$;

revoke execute on function public.circle_preview(text) from public;
grant execute on function public.circle_preview(text) to authenticated;;
