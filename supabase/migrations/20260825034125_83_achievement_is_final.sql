-- 83. Achieving a goal is one-way, because it increments a lifetime counter.
--
-- ## The hole this closes, before anything reads the number
--
-- `authenticated` has held `update (achieved_at)` since migration 25, with no
-- constraint on *direction*. And `goals_count_achievement` (migration 34) fires
-- on every null -> not-null transition:
--
--   when (old.achieved_at is null and new.achieved_at is not null)
--
-- So: achieve a goal, set `achieved_at` back to null, achieve it again.
-- `total_goals_achieved` goes up twice for one goal. No policy is violated, no
-- constraint is broken, and it needs nothing but the ordinary PostgREST API.
--
-- **Nothing reads that counter today**, which is exactly why this lands now.
-- `/profile/[username]` is step 15, and it will publish the number. Fixing an
-- inflatable stat before it has a public surface is a migration; fixing it
-- afterwards is a migration plus a backfill plus a decision about whose totals
-- to correct.
--
-- ## Why a trigger and not a CHECK
--
-- The illegal thing is a **transition**, not a state. `achieved_at is null` is
-- perfectly legal — every unachieved goal is in it. What must not happen is
-- moving *out* of not-null. A CHECK sees one row version and cannot express
-- that; `old` only exists in a trigger.
--
-- ## Any change is refused, not only clearing it
--
-- The `when` clause below fires on *any* change to a non-null `achieved_at`, and
-- the function raises unconditionally. Clearing it is the one that inflates the
-- counter, but rewriting the timestamp to a different instant is history being
-- edited under a stat that is about to be published, and "achievement is final"
-- is a simpler rule to hold than "achievement is final unless you only move it".
--
-- ## Archiving deliberately does not get this rule
--
-- `archived_at` feeds no counter, and un-archiving a goal you dropped by mistake
-- is a reasonable thing to want. The asymmetry is the point: the constraint
-- exists because of the counter, so it goes exactly where the counter is.
--
-- ## What this is not
--
-- Not a claim that achieving is reversible through some other route. There is no
-- un-achieve action and this migration does not add one. If a person genuinely
-- needs a goal back, the answer is a new goal, which is what the copy says.

create function public.trg_goal_achievement_is_final()
returns trigger
language plpgsql
-- No `security definer`: this reads nothing and writes nothing, it only
-- refuses. Definer rights would be privilege for its own sake.
set search_path = ''
as $$
begin
  raise exception 'achieved_at cannot be changed once set'
    using errcode = 'check_violation', hint = 'ACHIEVEMENT_FINAL';
end;
$$;

-- `before`, so the refusal happens instead of the write rather than after it.
--
-- **`of achieved_at` narrows which UPDATEs are considered, not which columns
-- changed.** An update touching only `title` never reaches this; one that names
-- `achieved_at` does, and then the `when` clause decides. `is distinct from`
-- rather than `<>` so a no-op rewrite of the same timestamp is allowed through
-- — refusing that would break an upsert that re-sends every column, which is
-- precisely the mistake `setCircleVisibility` had to work around elsewhere.
create trigger goals_achievement_is_final
  before update of achieved_at on public.goals
  for each row
  when (old.achieved_at is not null
        and new.achieved_at is distinct from old.achieved_at)
  execute function public.trg_goal_achievement_is_final();

comment on function public.trg_goal_achievement_is_final() is
  'Refuses to clear or move goals.achieved_at once set. Exists because goals_count_achievement increments total_goals_achieved on every null -> not-null transition, so a clear-and-re-achieve cycle would inflate a lifetime stat through the ordinary API. archived_at has no equivalent rule and should not: it feeds no counter.';

revoke execute on function public.trg_goal_achievement_is_final() from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- Proof, in a transaction that is rolled back.
--
-- Both directions plus a negative control, because a rule that refuses
-- everything passes a test that only checks that something was refused.
-- ---------------------------------------------------------------------------
do $$
declare
  v_user uuid;
  v_category uuid;
  v_goal uuid;
  v_before integer;
  v_after integer;
begin
  -- **Not `from public.users limit 1`.** The probe inserts a goal, so it needs
  -- a user with room under the 10-goal cap, and it asserts on the counter, so it
  -- needs a `user_lifetime_stats` row — without one, `v_before` is null and
  -- every comparison below passes vacuously, which is the worst way for a proof
  -- to be green.
  select u.id into v_user
  from public.users u
  join public.user_lifetime_stats s on s.user_id = u.id
  where (
    select count(*) from public.goals g
    where g.user_id = u.id
      and g.achieved_at is null
      and g.archived_at is null
  ) < 10
  limit 1;

  select id into v_category from public.goal_categories limit 1;

  if v_user is null or v_category is null then
    raise notice 'no eligible user or no category to prove against; skipping';
    return;
  end if;

  insert into public.goals (user_id, title, category_id)
  values (v_user, '__migration_83_probe__', v_category)
  returning id into v_goal;

  select total_goals_achieved into v_before
  from public.user_lifetime_stats where user_id = v_user;

  -- ------------------------------------------------- the control: this works
  update public.goals set achieved_at = now() where id = v_goal;

  if (select achieved_at from public.goals where id = v_goal) is null then
    raise exception 'achieving a fresh goal did not take';
  end if;

  select total_goals_achieved into v_after
  from public.user_lifetime_stats where user_id = v_user;

  if v_after is distinct from v_before + 1 then
    raise exception 'the counter moved by % rather than 1', v_after - v_before;
  end if;

  -- ------------------------------------------------ clearing must be refused
  begin
    update public.goals set achieved_at = null where id = v_goal;
    raise exception 'un-achieving was allowed';
  exception
    when check_violation then null;
  end;

  -- -------------------------------------------------- moving must be refused
  begin
    update public.goals set achieved_at = now() - interval '1 day' where id = v_goal;
    raise exception 'rewriting achieved_at was allowed';
  exception
    when check_violation then null;
  end;

  -- ------------------- and the counter is where it was, not two ahead of it
  select total_goals_achieved into v_after
  from public.user_lifetime_stats where user_id = v_user;

  if v_after is distinct from v_before + 1 then
    raise exception 'the counter is at % after the refused writes, expected %',
      v_after, v_before + 1;
  end if;

  -- A no-op rewrite of the same value stays legal, per the `is distinct from`
  -- note above.
  update public.goals
     set achieved_at = (select achieved_at from public.goals where id = v_goal)
   where id = v_goal;

  raise exception 'rollback: migration 83 proof complete';
exception
  when others then
    if sqlerrm <> 'rollback: migration 83 proof complete' then
      raise;
    end if;
end;
$$;
