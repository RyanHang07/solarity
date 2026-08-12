-- Solarity initial schema, step 2c: goal categories (seeded) and goals
-- Architecture doc section 3 (`goal_categories`, `goals`)

-- Fixed preset list. Not user-customizable in the app; adding a category later
-- is a data insert, not a migration.
--
-- `slug` exists so application code can reference a category by a stable,
-- readable key ('fitness') rather than a UUID that differs between every
-- environment the seed runs in. The UUID primary key is kept for foreign keys.
create table public.goal_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null unique,
  color_hex text not null
);

comment on table public.goal_categories is
  'Fixed preset list, seeded at launch. Reference rows by slug in application '
  'code; the uuid PK is environment-specific and must not be hardcoded.';
comment on column public.goal_categories.color_hex is
  'Unused by v1 UI. Populated now so the deferred galaxy visualization can '
  'consume it later without a data migration. Avoid changing a value once '
  'goals reference the category.';

insert into public.goal_categories (slug, name, color_hex) values
  ('fitness',      'Fitness',                     '#FF3131'),
  ('hobbies',      'Hobbies',                     '#FF8A00'),
  ('career',       'Career & Professional',       '#FFD500'),
  ('health',       'Health & Wellness',           '#6EE62E'),
  ('finances',     'Finances',                    '#00D9A3'),
  ('productivity', 'Productivity & Habits',       '#1EC8FF'),
  ('mindfulness',  'Mindfulness & Mental Health', '#8A4FFF'),
  ('social',       'Social & Relationships',      '#F730A8'),
  ('other',        'Other',                       '#3355FF');

-- Goals are owned by the user, never by a group. A user's goals stay constant
-- across every group they belong to.
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,

  title text not null,

  -- Required at creation. There is no uncategorized state, so no default and
  -- no nullable fallback. ON DELETE RESTRICT prevents removing a category that
  -- goals still reference.
  category_id uuid not null references public.goal_categories (id) on delete restrict,

  -- Independent of any group's deadline.
  deadline timestamptz,

  -- The goal itself was accomplished (e.g. the marathon was actually run).
  -- Distinct from a daily check-in, and does not retroactively alter streak
  -- history.
  achieved_at timestamptz,

  -- Dropped or abandoned rather than completed. Separate from achieved_at:
  -- a goal can be achieved and kept active, or archived without ever being
  -- achieved.
  archived_at timestamptz,

  created_at timestamptz not null default now()
);

comment on column public.goals.achieved_at is
  'Goal permanently accomplished. Independent of daily check-ins.';
comment on column public.goals.archived_at is
  'Goal dropped/retired. Not a synonym for achieved_at.';

-- Primary access pattern: fetch one user's goals.
create index goals_user_id_idx on public.goals (user_id);

-- "Active goals" (neither achieved nor archived) drive the check-in panel, the
-- daily_completion evaluation, and the 10-active-goal cap. A partial index keeps
-- that lookup cheap as achieved/archived goals accumulate over a user's lifetime.
create index goals_active_by_user_idx
  on public.goals (user_id)
  where achieved_at is null and archived_at is null;;
