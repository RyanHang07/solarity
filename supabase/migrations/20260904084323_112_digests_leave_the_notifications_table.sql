-- 112. A digest stops being a notification.
--
-- ## What it was
--
-- Step 11c replaced the digest *list* with the day boxes on Overview, which
-- read `digest_snapshots`. From that moment a `notifications` row of type
-- `digest` was rendered nowhere and existed for exactly one purpose: carrying a
-- push. `read_at` never applied to it, the badge excluded it, the tab excluded
-- it, and `TAB_NOTIFICATION_TYPES` existed to keep three readers agreeing about
-- a row none of them wanted.
--
-- **A type filter is not a boundary.** Three separate readers each had to
-- remember to exclude digests, and every one of the three drift directions is
-- its own silent bug: a badge counting rows the tab hides is a number you
-- cannot clear by looking anywhere.
--
-- ## What replaces it
--
-- `digest_pushes` — one row per member per digest, recording that it was
-- delivered. That is the only fact the notification row was carrying.
--
-- **Keyed to the snapshot, with a composite foreign key, and that is doing
-- real work.** `on delete cascade` against `digest_snapshots (group_id, date)`
-- means the existing retention sweep clears these for free: a delivery record
-- for a digest that no longer exists is meaningless, and `run_retention_sweep`
-- keeps its signature and its two counters rather than growing a third.
--
-- ## `circle_activity` stays in `notifications`, and the difference matters
--
-- It is push-only for the same reason — it can arrive every hour and a badge
-- that is never zero is a badge nobody reads. But it has **no durable home
-- elsewhere**. A digest does: the snapshot is the record, and the notification
-- was a copy of it. Moving `circle_activity` would mean inventing a table to
-- hold something nothing reads.
create table if not exists public.digest_pushes (
  group_id uuid not null,
  date date not null,
  user_id uuid not null references public.users (id) on delete cascade,
  pushed_at timestamptz not null default now(),
  primary key (group_id, date, user_id),
  foreign key (group_id, date)
    references public.digest_snapshots (group_id, date) on delete cascade
);

comment on table public.digest_pushes is
  'One row per member per daily digest, recording that the push was delivered. Replaces the notifications row of type digest, which was rendered nowhere and existed only to carry the push. Cascades from digest_snapshots, so run_retention_sweep clears it without knowing it exists.';

-- **Deny-all, and no grants at all.** Only `send-digest-push` touches this, and
-- it holds the service key, which bypasses RLS. A person has no reason to read
-- their own delivery receipts and every reason not to be able to write them —
-- a client that could insert here would be able to suppress its own digests.
alter table public.digest_pushes enable row level security;
revoke all on public.digest_pushes from public, anon, authenticated;

-- **The backfill, and it runs before the delete for an obvious reason.**
-- Without it the sender would find 126 snapshots with no delivery record and
-- push three months of digests at everybody at once.
--
-- Joined to `digest_snapshots` rather than trusting the payload: retention has
-- already removed snapshots older than 90 days, and a delivery record for one
-- of those would violate the foreign key. Those rows are simply dropped, which
-- is correct — nothing can be re-pushed for a digest that no longer exists.
insert into public.digest_pushes (group_id, date, user_id, pushed_at)
select ds.group_id, ds.date, n.user_id, n.pushed_at
from public.notifications n
join public.digest_snapshots ds
  on ds.group_id = (n.payload ->> 'group_id')::uuid
 and ds.date = (n.payload ->> 'date')::date
where n.type = 'digest'
  and n.pushed_at is not null
  and n.payload ? 'group_id'
  and n.payload ? 'date'
on conflict do nothing;

delete from public.notifications where type = 'digest';

-- **The enum value stays.** Postgres cannot drop one, and `notification_type`
-- is referenced by a column with data in it. Nothing writes `digest` after
-- this; the value is a fossil rather than an option, and the filters in
-- `lib/notification-types.ts` stay as a guard rather than as a rule.

create or replace function public.build_daily_digests(p_date date default null)
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
           g.name as group_name,
           coalesce(p_date, private.circle_checkin_date(gc.group_id) - 1) as d
    from public.group_cycles gc
    join public.groups g on g.id = gc.group_id
    where gc.ended_at is null
      and g.group_status = 'active'
  loop
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

    -- The snapshot carries no Circle name and does not need one: `group_id` is
    -- a real column here with a real foreign key, unlike in a jsonb payload.
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

    -- **The notification insert that used to be here is gone, and this is the
    -- whole of migration 112.**
    --
    -- It wrote one `notifications` row per member per Circle carrying
    -- `group_id`, `circle_name`, `date`, `completed_count`, `member_count` and
    -- `group_streak` — every one of which is either in the snapshot above or
    -- joinable from it. The row was a copy of this row, addressed to a person,
    -- so that a sender could find it.
    --
    -- `send-digest-push` now reads these snapshots directly and records what it
    -- delivered in `digest_pushes`. The membership fan-out moved with it: this
    -- function writes one row per Circle-day, and who should hear about it is a
    -- question answered at delivery time against live membership rather than
    -- frozen at write time. **A member who joins between the digest being built
    -- and the push going out now gets it**, which is the behaviour the old
    -- fan-out could not have.

    v_written := v_written + 1;
  end loop;

  return v_written;
end;
$$;

comment on function public.build_daily_digests(date) is
  'Writes yesterday''s digest snapshot per active Circle. Since migration 112 it writes nothing to notifications: send-digest-push reads digest_snapshots and records delivery in digest_pushes.';

-- ── assertions ───────────────────────────────────────────────────────────────
do $$
declare
  v_src text;
  v_pk text[];
begin
  -- The table exists, keyed per member per digest. **Asked by column name
  -- rather than against a formatted string** — the first draft of this compared
  -- `pg_get_constraintdef` to text and failed on Postgres quoting `date`, which
  -- is an assertion failing for a reason that has nothing to do with the claim.
  select array_agg(a.attname order by a.attname) into v_pk
  from pg_constraint c
  cross join unnest(c.conkey) k
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
  where c.conrelid = 'public.digest_pushes'::regclass and c.contype = 'p';

  if v_pk is distinct from array['date', 'group_id', 'user_id'] then
    raise exception 'digest_pushes is not keyed per member per digest: %', v_pk;
  end if;

  -- **Cascading from the snapshot, which is what keeps retention working.**
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.digest_pushes'::regclass and contype = 'f'
      and pg_get_constraintdef(oid) like '%digest_snapshots%ON DELETE CASCADE%'
  ) then
    raise exception 'digest_pushes does not cascade from digest_snapshots, so retention will leak it';
  end if;

  -- Nobody holding a session can read or write it.
  if has_table_privilege('authenticated', 'public.digest_pushes', 'select')
     or has_table_privilege('authenticated', 'public.digest_pushes', 'insert') then
    raise exception 'a session can reach digest_pushes';
  end if;

  -- The builder no longer writes notifications at all.
  select p.prosrc into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'build_daily_digests';

  if v_src like '%insert into public.notifications%' then
    raise exception 'build_daily_digests still writes notification rows';
  end if;
  -- And still writes the snapshot, so the assertion above is not passing
  -- because the function was emptied.
  if v_src not like '%insert into public.digest_snapshots%' then
    raise exception 'build_daily_digests no longer writes snapshots';
  end if;

  -- Nothing of the old shape is left behind.
  if exists (select 1 from public.notifications where type = 'digest') then
    raise exception 'digest notification rows survived the migration';
  end if;
end;
$$;

notify pgrst, 'reload schema';
