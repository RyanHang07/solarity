-- 95. `admin_set_role`'s last-admin guard was both unreachable and wrong.
--
-- ## Found by writing the test, not by running it
--
-- Migration 93 had three guards: the caller must be an admin, **you cannot
-- change your own role**, and **the last admin cannot be revoked**. Trying to
-- write an end-to-end test for the third one showed it cannot happen:
--
--   to reach it the caller must be an admin (guard 1)
--   and the target must be someone else (guard 2)
--   and there must be one admin or fewer (guard 3)
--
-- If the caller is an admin and the target is a *different* admin, there are at
-- least two. **Guard 2 makes guard 3 unreachable for the case it was written
-- for**, and 93's own proof passed only because its final call was `v_b`
-- demoting `v_b` — refused by the self-guard, which raises the same SQLSTATE.
-- An assertion that could not fail, of exactly the shape `patterns.md` warns
-- about, written by the same hand that wrote the warning.
--
-- ## And the reachable case was a false positive
--
-- The count ran whenever `p_role = 'standard'`, **without checking whether the
-- target was an admin at all**. So with one admin in the system, revoking
-- *anybody* — including an ordinary user who was never an admin — was refused
-- with "That is the last administrator". That is the common case: a fresh
-- install has exactly one admin, and the Revoke button would have failed on
-- every username with a message about somebody else.
--
-- ## The fix
--
-- **Self-demotion is allowed**, and the last-admin rule is what protects the
-- system instead. That is the ordinary design: an admin stepping down should
-- not need a second person to do it for them, and the one who cannot leave is
-- the only one left. Removing the self-guard is what makes the last-admin rule
-- reachable, and therefore real.
--
-- **The count only runs when the target is currently an admin.** Revoking
-- somebody who never had the role is a no-op, not a constitutional crisis.
--
-- The audit row is now written only when the role actually changed, so setting
-- a standard user to standard does not log a revocation that did not happen.

create or replace function public.admin_set_role(p_user_id uuid, p_role public.user_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_current public.user_role;
  v_admins integer;
begin
  if not private.is_admin() then
    raise exception 'Not an administrator'
      using errcode = 'insufficient_privilege', hint = 'NOT_SITE_ADMIN';
  end if;

  select role into v_current from public.users where id = p_user_id;

  if not found then
    raise exception 'No such account'
      using errcode = 'no_data_found', hint = 'NO_SUCH_ACCOUNT';
  end if;

  -- Nothing to do, and nothing to audit. Returning quietly rather than raising
  -- because asking for the state something is already in is not an error.
  if v_current = p_role then
    return;
  end if;

  /**
   * **Only when the target actually holds the role**, which is the half
   * migration 93 missed. Counting on every demotion meant one admin could
   * revoke nobody, because the count included themselves and the target's own
   * role was never consulted.
   *
   * `for update` so two concurrent revocations cannot both read two and both
   * proceed.
   *
   * This now covers self-demotion too, which is the case it was written for and
   * could not previously reach.
   */
  if p_role = 'standard' and v_current = 'admin' then
    select count(*) into v_admins
    from (select 1 from public.users where role = 'admin' for update) x;

    if v_admins <= 1 then
      raise exception 'That is the last administrator'
        using errcode = 'invalid_parameter_value', hint = 'LAST_ADMIN';
    end if;
  end if;

  update public.users set role = p_role where id = p_user_id;

  insert into public.audit_log (actor_user_id, target_user_id, action_type, metadata)
  values (
    v_uid,
    p_user_id,
    (case when p_role = 'admin' then 'site_admin_granted'
          else 'site_admin_revoked' end)::public.audit_action_type,
    jsonb_build_object('role', p_role, 'previous', v_current)
  );
end;
$$;

comment on function public.admin_set_role(uuid, public.user_role) is
  'Grants or revokes site admin. Self-demotion is allowed; the last admin cannot be revoked, by themselves or anyone. Migration 95 removed a self-change guard that made the last-admin rule unreachable, and scoped the admin count to targets who actually hold the role — before that, one admin could revoke nobody.';

-- ---------------------------------------------------------------------------
-- Proof, rolled back. **Every branch, including the one 93 could not reach.**
-- ---------------------------------------------------------------------------
do $$
declare
  v_a uuid;
  v_b uuid;
  v_hint text;
  v_reached boolean;
begin
  select id into v_a from public.users limit 1;
  select id into v_b from public.users where id <> v_a limit 1;
  if v_a is null or v_b is null then
    raise notice 'need two users; skipping';
    return;
  end if;

  update public.users set role = 'admin' where id = v_a;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_a::text)::text, true);

  -- ------------- the false positive 93 shipped: revoking a plain user, alone
  -- `v_b` is not an admin and `v_a` is the only one. Under 93 this raised
  -- LAST_ADMIN. It must now be a quiet no-op.
  perform public.admin_set_role(v_b, 'standard');

  -- ------------------------------------- the last admin cannot step down
  v_reached := false;
  begin
    perform public.admin_set_role(v_a, 'standard');
  exception when invalid_parameter_value then
    get stacked diagnostics v_hint = PG_EXCEPTION_HINT;
    if v_hint = 'LAST_ADMIN' then v_reached := true; end if;
  end;
  if not v_reached then
    raise exception 'the last admin demoted themselves';
  end if;

  -- ------------------------------------------- but one of two can step down
  perform public.admin_set_role(v_b, 'admin');
  perform public.admin_set_role(v_a, 'standard');

  if (select role from public.users where id = v_a) <> 'standard' then
    raise exception 'self-demotion with two admins did not take';
  end if;
  if (select count(*) from public.users where role = 'admin') <> 1 then
    raise exception 'the wrong number of admins survived';
  end if;

  raise exception 'rollback: migration 95 proof complete';
exception
  when others then
    if sqlerrm <> 'rollback: migration 95 proof complete' then
      raise;
    end if;
end;
$$;
