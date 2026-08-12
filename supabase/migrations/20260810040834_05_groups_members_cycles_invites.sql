-- Solarity initial schema, step 2d: groups, membership, cycles, invites
-- Architecture doc section 3, plus sections 7, 9, 21

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,

  -- ON DELETE RESTRICT: a group must never be left ownerless. This forces the
  -- account-deletion job (section 16) to explicitly transfer ownership or
  -- archive the group before the user row can go, rather than silently
  -- orphaning a group that other members are still using.
  owner_id uuid not null references public.users (id) on delete restrict,

  deadline timestamptz,
  group_status public.group_status not null default 'active',

  -- Group streak decision state (section 21). Set when someone joins mid-streak
  -- and the owner has not yet chosen continue-or-reset.
  streak_decision_pending boolean not null default false,
  pending_streak_joiners jsonb not null default '[]'::jsonb,

  -- Owner-configurable leaderboard behaviour (section 21).
  leaderboard_persists_across_cycles boolean not null default false,
  default_stats_view public.default_stats_view not null default 'cycle_stats',

  created_at timestamptz not null default now()
);

comment on column public.groups.owner_id is
  'ON DELETE RESTRICT by design: ownership must be transferred before the '
  'owning user can be deleted.';
comment on column public.groups.pending_streak_joiners is
  'JSONB array of user ids awaiting the owner streak decision, so multiple '
  'joins collapse into a single prompt rather than one per person.';

-- Many-to-many. No cap on groups-per-user; members-per-group is capped at 10
-- by a trigger added in the constraints step.
create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role public.group_member_role not null default 'member',

  -- Excludes this member from group streak evaluation until the owner resolves
  -- the pending continue-or-reset decision (section 21).
  streak_grace boolean not null default false,

  joined_at timestamptz not null default now(),

  -- Composite primary key: a user can appear in a group at most once.
  primary key (group_id, user_id)
);

-- Exactly one owner per group, enforced structurally rather than by convention.
-- A partial unique index treats 'owner' rows as unique per group while placing
-- no restriction on admins or members.
create unique index group_members_one_owner_idx
  on public.group_members (group_id)
  where role = 'owner';

-- The composite PK indexes (group_id, user_id) in that order, which does not
-- serve "which groups am I in?". That lookup gets its own index.
create index group_members_user_id_idx on public.group_members (user_id);

-- One run of a group's challenge, from creation (or reset) to its deadline.
create table public.group_cycles (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,

  started_at timestamptz not null default now(),
  ended_at timestamptz,          -- null while active
  deadline timestamptz,          -- null means open-ended, never locks

  -- The group streak (section 21).
  current_streak integer not null default 0,
  longest_streak integer not null default 0,

  constraint group_cycles_streaks_non_negative
    check (current_streak >= 0 and longest_streak >= 0),
  constraint group_cycles_ends_after_start
    check (ended_at is null or ended_at >= started_at)
);

-- A group has exactly one active cycle at a time. Same partial-unique-index
-- technique as the owner rule above: unique among rows where ended_at is null,
-- unconstrained across closed historical cycles.
create unique index group_cycles_one_active_idx
  on public.group_cycles (group_id)
  where ended_at is null;

create index group_cycles_group_id_idx on public.group_cycles (group_id, started_at desc);

create table public.invite_links (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,

  -- CSPRNG-generated, 24+ bytes, URL-safe. Generated in application code, not
  -- by a database default, so the source of randomness is explicit.
  token text not null unique,

  enabled boolean not null default true,

  -- Nullable + ON DELETE SET NULL: regenerated and revoked links are retained
  -- as an audit trail, so the row must survive its creator's account deletion.
  created_by uuid references public.users (id) on delete set null,

  expires_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.invite_links is
  'Regenerating a link inserts a new row and disables the old one; rows are '
  'never deleted, so the history of who issued which link is preserved.';

-- Join-by-token is the hot path and must not scan.
-- (The UNIQUE constraint on token already provides this index.)
create index invite_links_group_enabled_idx
  on public.invite_links (group_id)
  where enabled;;
