-- Audit finding: the rollover locked Circles but told nobody, so the renewal
-- prompt in section 8 never fired. cycle_continue and cycle_reset existed but
-- were only reachable if a client called them unprompted — a Circle would just
-- stop accepting check-ins with no explanation.
--
-- The lock UPDATE already only matches rows currently 'active', so it fires
-- exactly once per transition. RETURNING notifies precisely those.

drop function public.run_daily_rollover(date);

create function public.run_daily_rollover(p_date date default null)
returns table (users_processed integer, cycles_processed integer, circles_locked integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_users integer := 0;
  v_cycles integer := 0;
  v_locked integer := 0;
begin
  for r in
    select u.id as user_id,
           coalesce(p_date, private.checkin_date_for(u.id) - 1) as d
    from public.users u
    where p_date is not null
       or u.last_rollover_date is null
       or u.last_rollover_date < private.checkin_date_for(u.id) - 1
  loop
    perform private.rollover_user_day(r.user_id, r.d);
    update public.users set last_rollover_date = r.d where id = r.user_id;
    v_users := v_users + 1;
  end loop;

  for r in
    select gc.id as cycle_id,
           coalesce(p_date, private.circle_checkin_date(gc.group_id) - 1) as d
    from public.group_cycles gc
    where gc.ended_at is null
      and (p_date is not null
           or gc.last_rollover_date is null
           or gc.last_rollover_date < private.circle_checkin_date(gc.group_id) - 1)
  loop
    perform private.rollover_group_day(r.cycle_id, r.d);
    update public.group_cycles set last_rollover_date = r.d where id = r.cycle_id;
    v_cycles := v_cycles + 1;
  end loop;

  with locked as (
    update public.groups g
    set group_status = 'locked'
    from public.group_cycles gc
    where gc.group_id = g.id
      and gc.ended_at is null
      and gc.deadline is not null
      and g.group_status = 'active'
      and gc.deadline::date < coalesce(p_date, private.circle_checkin_date(g.id))
    returning g.id as group_id, g.name
  ),
  notified as (
    insert into public.notifications (user_id, type, payload)
    select gm.user_id, 'group_locked_renewal',
           jsonb_build_object('group_id', l.group_id, 'circle_name', l.name)
    from locked l
    join public.group_members gm
      on gm.group_id = l.group_id and gm.role = 'owner'
    returning 1
  )
  select count(*) into v_locked from locked;

  return query select v_users, v_cycles, v_locked;
end;
$$;

revoke execute on function public.run_daily_rollover(date) from anon, authenticated, public;

comment on function public.run_daily_rollover(date) is
  'Run HOURLY with no argument. Guards on users.last_rollover_date and '
  'group_cycles.last_rollover_date make repeat runs safe. An explicit date '
  'bypasses both guards for backfill/testing and WILL double-count.';;
