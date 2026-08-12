-- Missing feature found by the enum audit: nothing could set or shorten a
-- deadline. An open-ended Circle could never gain one, and shortening required a
-- cycle reset, which wipes every member's per-cycle stats — a heavy price for
-- "let's actually finish by March". group_deadline_changed existed as the audit
-- action for an operation that was never built.
--
-- Rule: any change is allowed, but a deadline must be at least the NEXT day in
-- the Circle's own timezone. That prevents an owner ending a cycle out from
-- under everyone mid-day while leaving them free to move it otherwise.
-- Clearing it (going open-ended) is always allowed — it only ever gives people
-- more time.

create function public.set_circle_deadline(p_group_id uuid, p_deadline timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old timestamptz;
  v_cycle uuid;
  v_today date;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = v_uid and gm.role in ('owner','admin')
  ) then
    raise exception 'Only an owner or admin can change the deadline'
      using errcode = 'insufficient_privilege', hint = 'NOT_ADMIN';
  end if;

  if not exists (
    select 1 from public.groups g where g.id = p_group_id and g.group_status = 'active'
  ) then
    raise exception 'This circle is not active'
      using errcode = 'invalid_parameter_value', hint = 'CIRCLE_NOT_ACTIVE';
  end if;

  select gc.id, gc.deadline into v_cycle, v_old
  from public.group_cycles gc
  where gc.group_id = p_group_id and gc.ended_at is null;

  if v_cycle is null then
    raise exception 'This circle has no active cycle'
      using errcode = 'invalid_parameter_value', hint = 'NO_ACTIVE_CYCLE';
  end if;

  -- Evaluated in the Circle's timezone, matching how locking is decided, so a
  -- deadline can never be set to a day that is already underway or past.
  v_today := private.circle_checkin_date(p_group_id);

  if p_deadline is not null and p_deadline::date <= v_today then
    raise exception 'A deadline has to be at least tomorrow'
      using errcode = 'invalid_parameter_value', hint = 'DEADLINE_TOO_SOON';
  end if;

  update public.group_cycles set deadline = p_deadline where id = v_cycle;

  insert into public.audit_log (actor_user_id, group_id, action_type, metadata)
  values (v_uid, p_group_id, 'group_deadline_changed',
          jsonb_build_object('old_deadline', v_old, 'new_deadline', p_deadline));
end;
$$;

revoke execute on function public.set_circle_deadline(uuid, timestamptz) from public;
grant execute on function public.set_circle_deadline(uuid, timestamptz) to authenticated;

comment on function public.set_circle_deadline(uuid, timestamptz) is
  'Sets, moves, or clears the active cycle''s deadline. Minimum is the next day '
  'in the Circle''s timezone; NULL goes open-ended. Owner or admin.';;
