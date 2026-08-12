-- Two fixes needed before the rollover can be scheduled.
--
-- 1. A Circle's day follows its OWNER's timezone. The rollover already computed
--    each user's own "yesterday" correctly, but the group loop used a single
--    global date, wrong for a Circle whose members span timezones.
--
-- 2. Idempotency. Streak counters are incremental, so processing a user twice
--    for the same date double-counts. The job must run HOURLY (2 AM local
--    happens at 24 different UTC moments), which guarantees repeat visits
--    unless something guards them.

alter table public.users
  add column if not exists last_rollover_date date;

comment on column public.users.last_rollover_date is
  'Last date run_daily_rollover processed for this user. Guards incremental '
  'streak counters against double-counting when the hourly job revisits them.';

alter table public.group_cycles
  add column if not exists last_rollover_date date;

create function private.circle_checkin_date(p_group_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (
    (now() at time zone coalesce(
      (select u.checkin_timezone
       from public.group_members gm
       join public.users u on u.id = gm.user_id
       where gm.group_id = p_group_id and gm.role = 'owner'),
      'UTC'
    )) - interval '2 hours'
  )::date;
$$;

revoke execute on function private.circle_checkin_date(uuid) from public;

drop function public.run_daily_rollover(date);

create function public.run_daily_rollover(p_date date default null)
returns table (users_processed integer, cycles_processed integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_users integer := 0;
  v_cycles integer := 0;
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

  update public.groups g
  set group_status = 'locked'
  from public.group_cycles gc
  where gc.group_id = g.id
    and gc.ended_at is null
    and gc.deadline is not null
    and g.group_status = 'active'
    and gc.deadline::date < coalesce(p_date, private.circle_checkin_date(g.id));

  return query select v_users, v_cycles;
end;
$$;

revoke execute on function public.run_daily_rollover(date) from anon, authenticated, public;

comment on function public.run_daily_rollover(date) is
  'Run HOURLY with no argument. Guards on users.last_rollover_date and '
  'group_cycles.last_rollover_date make repeat runs safe. An explicit date '
  'bypasses both guards for backfill/testing and WILL double-count if that '
  'date was already processed.';;
