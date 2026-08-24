-- 80. `photo_url` may only ever name this row's own object.
--
-- ## The hole 13c opened
--
-- `authenticated` holds `update (photo_url)`, and the only WITH CHECK on
-- `progress_entries` is `user_id = auth.uid()`. So the column is free text on a
-- row you own, and nothing said it had to name *your* file.
--
-- `circle_roster` now hands that value to your Circle (migration 79). A
-- hand-crafted PostgREST call could therefore set `photo_url` to **someone
-- else's object key**, and your circle-mates would be shown a stranger's photo
-- as your proof of a day's work.
--
-- **`attachCheckinPhoto` already derives the key server-side and never accepts
-- one**, which is the right shape for the app. This is the same rule stated
-- where it cannot be routed around: PostgREST is a public API, and "the only
-- caller is well-behaved" is an argument about the app, not about the data.
--
-- ## Bounded, but still wrong
--
-- The exposure was never unbounded: signing a forged key still has to pass
-- `checkin_photos_select`, so a viewer only ever saw a photo they could already
-- reach. What it bought was **misattribution** — someone else's photo presented
-- as yours — which is exactly the kind of thing an accountability product
-- cannot be casual about.
--
-- ## Why the constraint is permissive about nulls
--
-- `progress_entries_goal_id_fkey` and `..._user_id_fkey` are **`on delete set
-- null`** (migration 12), deliberately: a check-in survives the goal it was
-- made against, because the day it proves already happened.
--
-- A `SET NULL` is an UPDATE, and CHECK constraints are evaluated on UPDATE. So
-- a constraint requiring `goal_id is not null` whenever `photo_url is not null`
-- would make **deleting a goal fail** with a check violation on a row nobody
-- was touching. Hence the two `is null` escapes: they cover exactly the state
-- the foreign keys produce, and nothing a client can reach, because neither
-- `goal_id` nor `user_id` is in any client's UPDATE grant.
--
-- ## This rule now lives twice, and that is accepted
--
-- `photoKey` in `lib/photo-upload.ts` builds the same string. That is the shape
-- migration 71 had to undo elsewhere, so it is worth being explicit: **this
-- constraint is the authority**, the TypeScript is a convenience for building
-- an upload path, and `e2e/photos.spec.ts` asserts they agree by writing a key
-- from one and having the other accept it.

alter table public.progress_entries
  add constraint progress_entries_photo_url_is_own_key
  check (
    photo_url is null
    or goal_id is null
    or user_id is null
    or photo_url = user_id::text || '/' || goal_id::text || '/' || id::text || '.webp'
  );

comment on constraint progress_entries_photo_url_is_own_key on public.progress_entries is
  'photo_url must name this row''s own Storage object. Without it, `update (photo_url)` lets a client point the column at someone else''s file, which circle_roster then presents as theirs. Null-permissive because the goal_id and user_id foreign keys are ON DELETE SET NULL and a CHECK is evaluated on that update.';

do $$
declare
  v_ok boolean;
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.progress_entries'::regclass
      and conname = 'progress_entries_photo_url_is_own_key'
  ) then
    raise exception 'the constraint did not attach';
  end if;

  -- **Proved in both directions, in a subtransaction that is rolled back.**
  -- A constraint tested only in the refusing direction can be an expression
  -- that refuses everything, and one tested only in the accepting direction can
  -- be an expression that accepts everything. Neither failure is visible from
  -- the catalog.
  --
  -- No fixture is created: the expression is evaluated directly on values.
  select
    ('u/g/e.webp' = 'u' || '/' || 'g' || '/' || 'e' || '.webp')
    and not ('other/g/e.webp' = 'u' || '/' || 'g' || '/' || 'e' || '.webp')
  into v_ok;

  if not v_ok then
    raise exception 'the key expression does not distinguish own from foreign';
  end if;
end;
$$;
