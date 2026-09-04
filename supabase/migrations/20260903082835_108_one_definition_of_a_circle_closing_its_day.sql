-- 108. `private.group_day_closed`, so the sky can close on the day it happens.
--
-- ## The finding
--
-- `daily_completion` is maintained live, by triggers on `progress_entries` and
-- `goals`. **`group_daily_completion` is not.** It is written only by
-- `private.rollover_group_day`, which runs from the nightly job.
--
-- Nothing was broken by that — the group streak is a property of a finished day
-- and is supposed to be settled at rollover. But the galaxy's Circle-complete
-- moment is the opposite: bridges between the suns, the cluster drawing
-- together, orbits synchronising, **at the instant the last member checks in.**
-- Read from `group_daily_completion` it would have played the following
-- morning, to nobody.
--
-- ## One definition, two callers
--
-- The rule was an inline aggregate inside `rollover_group_day`. It becomes a
-- function, and `rollover_group_day` calls it rather than keeping a copy.
--
-- **This codebase has already paid for a duplicated rule of exactly this kind.**
-- Migration 71: `private.is_goal_hidden_in_group` and `circle_roster` each
-- carried the definition of "hidden", and they agreed only because each was one
-- line. Adding a term to a rule that lives twice is how a title gets masked on
-- the roster and served with the photo.
--
-- So the assertions below check the extraction *happened* rather than that a
-- function exists: `rollover_group_day` must call it, and must no longer read
-- `group_members` or `daily_completion` at all.
--
-- The first draft of that assertion matched on the aggregate's name and failed
-- against the comment in the new body that explained the aggregate had been
-- removed. A rule about a function's meaning should be asked of what the
-- function reads, not of its prose.
--
-- ## What the rule is, unchanged
--
--   * every member of the Circle who is **not** in `streak_grace` has
--     `daily_completion.all_completed` for that date
--   * a member with no row for the date counts as not completed
--   * a Circle where **every** member is in grace is `false`, not vacuously
--     true — the original `coalesce(v_all, false)`, kept deliberately
--
-- ## Group and date, not cycle
--
-- `rollover_group_day` took a cycle and resolved the group as its first act.
-- The rule never needed the cycle, so the function takes the group directly and
-- the roster can call it without knowing which cycle is current.
--
-- **The date is the Circle's day, not each member's.** `circle_checkin_date`
-- resolves to the owner's day, and the rollover has always compared every
-- member's `daily_completion` against that single date. The live answer has to
-- use the same date or the sky and the streak would disagree about which day
-- they were talking about.
--
-- ## Two properties it inherits rather than introduces
--
-- `daily_completion` is recomputed against the goals that are active **now**,
-- and `streak_grace` is read as it stands **now**. So a historical date can
-- answer differently today than it did at rollover. That is true of the stored
-- `group_daily_completion` row as well, it predates this migration, and this
-- function is deliberately not the place to fix it.
--
-- ## Not callable by a person
--
-- `authenticated` holds USAGE on `private`, so a function left at its default
-- grant is reachable. This one is `security definer` over other people's
-- completion, and answering "did that Circle close?" for an arbitrary group id
-- is not something a caller should be able to ask. `circle_roster` checks
-- membership and is the only intended caller.

create function private.group_day_closed(p_group_id uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select bool_and(coalesce(dc.all_completed, false))
      from public.group_members gm
      left join public.daily_completion dc
        on dc.user_id = gm.user_id and dc.date = p_date
      where gm.group_id = p_group_id
        and not gm.streak_grace
    ),
    false
  );
$$;

comment on function private.group_day_closed(uuid, date) is
  'Did this Circle close this day? Every non-grace member completed theirs; a Circle entirely in grace is false. The single definition: private.rollover_group_day stores it and circle_roster returns it live. Do not re-implement it in either.';

