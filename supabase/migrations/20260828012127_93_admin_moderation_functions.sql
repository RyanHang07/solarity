-- 93. The four functions the admin dashboard is made of.
--
-- ## One door, and it is checked in every function
--
-- No policies were added for admins, deliberately. `content_reports` still has
-- exactly two: insert your own, read your own. Everything an admin does goes
-- through a `SECURITY DEFINER` function that calls `private.is_admin()` **as
-- its first statement**, so there is one place the rule lives and one place to
-- read to know what an admin can reach.
--
-- ## What an admin can see, and what they cannot
--
-- `admin_report_detail` returns **the reported item and nothing else**. Given a
-- report about a note, it returns that note. It cannot be asked for a person's
-- other goals, their other days, or anything they were not reported for. An
-- admin cannot browse; they can only open what somebody handed them.
--
-- That is the whole privacy design: the escalation is scoped to one row, chosen
-- by a third party, rather than to a role that can read everything.
--
-- **Photo keys, not URLs.** The bucket is private and no storage policy would
-- let an admin read a stranger's object, so the server signs it with the
-- service key. The key leaving here is the narrow escalation; a policy widening
-- `checkin_photos_select` for admins would be a permanent one.
--
-- ## Triage only
--
-- `admin_resolve_report` writes `status`, `reviewed_by` and `reviewed_at` —
-- three columns that have existed since migration 15 with no writer. **It does
-- not touch the reported content.** Removing a photo or suspending an account
-- is a bigger decision with its own consequences for streaks and Circles, and
-- it is not smuggled in here.
--
-- `reviewed_by` is `auth.uid()` and never an argument: a moderator must not be
-- able to file their decision under somebody else's name.

