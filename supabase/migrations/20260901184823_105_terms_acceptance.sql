-- Step 20a. Recording that somebody agreed to the terms.
--
-- `TERMS_VERSION` in `lib/legal.ts` has been a dated constant with no writer
-- since the legal pass, and `/terms` says so out loud. This is the writer.
--
-- **Two columns, not one.** The timestamp answers "when" and the version
-- answers "to what". A timestamp alone cannot tell you whether somebody agreed
-- to the current terms or to the ones from two revisions ago, which is the only
-- question a re-prompt ever needs to ask.
alter table public.users
  add column if not exists terms_accepted_at      timestamptz,
  add column if not exists terms_accepted_version text;

-- **Readable, never writable.** The gate has to read these to decide whether to
-- show the interstitial, so `authenticated` gets SELECT. It does not get
-- UPDATE, and that is the whole security model here: acceptance is written by
-- the two definer functions below and by nothing else. A column-level update
-- grant would let any client forge a record of consent it never gave, in the
-- one column whose entire purpose is proving it did.
grant select (terms_accepted_at, terms_accepted_version) on public.users to authenticated;

/**
 * Acceptance for an account that already exists.
 *
 * Every account predating this migration has agreed to nothing: Google sign-in
 * never showed a checkbox. They meet `/onboarding/terms` once and this records
 * the answer.
 *
 * **The version comes from the caller, and that is deliberate.** The app owns
 * `TERMS_VERSION`; the database has no business holding a second copy that
 * could drift from it. The CHECK below is on shape, not on value.
 */
create or replace function public.accept_terms(p_version text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Not authenticated'
      using errcode = 'insufficient_privilege', hint = 'NOT_AUTHENTICATED';
  end if;

  -- A dated constant, so anything else is a caller bug rather than a person's
  -- input. Refusing loudly beats storing a version nobody can compare against.
  if p_version is null or p_version !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Unrecognised terms version'
      using errcode = 'invalid_parameter_value', hint = 'TERMS_VERSION_INVALID';
  end if;

  update public.users
  set terms_accepted_at = now(),
      terms_accepted_version = p_version
  where id = v_uid;
end;
$$;

revoke execute on function public.accept_terms(text) from public, anon;
grant execute on function public.accept_terms(text) to authenticated;

-- --------------------------------------------------------------------------
-- `complete_onboarding` gains a third parameter.
--
-- **The drop is not optional and must be in this migration.** Adding a
-- parameter to a Postgres function does not modify it, it creates an overload:
-- `create or replace` only matches an identical signature, so the two-argument
-- version would survive, PostgREST would see two candidates for
-- `/rpc/complete_onboarding`, and every signup would fail with an ambiguity
-- error. Dropping first is what makes this a replacement.
-- --------------------------------------------------------------------------
drop function if exists public.complete_onboarding(text, text);

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
  -- **`coalesce` on the acceptance columns, and it is the subtle one.** This
  -- function is also the rename path, so a person changing their username two
  -- months from now must not have their acceptance timestamp quietly moved to
  -- today. Only a first acceptance writes.
  update public.users
  set username = p_username,
      checkin_timezone = p_timezone,
      checkin_day_started_at = coalesce(checkin_day_started_at, now()),
      terms_accepted_at = coalesce(terms_accepted_at, now()),
      terms_accepted_version = coalesce(terms_accepted_version, p_terms_version)
  where id = v_uid;
end;
$$;

revoke execute on function public.complete_onboarding(text, text, text) from public, anon;
grant execute on function public.complete_onboarding(text, text, text) to authenticated;
