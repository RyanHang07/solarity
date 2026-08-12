-- Solarity initial schema, step 2e: per-group goal visibility
-- Architecture doc section 3 (`goal_group_visibility`), section 4 (hidden goals)
--
-- Depends on BOTH public.goals (step 2c) and public.groups (step 2d), which is
-- why it is its own step rather than living with either parent.

create table public.goal_group_visibility (
  goal_id uuid not null references public.goals (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,

  -- Display-only. A hidden goal still counts toward the owner's daily
  -- completion and streak math; only its title/note/photo are masked from
  -- other members of that specific group.
  hidden boolean not null default false,

  -- One visibility state per (goal, group) pair. Visibility is fully
  -- independent per group: the same goal can be hidden in one and visible in
  -- another.
  primary key (goal_id, group_id)
);

comment on table public.goal_group_visibility is
  'Sparse. The absence of a row means visible, so reads must treat a missing '
  'row as hidden = false (LEFT JOIN + coalesce), not as an error. Rows are '
  'only written when a user actively changes a goal''s visibility in a group.';

comment on column public.goal_group_visibility.hidden is
  'Affects display only, never the accountability math.';

-- The PK indexes (goal_id, group_id) in that order, which serves "where is
-- this goal hidden?". The inverse question -- "which goals are hidden in this
-- group?" -- drives group-facing rendering and needs its own index. Partial,
-- since only hidden rows are ever interesting to look up this way.
create index goal_group_visibility_hidden_by_group_idx
  on public.goal_group_visibility (group_id)
  where hidden;;