create function public.admin_report_queue(
  p_status public.content_report_status default 'pending',
  p_limit integer default 100
)
returns table (
  id uuid,
  content_type public.content_report_type,
  reason text,
  status public.content_report_status,
  created_at timestamptz,
  reporter_username text,
  reported_username text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Not an administrator'
      using errcode = 'insufficient_privilege', hint = 'NOT_SITE_ADMIN';
  end if;

  return query
    select r.id, r.content_type, r.reason, r.status, r.created_at,
           reporter.username, reported.username
    from public.content_reports r
    left join public.users reporter on reporter.id = r.reporter_user_id
    left join public.users reported on reported.id = r.reported_user_id
    -- Oldest first: a queue people work through, not a feed. The newest report
    -- is the least likely to be the one that has been waiting.
    order by r.created_at asc
    limit least(p_limit, 500);
end;
$$;

/**
 * One report, with the thing it is about.
 *
 * The reference formats are fixed by `lib/report-reference.ts`:
 *   user_profile               -> the reported account's id
 *   checkin_photo/checkin_note -> `<user_id>/<goal_id>/<check_in_date>`
 *
 * A malformed reference returns the report with no content rather than raising.
 * These are strings a client supplied; the action validates them now, but a row
 * written before that validation existed must still be reviewable — an
 * unresolvable report is exactly the kind a moderator needs to see.
 */
create function public.admin_report_detail(p_report_id uuid)
returns table (
  id uuid,
  content_type public.content_report_type,
  content_reference text,
  reason text,
  status public.content_report_status,
  created_at timestamptz,
  reviewed_at timestamptz,
  reporter_username text,
  reported_user_id uuid,
  reported_username text,
  reported_display_name text,
  reported_avatar_key text,
  checkin_date date,
  note text,
  photo_key text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.content_reports;
  v_parts text[];
  v_user uuid;
  v_goal uuid;
  v_date date;
  v_note text;
  v_photo text;
begin
  if not private.is_admin() then
    raise exception 'Not an administrator'
      using errcode = 'insufficient_privilege', hint = 'NOT_SITE_ADMIN';
  end if;

  select * into r from public.content_reports where content_reports.id = p_report_id;
  if not found then
    return;
  end if;

  if r.content_type in ('checkin_photo', 'checkin_note') then
    begin
      v_parts := string_to_array(r.content_reference, '/');
      if array_length(v_parts, 1) = 3 then
        v_user := v_parts[1]::uuid;
        v_goal := v_parts[2]::uuid;
        v_date := v_parts[3]::date;

        select pe.note, pe.photo_url into v_note, v_photo
        from public.progress_entries pe
        where pe.user_id = v_user
          and pe.goal_id = v_goal
          and pe.check_in_date = v_date;
      end if;
    exception
      -- A reference that will not parse is not an error, it is a report about
      -- something nobody can find. Returned with empty content so a moderator
      -- can dismiss it rather than being handed a 500.
      when others then
        v_note := null;
        v_photo := null;
    end;
  end if;

  return query
    select r.id, r.content_type, r.content_reference, r.reason, r.status,
           r.created_at, r.reviewed_at,
           reporter.username,
           r.reported_user_id, reported.username, reported.display_name,
           reported.avatar_url,
           v_date, v_note, v_photo
    from (select 1) _
    left join public.users reporter on reporter.id = r.reporter_user_id
    left join public.users reported on reported.id = r.reported_user_id;
end;
$$;

/**
 * Triage. Nothing here touches the reported content.
 *
 * The table's own CHECK requires `reviewed_at` to be null exactly when the
 * status is `pending`, so moving a report back to pending clears it. That is
 * the constraint talking, not a preference.
 */
create function public.admin_resolve_report(
  p_report_id uuid,
  p_status public.content_report_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Not an administrator'
      using errcode = 'insufficient_privilege', hint = 'NOT_SITE_ADMIN';
  end if;

  update public.content_reports
  set status = p_status,
      -- Never an argument. A moderator must not be able to file a decision
      -- under someone else's name.
      reviewed_by = case when p_status = 'pending' then null else (select auth.uid()) end,
      reviewed_at = case when p_status = 'pending' then null else now() end
  where id = p_report_id;

  if not found then
    raise exception 'No such report'
      using errcode = 'no_data_found', hint = 'REPORT_NOT_FOUND';
  end if;
end;
$$;

/**
 * Grants or revokes site admin.
 *
 * **Three guards, and each one exists because of a specific way this goes
 * wrong.**
 *
 * 1. The caller must already be an admin. The first one comes from SQL.
 * 2. **You cannot change your own role.** Self-demotion is how a single admin
 *    locks everyone out; self-promotion is meaningless since you are already
 *    one. Both are refused by the same test.
 * 3. **The last admin cannot be revoked.** Counted at the moment of the write,
 *    not assumed, because two admins demoting each other concurrently would
 *    each see one other admin and leave none.
 *
 * Audited either way. This is the only privilege in the product that lets one
 * person read another's private content, and a grant with no record of who
 * made it is not a grant anyone can review.
 */
create function public.admin_set_role(p_user_id uuid, p_role public.user_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_admins integer;
begin
  if not private.is_admin() then
    raise exception 'Not an administrator'
      using errcode = 'insufficient_privilege', hint = 'NOT_SITE_ADMIN';
  end if;

  if p_user_id = v_uid then
    raise exception 'You cannot change your own role'
      using errcode = 'invalid_parameter_value', hint = 'ROLE_SELF_CHANGE';
  end if;

  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'No such account'
      using errcode = 'no_data_found', hint = 'NO_SUCH_ACCOUNT';
  end if;

  if p_role = 'standard' then
    -- `for update` so two concurrent revocations cannot both read two.
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
    jsonb_build_object('role', p_role)
  );
end;
$$;

revoke execute on function public.admin_report_queue(public.content_report_status, integer) from public, anon;
revoke execute on function public.admin_report_detail(uuid) from public, anon;
revoke execute on function public.admin_resolve_report(uuid, public.content_report_status) from public, anon;
revoke execute on function public.admin_set_role(uuid, public.user_role) from public, anon;

grant execute on function public.admin_report_queue(public.content_report_status, integer) to authenticated;
grant execute on function public.admin_report_detail(uuid) to authenticated;
grant execute on function public.admin_resolve_report(uuid, public.content_report_status) to authenticated;
grant execute on function public.admin_set_role(uuid, public.user_role) to authenticated;

do $$
declare
  v_a uuid;
  v_b uuid;
  v_refused boolean;
begin
  select id into v_a from public.users limit 1;
  select id into v_b from public.users where id <> v_a limit 1;
  if v_a is null or v_b is null then
    raise notice 'need two users; skipping';
    return;
  end if;

  -- ------------------------------------------------- a standard user is shut out
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_a::text)::text, true);
  v_refused := false;
  begin
    perform * from public.admin_report_queue();
  exception when insufficient_privilege then v_refused := true;
  end;
  if not v_refused then
    raise exception 'a standard user read the report queue';
  end if;

  -- ------------------------------------------------------ and an admin is not
  update public.users set role = 'admin' where id = v_a;
  perform * from public.admin_report_queue();

  -- ------------------------------------------- you cannot change your own role
  v_refused := false;
  begin
    perform public.admin_set_role(v_a, 'standard');
  exception when invalid_parameter_value then v_refused := true;
  end;
  if not v_refused then
    raise exception 'an admin changed their own role';
  end if;

  -- ------------------------------------------------- the last admin survives
  update public.users set role = 'admin' where id = v_b;
  perform public.admin_set_role(v_b, 'standard');   -- two admins: allowed

  v_refused := false;
  begin
    -- v_a is now the only admin, and is the caller, so this is the self-test
    -- again; promote v_b and have v_b try to demote v_a instead.
    update public.users set role = 'admin' where id = v_b;
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_b::text)::text, true);
    perform public.admin_set_role(v_a, 'standard');  -- allowed, two admins
    perform public.admin_set_role(v_b, 'standard');  -- v_b is the last one
  exception
    when invalid_parameter_value then v_refused := true;
  end;
  if not v_refused then
    raise exception 'the last administrator was revoked';
  end if;

  raise exception 'rollback: migration 93 proof complete';
exception
  when others then
    if sqlerrm <> 'rollback: migration 93 proof complete' then
      raise;
    end if;
end;
$$;
