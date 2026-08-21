-- 74. A deliberate timezone change, queued for the next rollover.
--
-- ## The bug
--
-- The settings page wired its timezone field to `sync_checkin_timezone`, which
-- reported success and wrote nothing. That function is a **deliberate no-op
-- mid-day**:
--
--     -- Only advance if the current check-in day has actually elapsed. Calling
--     -- this mid-day is a no-op, which is what stops travel from shifting the
--     -- boundary.
--
-- It exists for the AUTOMATIC path: the client notices you have flown somewhere
-- and calls it, and the change waits so your day cannot shift underneath you.
-- It is the wrong function for someone typing a zone and pressing Save.
--
-- "Only build controls whose backend exists" was the right rule applied too
-- shallowly. A writer existed; it did not mean what the control promised.
--
-- ## Why this is not simply "write checkin_timezone"
--
-- `private.checkin_date_for` reads the column and the instant, and nothing else:
--
--     select ((now() at time zone coalesce(u.checkin_timezone,'UTC'))
--             - interval '2 hours')::date;
--
-- **`checkin_day_started_at` is never consulted by it.** So writing
-- `checkin_timezone` directly re-dates today, retroactively: at 20:00 in Los
-- Angeles, switching to Tokyo makes "today" tomorrow, today's check-ins stay
-- filed under a date that is no longer today, and completion reads as nothing
-- done. That is exactly the hazard the automatic path defers to avoid, and a
-- deliberate change carries it identically.
--
-- ## The shape
--
-- `pending_checkin_timezone` holds the choice; the next rollover adopts it,
-- after the day it is closing has been finalised against the zone it was lived
-- in. The boundary moves between days and never during one.

alter table public.users
  add column pending_checkin_timezone text;

comment on column public.users.pending_checkin_timezone is
  'A timezone the user has chosen deliberately, adopted by the next daily rollover. Not validated by a CHECK because pg_timezone_names lookups are not immutable; set_checkin_timezone validates instead. Null means nothing queued.';

-- SELECT only. The RPC is the sole writer, so a client cannot queue a zone that
-- skipped validation. Grants are checked before RLS, so this is the real guard
-- rather than the policy.
grant select (pending_checkin_timezone) on public.users to authenticated;

create or replace function public.set_checkin_timezone(p_timezone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_current text;
begin
  if v_uid is null then
    raise exception 'Not authenticated'
      using errcode = 'insufficient_privilege', hint = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Unrecognised timezone: %', p_timezone
      using errcode = 'invalid_parameter_value', hint = 'TIMEZONE_INVALID';
  end if;

  select checkin_timezone into v_current from public.users where id = v_uid;

  -- Choosing the zone you are already in cancels anything queued, rather than
  -- queueing a change to the current value. Otherwise "put it back" would leave
  -- a pending row that does nothing and reads as a change still coming.
  if p_timezone = v_current then
    update public.users set pending_checkin_timezone = null where id = v_uid;
    return;
  end if;

  update public.users
  set pending_checkin_timezone = p_timezone
  where id = v_uid;
end;
$$;

comment on function public.set_checkin_timezone(text) is
  'A DELIBERATE timezone change, queued for the next rollover. Distinct from sync_checkin_timezone, which is the automatic travel path and is a no-op mid-day by design. Neither moves the boundary of a day already in progress: checkin_date_for reads checkin_timezone and now() alone, so writing checkin_timezone directly would re-date today retroactively.';

revoke all on function public.set_checkin_timezone(text) from public;
revoke all on function public.set_checkin_timezone(text) from anon;
grant execute on function public.set_checkin_timezone(text) to authenticated;

-- Unchanged from its previous definition except for the adoption in the user
-- loop.
create or replace function public.run_daily_rollover(p_date date default null)
returns table(users_processed integer, cycles_processed integer, circles_locked integer)
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

    -- Adopt any deliberately chosen timezone, here and nowhere else.
    --
    -- **Order is load-bearing.** The day is finalised first, against the zone
    -- it was lived in, and only then does the new zone take over. Swapping
    -- these would re-date the day being closed.
    --
    -- `checkin_day_started_at` moves with it to keep `sync_checkin_timezone`'s
    -- elapsed-day test honest. Nothing else reads that column.
    update public.users
    set last_rollover_date = r.d,
        checkin_timezone = coalesce(pending_checkin_timezone, checkin_timezone),
        checkin_day_started_at = case
          when pending_checkin_timezone is not null then now()
          else checkin_day_started_at
        end,
        pending_checkin_timezone = null
    where id = r.user_id;

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

do $$
begin
  if not has_column_privilege('authenticated', 'public.users', 'pending_checkin_timezone', 'SELECT') then
    raise exception 'authenticated cannot read pending_checkin_timezone';
  end if;
  if has_column_privilege('authenticated', 'public.users', 'pending_checkin_timezone', 'UPDATE') then
    raise exception 'authenticated can write pending_checkin_timezone directly';
  end if;
  if has_column_privilege('anon', 'public.users', 'pending_checkin_timezone', 'SELECT') then
    raise exception 'anon can read pending_checkin_timezone';
  end if;

  if not has_function_privilege('authenticated', 'public.set_checkin_timezone(text)', 'EXECUTE') then
    raise exception 'authenticated cannot call set_checkin_timezone';
  end if;
  if has_function_privilege('anon', 'public.set_checkin_timezone(text)', 'EXECUTE') then
    raise exception 'anon can call set_checkin_timezone';
  end if;
  if has_function_privilege('service_role', 'public.run_daily_rollover(date)', 'EXECUTE') then
    raise exception 'service_role gained EXECUTE on run_daily_rollover';
  end if;
end;
$$;
