-- 84. `goals.deadline` becomes a `date`, because it is one.
--
-- ## The bug this prevents, rather than fixes
--
-- The column has been `timestamptz` since migration 04 and has never had a
-- writer. `<input type="date">` submits `YYYY-MM-DD`, which PostgREST stores as
-- **midnight UTC**. Someone in `America/Los_Angeles` picks 1 September, and the
-- value read back and formatted in their zone is 31 August.
--
-- That is not a rendering bug that can be fixed in the reader. It is the column
-- claiming to know an instant when the person only ever named a day. Every
-- consumer would then have to agree on which timezone to un-apply, and any one
-- of them getting it wrong is a date off by one — the exact class of error the
-- digest boxes already had to be pinned to UTC to avoid.
--
-- `date` has no timezone semantics at all, so the error stops existing rather
-- than being handled in each reader.
--
-- ## Why now
--
-- **Zero rows carry a value.** `timestamptz -> date` casts using the session
-- timezone, so with data this would be a decision about whose midnight counts,
-- taken once, silently, by whichever connection ran the migration. With no data
-- it is free. The assertion below refuses to run if that ever stops being true.
--
-- ## What changes for readers
--
-- `export_user_data` is the only one, and it gets better: the exported value
-- becomes `2026-09-01` instead of `2026-09-01T00:00:00+00:00`, which is what
-- the person actually chose.
--
-- ## Still deliberately unconstrained
--
-- No CHECK, and no `min` in the UI. Migration 26 says why: a personal deadline
-- is informational, and recording a missed or historical one is legitimate. A
-- constraint here would fight the user rather than protect anything.

do $$
begin
  -- **A guard, not a comment.** The cast below is only safe because there is
  -- nothing to cast. If a row ever acquired a value before this ran, the
  -- migration must stop rather than quietly pick a timezone.
  if exists (select 1 from public.goals where deadline is not null) then
    raise exception
      'goals.deadline holds % non-null value(s); the timestamptz -> date cast '
      'would resolve them in the session timezone. Decide explicitly first.',
      (select count(*) from public.goals where deadline is not null);
  end if;
end;
$$;

alter table public.goals
  alter column deadline type date using deadline::date;

comment on column public.goals.deadline is
  'A calendar date, not an instant. `date` rather than `timestamptz` since migration 84: a date input submits YYYY-MM-DD, which stores as midnight UTC and reads back a day early for anyone west of UTC. Deliberately unconstrained — recording a missed or historical deadline is legitimate.';

-- ---------------------------------------------------------------------------
-- Proof, rolled back.
--
-- Three claims: the type changed, the grants survived it, and a date written
-- through the column comes back as the same date rather than one adjacent to it.
-- ---------------------------------------------------------------------------
do $$
declare
  v_user uuid;
  v_category uuid;
  v_goal uuid;
  v_read date;
  v_type text;
begin
  select data_type into v_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'goals' and column_name = 'deadline';

  if v_type <> 'date' then
    raise exception 'deadline is % rather than date', v_type;
  end if;

  -- **Grants are checked before RLS and are not implied by anything.** An
  -- `alter column ... type` rewrites the column, and a lost column grant would
  -- surface later as a bare 42501 from a form that looks correct.
  if not has_column_privilege('authenticated', 'public.goals', 'deadline', 'INSERT')
     or not has_column_privilege('authenticated', 'public.goals', 'deadline', 'UPDATE') then
    raise exception 'authenticated lost insert or update on goals.deadline';
  end if;

  select u.id into v_user
  from public.users u
  where (
    select count(*) from public.goals g
    where g.user_id = u.id and g.achieved_at is null and g.archived_at is null
  ) < 10
  limit 1;
  select id into v_category from public.goal_categories limit 1;

  if v_user is null or v_category is null then
    raise notice 'no eligible user or category; skipping the round trip';
  else
    insert into public.goals (user_id, title, category_id, deadline)
    values (v_user, '__migration_84_probe__', v_category, date '2026-09-01')
    returning id into v_goal;

    select deadline into v_read from public.goals where id = v_goal;

    -- The whole point of the change, asserted rather than assumed. Under
    -- `timestamptz` this comes back as an instant and any formatter west of UTC
    -- renders 31 August.
    if v_read <> date '2026-09-01' then
      raise exception 'wrote 2026-09-01 and read back %', v_read;
    end if;
  end if;

  raise exception 'rollback: migration 84 proof complete';
exception
  when others then
    if sqlerrm <> 'rollback: migration 84 proof complete' then
      raise;
    end if;
end;
$$;
