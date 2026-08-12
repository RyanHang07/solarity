-- Notify every other member when a deadline moves.
--
-- Without the two-day notice rule, a deadline can now be set to tomorrow, and
-- members had no way to learn about it short of noticing the Circle page. The
-- notice rule protected against surprise; this restores that protection through
-- information rather than delay.
--
-- Skipped when the value doesn't actually change, so a no-op save doesn't spam
-- everyone. Circle name and both dates are denormalized into the payload, per
-- the immutable-snapshot rule.

create or replace function public.set_circle_deadline(p_group_id uuid, p_deadline timestamptz)
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
  v_name text;
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

  select g.name into v_name
  from public.groups g where g.id = p_group_id and g.group_status = 'active';

  if v_name is null then
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

  v_today := private.circle_checkin_date(p_group_id);

  if p_deadline is not null and p_deadline::date <= v_today then
    raise exception 'A deadline has to be at least tomorrow'
      using errcode = 'invalid_parameter_value', hint = 'DEADLINE_TOO_SOON';
  end if;

  -- No-op saves shouldn't audit or notify.
  if p_deadline is not distinct from v_old then
    return;
  end if;

  update public.group_cycles set deadline = p_deadline where id = v_cycle;

  insert into public.audit_log (actor_user_id, group_id, action_type, metadata)
  values (v_uid, p_group_id, 'group_deadline_changed',
          jsonb_build_object('old_deadline', v_old, 'new_deadline', p_deadline));

  -- Everyone except whoever made the change.
  insert into public.notifications (user_id, type, payload)
  select gm.user_id, 'deadline_changed',
         jsonb_build_object(
           'group_id',     p_group_id,
           'circle_name',  v_name,
           'old_deadline', v_old,
           'new_deadline', p_deadline,
           'cleared',      p_deadline is null
         )
  from public.group_members gm
  where gm.group_id = p_group_id and gm.user_id <> v_uid;
end;
$$;

revoke execute on function public.set_circle_deadline(uuid, timestamptz) from public;
grant execute on function public.set_circle_deadline(uuid, timestamptz) to authenticated;;
