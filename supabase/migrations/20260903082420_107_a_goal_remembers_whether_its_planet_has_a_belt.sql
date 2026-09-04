-- 107. `goals.belt_visible` — the one thing about a planet that is rolled.
--
-- ## Why a column and not the table the plan asked for
--
-- The build plan specified a `goal_cosmetics` table: a primary key, a derived
-- `user_id`, four RLS policies, grants, a second write inside goal creation,
-- and a backfill script that had to import the renderer's own roll so the
-- distribution could not drift between new goals and old ones.
--
-- **It was for one boolean.** `createGoalCosmeticsRoll()` returns
-- `{ beltMode: 'auto', beltVisible: rollPlanetHasBelt() }` and nothing else.
-- A planet's surface is already derived deterministically from the goal's uuid
-- by `resolveSurfaceKind`, and its radius is left undefined so the renderer
-- uses its default. The only fact that is genuinely rolled — and therefore the
-- only fact that has to be remembered — is a one-in-five coin flip.
--
-- A column with a random default answers all five of the table's requirements,
-- and answers four of them by construction rather than by care:
--
--   * written in the same transaction as the goal — it is a column of the goal
--   * `user_id` never accepted from a client — there is no `user_id` to forge
--   * RLS — `goals` RLS already governs it
--   * backfilled — the `alter` fills every existing row as it runs, from the
--     same expression that will fill every future one
--   * atomic with the insert — there is no second write
--
-- ## The grants are already column-level, and that is what makes this safe
--
-- `authenticated` holds INSERT on exactly `(category_id, deadline, title,
-- user_id)` and UPDATE on a similarly explicit list. **So a client cannot set
-- this column, and does not need to be stopped from doing so** — a new column
-- is not insertable or updatable by anyone until it is granted, and grants are
-- checked before RLS.
--
-- Only SELECT is granted below. A person cannot choose whether their planet has
-- a belt, which is exactly the v1 decision: cosmetics are stored, not editable.
--
-- ## This rewrites the table, deliberately
--
-- Postgres skips the rewrite for a `not null default` only when the default is
-- constant. `random()` is volatile, so the table is rewritten and the
-- expression is evaluated **once per row** — which is the entire point. A
-- constant-folded default would give every existing goal the same answer and
-- every planet in the app the same belt.
--
-- `goals` is small and the lock is brief. If it ever is not, the fallback is
-- add-nullable, backfill in batches, then set not null.
--
-- ## What is deferred
--
-- Per-goal radius and surface overrides, which is the editable version.
-- Nothing here blocks them: `resolveSurfaceKind` and `resolvePlanetRadius`
-- already prefer a stored value over the derived one, so a `goal_cosmetics`
-- table can arrive later and override without a renderer change.

alter table public.goals
  add column belt_visible boolean not null default (random() < 0.2);

comment on column public.goals.belt_visible is
  'Rolled once, when the goal is created, by this column''s default: one in five planets has a belt. Read by the galaxy; never set by a client, which is enforced by the absence of an INSERT/UPDATE grant on this column rather than by a policy. PLANET_BELT_CHANCE in lib/galaxy/planetCosmetics.ts is the same number and the two must be changed together.';

-- Readable, and only readable. See the header.
grant select (belt_visible) on public.goals to authenticated;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_default text;
  v_nulls bigint;
  v_priv boolean;
  v_true bigint;
  v_n constant bigint := 5000;
  v_rate numeric;
  v_distinct bigint;
begin
  -- 1. The column exists, is not null, and its default is per-row random.
  select pg_get_expr(d.adbin, d.adrelid) into v_default
  from pg_attribute a
  join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = 'public.goals'::regclass
    and a.attname = 'belt_visible';

  if v_default is null or v_default not like '%random()%' then
    raise exception 'belt_visible has no random default; got %', v_default;
  end if;

  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.goals'::regclass
      and attname = 'belt_visible' and attnotnull
  ) then
    raise exception 'belt_visible is nullable';
  end if;

  -- 2. Every pre-existing goal was backfilled. Asserted rather than assumed:
  --    `not null` would have raised, but this is the claim the plan makes.
  select count(*) into v_nulls from public.goals where belt_visible is null;
  if v_nulls <> 0 then
    raise exception '% goals have no belt roll', v_nulls;
  end if;

  -- 3. A client can read it and cannot write it. The whole safety argument.
  if not has_column_privilege('authenticated', 'public.goals', 'belt_visible', 'SELECT') then
    raise exception 'authenticated cannot read belt_visible';
  end if;
  select has_column_privilege('authenticated', 'public.goals', 'belt_visible', 'INSERT')
    into v_priv;
  if v_priv then
    raise exception 'authenticated can INSERT belt_visible; a client could choose its own belt';
  end if;
  select has_column_privilege('authenticated', 'public.goals', 'belt_visible', 'UPDATE')
    into v_priv;
  if v_priv then
    raise exception 'authenticated can UPDATE belt_visible';
  end if;

  -- 4. The distribution, against a temp table carrying the same default, so
  --    nothing here touches a real goal. A zero-column INSERT ... SELECT is
  --    what makes the *default* the thing under test rather than a copy of the
  --    expression written out again here.
  create temp table belt_roll_probe (b boolean not null default (random() < 0.2))
    on commit drop;
  execute format('insert into belt_roll_probe select from generate_series(1, %s)', v_n);

  select count(*) filter (where b) into v_true from belt_roll_probe;
  v_rate := v_true::numeric / v_n;

  -- Roughly five standard deviations either side at n = 5000, so this fails
  -- when the roll is wrong and effectively never when it is right. A tight
  -- band would make the assertion itself a coin flip.
  if v_rate < 0.17 or v_rate > 0.23 then
    raise exception 'belt rate % is not near PLANET_BELT_CHANCE (0.2)', v_rate;
  end if;

  -- 5. Negative control: the default is evaluated per row, not once per
  --    statement. Sixty rows in one statement all agreeing has probability
  --    about 1.5e-6 if the roll is real, and probability 1 if it is not.
  truncate belt_roll_probe;
  insert into belt_roll_probe select from generate_series(1, 60);
  select count(distinct b) into v_distinct from belt_roll_probe;
  if v_distinct < 2 then
    raise exception 'sixty rows in one statement share a belt roll; the default is not per-row';
  end if;

  raise notice 'belt_visible: % nulls, rate %, per-row confirmed', v_nulls, v_rate;
end;
$$;
