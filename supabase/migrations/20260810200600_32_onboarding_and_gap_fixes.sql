-- Fixes for the five gaps found by the forward-looking probe.

-- ---------------------------------------------------------------------------
-- BLOCKER A + B: onboarding could not set a username or a timezone at all.
-- ---------------------------------------------------------------------------
-- username was excluded from the UPDATE grant in step 4c because renames need
-- the 14-day limit, a username_history row, and the profanity filter — but that
-- also blocked the FIRST set, making onboarding impossible. checkin_timezone was
-- excluded so a client couldn't move its own day boundary, but then nothing set
-- it, leaving every user on UTC and silently breaking the 2 AM rule outside it.
--
-- Both are now set through one function that enforces the rules rather than
-- relying on a call site to remember them.

create function public.complete_onboarding(p_username text, p_timezone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_current text;
  v_last_change timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- Validate the timezone by asking Postgres, rather than trusting the string.
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Unrecognised timezone: %', p_timezone using errcode = 'invalid_parameter_value';
  end if;

  select u.username into v_current from public.users u where u.id = v_uid;

  if v_current is not null and v_current <> p_username then
    -- This is a RENAME, not a first set. Section 3: once every 14 days.
    select max(h.changed_at) into v_last_change
    from public.username_history h where h.user_id = v_uid;

    if v_last_change is not null and v_last_change > now() - interval '14 days' then
      raise exception 'You can only change your username once every 14 days'
        using errcode = 'invalid_parameter_value';
    end if;

    insert into public.username_history (user_id, old_username, changed_at)
    values (v_uid, v_current, now());
  end if;

  -- Case-insensitive uniqueness is enforced by users_username_lower_key; the
  -- format CHECK enforces length and character set. Both surface as errors here.
  update public.users
  set username = p_username,
      checkin_timezone = p_timezone,
      checkin_day_started_at = coalesce(checkin_day_started_at, now())
  where id = v_uid;
end;
$$;

-- Called at each 2 AM rollover, not per request. Section 3: the stored timezone
-- updates only at a natural boundary, so mid-day travel cannot grant a second
-- check-in window or skip a day.
create function public.sync_checkin_timezone(p_timezone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_started timestamptz;
  v_tz text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Unrecognised timezone: %', p_timezone using errcode = 'invalid_parameter_value';
  end if;

  select checkin_day_started_at, checkin_timezone into v_started, v_tz
  from public.users where id = v_uid;

  -- Only advance if the current check-in day has actually elapsed. Calling this
  -- mid-day is a no-op, which is what stops travel from shifting the boundary.
  if v_started is null
     or ((now() at time zone v_tz) - interval '2 hours')::date
        > ((v_started at time zone v_tz) - interval '2 hours')::date
  then
    update public.users
    set checkin_timezone = p_timezone,
        checkin_day_started_at = now()
    where id = v_uid;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- GAP D: clients could insert trivially guessable invite tokens.
-- ---------------------------------------------------------------------------
-- Section 18 item 7 requires a CSPRNG token of 24+ bytes. The client supplied it,
-- so 'abc' was accepted. Token generation moves server-side and the client loses
-- the ability to insert invite_links directly.

revoke insert on public.invite_links from authenticated;
drop policy invite_links_insert_admin on public.invite_links;

create function public.create_invite_link(p_group_id uuid, p_expires_at timestamptz default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = v_uid and gm.role in ('owner','admin')
  ) then
    raise exception 'Only an owner or admin may create an invite link'
      using errcode = 'insufficient_privilege';
  end if;

  -- Section 9: enabling a link for a full circle produces one that cannot be used.
  select count(*) into v_count from public.group_members gm where gm.group_id = p_group_id;
  if v_count >= 10 then
    raise exception 'This circle is full' using errcode = 'check_violation';
  end if;

  -- 32 bytes from pgcrypto's CSPRNG, base64 made URL-safe.
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');

  -- Regenerating disables the previous link rather than deleting it (section 3).
  update public.invite_links set enabled = false
  where group_id = p_group_id and enabled;

  insert into public.invite_links (group_id, token, created_by, expires_at)
  values (p_group_id, v_token, v_uid, p_expires_at);

  insert into public.audit_log (actor_user_id, group_id, action_type)
  values (v_uid, p_group_id, 'invite_link_regenerated');

  return v_token;
end;
$$;

-- ---------------------------------------------------------------------------
-- GAP E1 + E2: leaving and kicking were neither audited nor stat-resetting.
-- ---------------------------------------------------------------------------
-- member_left and member_kicked existed in the enum but nothing ever wrote them,
-- so the membership history argued for earlier was not actually being recorded.
-- Section 21 also requires a kicked member's leaderboard stats to zero out.

create function public.handle_membership_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_self boolean := (v_uid is not null and v_uid = old.user_id);
begin
  insert into public.audit_log (actor_user_id, group_id, target_user_id, action_type, metadata)
  values (
    v_uid,
    old.group_id,
    old.user_id,
    case when v_self then 'member_left' else 'member_kicked' end,
    jsonb_build_object('role_at_removal', old.role)
  );

  -- Being removed by someone else costs leaderboard standing, including for a
  -- member who later rejoins (section 21). Leaving voluntarily does not.
  if not v_self then
    update public.group_member_category_stats
    set total_completions = 0, total_possible = 0,
        current_streak = 0, longest_streak = 0
    where group_id = old.group_id and user_id = old.user_id;
  end if;

  return old;
end;
$$;

revoke execute on function public.handle_membership_removal() from anon, authenticated, public;

create trigger group_members_on_removal
  after delete on public.group_members
  for each row execute function public.handle_membership_removal();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function public.complete_onboarding(text, text) from public;
revoke execute on function public.sync_checkin_timezone(text) from public;
revoke execute on function public.create_invite_link(uuid, timestamptz) from public;

grant execute on function public.complete_onboarding(text, text) to authenticated;
grant execute on function public.sync_checkin_timezone(text) to authenticated;
grant execute on function public.create_invite_link(uuid, timestamptz) to authenticated;;
