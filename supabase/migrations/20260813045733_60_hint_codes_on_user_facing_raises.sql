-- Give every deliberate, user-facing error a machine code in the HINT.
--
-- THE PROBLEM. Three patterns existed for signalling the same kind of failure:
--
--   1. HINT with a machine code  -  join_circle, 9 codes. The right one.
--   2. errcode 22023, message shown verbatim  -  7 RPCs.
--   3. errcode 23514, readable message, no hint  -  the four functions below.
--
-- Pattern 3 is the problem. 23514 is `check_violation`, which is mostly raised
-- by Postgres itself with machine-written text that leaks column and constraint
-- names, so `toMessage` cannot show it. But these four raise 23514 carrying
-- messages written for a person. With no way to tell the two apart, createGoal
-- resorted to matching on message text, which is exactly what keying on
-- SQLSTATE was meant to avoid: rename a constraint and the copy silently
-- changes.
--
-- Step 7 is the deadline because it builds invites and joining, where
-- enforce_group_member_cap and create_invite_link both fire. The hack would
-- have gone from one instance to three in a single step, which is the point a
-- contained ugliness becomes the house style.
--
-- THE RULE, from here on: if a message is written to be read by a person, it
-- carries a HINT. The SQLSTATE stays whatever is semantically correct.
--
-- Note that this changes no logic and no signature. Only the hint is added, so
-- existing callers that ignore it behave identically.

-- ---------------------------------------------------------------------------
-- 1. Active goal cap.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_active_goal_cap()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  active_count integer;
begin
  perform 1 from public.users where id = new.user_id for update;

  select count(*) into active_count
  from public.goals
  where user_id = new.user_id
    and achieved_at is null
    and archived_at is null
    and id <> new.id;   -- exclude self, so UPDATEs are counted correctly

  if active_count >= 10 then
    raise exception 'Active goal limit reached (10 maximum)'
      using errcode = 'check_violation', hint = 'GOAL_LIMIT';
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Circle member cap. Same code join_circle already uses for the same
--    situation, so one branch in the app handles both paths.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_group_member_cap()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  member_count integer;
begin
  -- Serializes concurrent joins to this group. Does not block other groups.
  perform 1 from public.groups where id = new.group_id for update;

  select count(*) into member_count
  from public.group_members
  where group_id = new.group_id;

  if member_count >= 10 then
    raise exception 'Circle is full (10 member maximum)'
      using errcode = 'check_violation', hint = 'CIRCLE_FULL';
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Invite link creation. Three distinct refusals that were indistinguishable
--    to a caller, plus the authentication guard.
-- ---------------------------------------------------------------------------
create or replace function public.create_invite_link(
  p_group_id uuid,
  p_expires_at timestamptz default null,
  p_use_default_expiry boolean default true
)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_token text;
  v_count integer;
  v_status public.group_status;
  v_expires timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated'
      using errcode = 'insufficient_privilege', hint = 'NOT_AUTHENTICATED';
  end if;

  if not exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = v_uid and gm.role in ('owner','admin')
  ) then
    raise exception 'Only an owner or admin may create an invite link'
      using errcode = 'insufficient_privilege', hint = 'NOT_ADMIN';
  end if;

  -- A link for a locked or archived circle could never be used (join_circle
  -- requires 'active'), so refuse to mint one rather than hand back a dud.
  select group_status into v_status from public.groups where id = p_group_id;
  if v_status is distinct from 'active' then
    raise exception 'This circle is not active'
      using errcode = 'invalid_parameter_value', hint = 'CIRCLE_INACTIVE';
  end if;

  select count(*) into v_count from public.group_members gm where gm.group_id = p_group_id;
  if v_count >= 10 then
    raise exception 'This circle is full'
      using errcode = 'check_violation', hint = 'CIRCLE_FULL';
  end if;

  v_expires := case
    when p_expires_at is not null then p_expires_at
    when p_use_default_expiry then now() + interval '7 days'
    else null                       -- explicit opt-out: a permanent link
  end;

  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');

  -- One active link per Circle. Nothing in the schema enforces this: only
  -- `token` is unique, so several enabled rows are physically possible and
  -- permitting them later means deleting this statement.
  --
  -- The UI must warn before calling this. Pressed twice, it invalidates links
  -- people are already holding, and a bare "Generate link" button is a footgun.
  update public.invite_links set enabled = false
  where group_id = p_group_id and enabled;

  insert into public.invite_links (group_id, token, created_by, expires_at)
  values (p_group_id, v_token, v_uid, v_expires);

  insert into public.audit_log (actor_user_id, group_id, action_type, metadata)
  values (v_uid, p_group_id, 'invite_link_regenerated',
          jsonb_build_object('expires_at', v_expires));

  return v_token;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Progress entry ownership. The message deliberately keeps the ids for the
--    log; the hint is what the app branches on, so nothing leaks to a person.
-- ---------------------------------------------------------------------------
create or replace function public.validate_progress_entry_owner()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  goal_owner uuid;
begin
  if new.goal_id is null or new.user_id is null then
    return new;  -- anonymized row, nothing to reconcile
  end if;

  select g.user_id into goal_owner
  from public.goals g
  where g.id = new.goal_id;

  if goal_owner is distinct from new.user_id then
    raise exception
      'progress_entries.user_id (%) does not match the owner of goal % (%)',
      new.user_id, new.goal_id, goal_owner
      using errcode = 'check_violation', hint = 'NOT_YOUR_GOAL';
  end if;

  return new;
end;
$function$;;
