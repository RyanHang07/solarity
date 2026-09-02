-- Fixes migration 105, which recorded an acceptance when somebody renamed
-- their username.
--
-- **`complete_onboarding` is two paths in one function**, and it has been since
-- step 3: a first username set, and a rename from Settings. 105 added
-- `terms_accepted_at = coalesce(terms_accepted_at, now())`, which correctly
-- stops a rename *moving* an existing acceptance — and quietly lets a rename
-- *create* one.
--
-- So changing your handle in Settings wrote a record saying you agreed to the
-- terms at that moment. Nothing showed them to you. That is precisely the
-- dishonesty the interstitial in 20c exists to avoid, arriving through a door
-- nobody was watching, and it is worse than the backfill we rejected because it
-- looks like a real event with a real timestamp.
--
-- **The function already knows which path it is on.** `v_current is null` is a
-- first set; anything else is a rename. Acceptance is now written only on the
-- first, and `p_terms_version` is ignored entirely on the second.
create or replace function public.complete_onboarding(
  p_username text,
  p_timezone text,
  p_terms_version text
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_current text;
  v_last_change timestamptz;
  v_first_set boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege', hint = 'NOT_AUTHENTICATED';
  end if;

  -- Validate the timezone by asking Postgres, rather than trusting the string.
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Unrecognised timezone: %', p_timezone using errcode = 'invalid_parameter_value', hint = 'TIMEZONE_INVALID';
  end if;

  if p_terms_version is null or p_terms_version !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Unrecognised terms version'
      using errcode = 'invalid_parameter_value', hint = 'TERMS_VERSION_INVALID';
  end if;

  select u.username into v_current from public.users u where u.id = v_uid;

  -- Captured before the update, because the update is what makes it false.
  v_first_set := v_current is null;

  if v_current is not null and v_current <> p_username then
    -- This is a RENAME, not a first set. Section 3: once every 14 days.
    select max(h.changed_at) into v_last_change
    from public.username_history h where h.user_id = v_uid;

    if v_last_change is not null and v_last_change > now() - interval '14 days' then
      raise exception 'You can only change your username once every 14 days'
        using errcode = 'invalid_parameter_value', hint = 'USERNAME_RENAME_TOO_SOON';
    end if;

    insert into public.username_history (user_id, old_username, changed_at)
    values (v_uid, v_current, now());
  end if;

  -- Case-insensitive uniqueness is enforced by users_username_lower_key; the
  -- format CHECK enforces length and character set. Both surface as errors here.
  --
  -- **Acceptance is written only on the onboarding path**, and the `coalesce`
  -- stays inside that branch so a signup that somehow runs twice still cannot
  -- move the first timestamp. On a rename both columns are left exactly as they
  -- were, including null.
  update public.users
  set username = p_username,
      checkin_timezone = p_timezone,
      checkin_day_started_at = coalesce(checkin_day_started_at, now()),
      terms_accepted_at =
        case when v_first_set then coalesce(terms_accepted_at, now()) else terms_accepted_at end,
      terms_accepted_version =
        case when v_first_set then coalesce(terms_accepted_version, p_terms_version) else terms_accepted_version end
  where id = v_uid;
end;
$$;

revoke execute on function public.complete_onboarding(text, text, text) from public, anon;
grant execute on function public.complete_onboarding(text, text, text) to authenticated;

-- The schema cache is what made 105 look broken for ten minutes: dropping and
-- recreating a function leaves PostgREST serving the old signature until it is
-- told. `create or replace` on an identical signature does not need this, but
-- saying so in the migration that learned it is cheaper than learning it twice.
notify pgrst, 'reload schema';
