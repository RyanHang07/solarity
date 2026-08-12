-- Daily digest (section 7).
--
-- Split into two independently retryable halves:
--   1. build_daily_digests()  — SQL. Writes digest_snapshots and one notification
--      per member. This alone makes the Overview subtab and the in-app feed work.
--   2. send-digest-push       — Edge Function. Delivers web push, which needs
--      VAPID signing and therefore cannot live in Postgres.
--
-- Keeping them separate means a push failure never blocks the in-app digest, and
-- either half can be re-run without corrupting the other.

-- Tracks delivery so a retry doesn't re-push. Distinct from read_at, which is
-- the user's action; this is ours.
alter table public.notifications
  add column if not exists pushed_at timestamptz;

comment on column public.notifications.pushed_at is
  'When web push was delivered. NULL means undelivered or not applicable. '
  'Separate from read_at, which records the user opening it.';

-- Only undelivered rows are ever scanned, and they stay a small slice.
create index if not exists notifications_unpushed_idx
  on public.notifications (created_at)
  where pushed_at is null;

create function public.build_daily_digests(p_date date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_summary jsonb;
  v_completed integer;
  v_total integer;
  v_written integer := 0;
begin
  for r in
    select gc.group_id,
           gc.id as cycle_id,
           gc.current_streak,
           coalesce(p_date, private.circle_checkin_date(gc.group_id) - 1) as d
    from public.group_cycles gc
    join public.groups g on g.id = gc.group_id
    where gc.ended_at is null
      and g.group_status = 'active'
  loop
    -- Skip if this Circle's digest for that date already exists.
    if exists (
      select 1 from public.digest_snapshots ds
      where ds.group_id = r.group_id and ds.date = r.d
    ) then
      continue;
    end if;

    -- Usernames are denormalized INTO the snapshot at write time. Joining live
    -- would let a past digest silently relabel itself when someone renames.
    select
      jsonb_agg(
        jsonb_build_object(
          'user_id',   m.user_id,
          'username',  m.username,
          'completed', m.completed,
          'streak',    m.streak
        ) order by m.username
      ),
      count(*) filter (where m.completed),
      count(*)
    into v_summary, v_completed, v_total
    from (
      select gm.user_id,
             u.username,
             coalesce(dc.all_completed, false) as completed,
             coalesce(gcs.current_streak, 0)   as streak
      from public.group_members gm
      join public.users u on u.id = gm.user_id
      left join public.daily_completion dc
        on dc.user_id = gm.user_id and dc.date = r.d
      left join public.group_cycle_stats gcs
        on gcs.cycle_id = r.cycle_id and gcs.user_id = gm.user_id
      where gm.group_id = r.group_id
    ) m;

    if v_total is null or v_total = 0 then
      continue;
    end if;

    insert into public.digest_snapshots (group_id, date, summary)
    values (
      r.group_id,
      r.d,
      jsonb_build_object(
        'members',        coalesce(v_summary, '[]'::jsonb),
        'completed_count', v_completed,
        'member_count',    v_total,
        'group_streak',    r.current_streak
      )
    )
    on conflict (group_id, date) do nothing;

    -- One notification per member per Circle, never one combined across
    -- Circles. Teaser only: iOS truncates long bodies, and a detailed payload
    -- risks surfacing hidden-goal-adjacent detail on a lock screen, outside the
    -- app's access controls.
    insert into public.notifications (user_id, type, payload)
    select gm.user_id,
           'digest',
           jsonb_build_object(
             'group_id',        r.group_id,
             'date',            r.d,
             'completed_count', v_completed,
             'member_count',    v_total,
             'group_streak',    r.current_streak
           )
    from public.group_members gm
    where gm.group_id = r.group_id;

    v_written := v_written + 1;
  end loop;

  return v_written;
end;
$$;

revoke execute on function public.build_daily_digests(date) from anon, authenticated, public;

comment on function public.build_daily_digests(date) is
  'Scheduled daily. Idempotent: skips any Circle that already has a digest for '
  'the target date, so a re-run neither duplicates snapshots nor re-notifies.';;
