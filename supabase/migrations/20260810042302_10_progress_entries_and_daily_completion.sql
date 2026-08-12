-- Solarity initial schema, step 2f: check-ins and derived daily completion
-- Architecture doc section 3 (`progress_entries`, `daily_completion`)

create table public.progress_entries (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,

  -- Denormalized from goals.user_id. Kept deliberately: RLS policies and the
  -- daily_completion rollup both filter by user, and carrying the column here
  -- avoids a join to goals on the hottest read path in the app.
  user_id uuid not null references public.users (id) on delete cascade,

  -- A date, not a timestamp. Resolved client-side against the user's frozen
  -- checkin_timezone using a 2 AM boundary, so a check-in at 01:30 Tuesday
  -- still records Monday. Storing the resolved date keeps every downstream
  -- streak query simple.
  check_in_date date not null,

  note text,
  photo_url text,
  created_at timestamptz not null default now(),

  -- One check-in per goal per day, enforced by the database rather than only
  -- by the UI.
  constraint progress_entries_one_per_goal_per_day unique (goal_id, check_in_date)
);

comment on column public.progress_entries.check_in_date is
  'Local date under the 2 AM day boundary, computed against users.checkin_timezone.';
comment on column public.progress_entries.user_id is
  'Denormalized from goals.user_id for RLS and rollup performance. Must always '
  'match the parent goal''s owner.';

-- "This user's check-ins for a date range" drives the check-in panel, the
-- digest, and streak recomputation.
create index progress_entries_user_date_idx
  on public.progress_entries (user_id, check_in_date desc);

-- Derived table. Populated by the post-check-in trigger and the 2 AM rollover
-- job, neither of which exists yet (see section 17). Created empty here.
create table public.daily_completion (
  user_id uuid not null references public.users (id) on delete cascade,
  date date not null,

  -- True only when every currently-active goal was checked in that day.
  -- A day with ZERO active goals is written as false, not skipped: being in
  -- the product without a goal is a real failure state, not an exemption.
  all_completed boolean not null,

  primary key (user_id, date)
);

comment on table public.daily_completion is
  'Derived. Zero active goals on a date yields all_completed = false, never a '
  'skipped or vacuously-true row.';

-- Streak walks read a user's history backwards from today.
create index daily_completion_user_date_idx
  on public.daily_completion (user_id, date desc);;