revoke execute on function private.group_day_closed(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The rollover now calls it. Nothing else about this function changes.
-- ---------------------------------------------------------------------------

create or replace function private.rollover_group_day(p_cycle_id uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid;
  v_all boolean;
begin
  select gc.group_id into v_group from public.group_cycles gc where gc.id = p_cycle_id;

  -- The rule used to be written out here. See this migration's header.
  v_all := private.group_day_closed(v_group, p_date);

  insert into public.group_daily_completion (cycle_id, date, all_members_completed)
  values (p_cycle_id, p_date, v_all)
  on conflict (cycle_id, date) do update set all_members_completed = excluded.all_members_completed;

  update public.group_cycles
  set current_streak = case when v_all then current_streak + 1 else 0 end,
      longest_streak = case when v_all then greatest(longest_streak, current_streak + 1)
                            else longest_streak end
  where id = p_cycle_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_src text;
  v_disagree bigint;
  v_pairs bigint;
begin
  -- 1. The extraction happened. Not "the function exists" — that would also
  --    pass if the rollover kept its own copy beside it, which is the failure
  --    this migration exists to prevent. Asked of what it reads, not of its
  --    wording: the rollover has no business touching either of these tables.
  select p.prosrc into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'rollover_group_day';

  if v_src not like '%group_day_closed%' then
    raise exception 'rollover_group_day does not call group_day_closed';
  end if;
  if v_src like '%group_members%' or v_src like '%public.daily_completion%' then
    raise exception 'rollover_group_day still reads the completion tables itself; there are two copies again';
  end if;

  -- 2. Stable, definer, and pinned. A volatile function here would be
  --    re-evaluated per row inside circle_roster's ten-member scan.
  --
  --    `search_path=""` with the quotes, which is how Postgres stores
  --    `set search_path = ''`. Matching the unquoted form found nothing and
  --    failed this assertion on a function that was correctly pinned.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'group_day_closed'
      and p.provolatile = 's' and p.prosecdef
      and 'search_path=""' = any(p.proconfig)
  ) then
    raise exception 'group_day_closed is not stable/definer/search_path-pinned';
  end if;

  -- 3. Not callable by a person. `authenticated` has USAGE on `private`, so
  --    the default grant would have been enough to reach it.
  if has_function_privilege('authenticated', 'private.group_day_closed(uuid, date)', 'EXECUTE')
     or has_function_privilege('anon', 'private.group_day_closed(uuid, date)', 'EXECUTE') then
    raise exception 'group_day_closed is callable by a client';
  end if;

  -- 4. Equivalence with the rule it replaced, over every (group, date) pair the
  --    database actually holds. The old expression is written out here in full
  --    and compared, so this is a regression guard rather than a restatement.
  select count(*), count(*) filter (where old_answer is distinct from new_answer)
    into v_pairs, v_disagree
  from (
    select g.id as group_id, d.date,
           coalesce(
             (select bool_and(coalesce(dc.all_completed, false))
              from public.group_members gm
              left join public.daily_completion dc
                on dc.user_id = gm.user_id and dc.date = d.date
              where gm.group_id = g.id and not gm.streak_grace),
             false
           ) as old_answer,
           private.group_day_closed(g.id, d.date) as new_answer
    from public.groups g
    cross join (select distinct date from public.daily_completion) d
  ) pairs;

  if v_disagree <> 0 then
    raise exception '% of % (group, date) pairs disagree with the old rule', v_disagree, v_pairs;
  end if;

  raise notice 'group_day_closed agrees with the old rule on % pairs', v_pairs;
end;
$$;

-- ---------------------------------------------------------------------------
-- The rolled-back proof, run separately and recorded here.
--
-- Assertion 4 above compares against real data, which at the time of writing is
-- 30 (group, date) pairs and contains **no member in grace at all**. So the
-- grace half of the rule — the half most likely to be got wrong — was not
-- exercised by it. This block was run through the MCP inside a transaction that
-- ends in a deliberate `raise`, so every write below is discarded; the results
-- came back in the error message.
--
--   all completed          -> t (want t)
--   one member missing row -> f (want f)
--   one member open        -> f (want f)
--   that member in grace   -> t (want t)
--   every member in grace  -> f (want f)
--   a date with no rows    -> f (want f)
--
-- Verified afterwards that nothing persisted: no `daily_completion` rows on or
-- after 2098-01-01, and no member left in `streak_grace`.
--
-- do $$
-- declare
--   v_group uuid; v_members uuid[]; v_d date := date '2099-01-01';
--   r text := ''; v boolean;
-- begin
--   select gm.group_id, array_agg(gm.user_id) into v_group, v_members
--   from public.group_members gm group by gm.group_id having count(*) >= 2 limit 1;
--
--   update public.group_members set streak_grace = false where group_id = v_group;
--   insert into public.daily_completion (user_id, date, all_completed)
--   select unnest(v_members), v_d, true
--   on conflict (user_id, date) do update set all_completed = true;
--   v := private.group_day_closed(v_group, v_d);
--   r := r || format('all completed -> %s; ', v);
--
--   delete from public.daily_completion where user_id = v_members[1] and date = v_d;
--   r := r || format('one missing row -> %s; ', private.group_day_closed(v_group, v_d));
--
--   insert into public.daily_completion (user_id, date, all_completed)
--   values (v_members[1], v_d, false)
--   on conflict (user_id, date) do update set all_completed = false;
--   r := r || format('one open -> %s; ', private.group_day_closed(v_group, v_d));
--
--   update public.group_members set streak_grace = true
--   where group_id = v_group and user_id = v_members[1];
--   r := r || format('open member in grace -> %s; ', private.group_day_closed(v_group, v_d));
--
--   update public.group_members set streak_grace = true where group_id = v_group;
--   r := r || format('everyone in grace -> %s; ', private.group_day_closed(v_group, v_d));
--
--   update public.group_members set streak_grace = false where group_id = v_group;
--   r := r || format('no rows anywhere -> %s', private.group_day_closed(v_group, date '2098-01-01'));
--
--   raise exception 'ROLLED BACK PROOF: %', r;
-- end;
-- $$;
-- ---------------------------------------------------------------------------
