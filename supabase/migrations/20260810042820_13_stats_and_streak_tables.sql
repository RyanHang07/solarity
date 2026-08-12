-- Solarity initial schema, step 2g: stats and streak tables
-- Architecture doc section 3, plus section 21 (group streak & leaderboard)
--
-- All four are DERIVED tables. Created empty; the triggers and rollover job
-- that populate them are deliberately out of scope for the initial migration
-- (section 17).
--
-- Normalization note: the doc keys group_cycle_stats and group_daily_completion
-- by (group_id, cycle_id, ...). But group_cycles.cycle_id already determines
-- group_id, so carrying both would be the same duplicated-state problem removed
-- from `groups` earlier. These tables key off cycle_id alone and reach the group
-- through group_cycles.

-- Per-cycle, per-member streaks. Zeroed when a cycle resets, by virtue of new
-- rows being scoped to the new cycle_id rather than the old ones being edited.
create table public.group_cycle_stats (
  cycle_id uuid not null references public.group_cycles (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,

  current_streak integer not null default 0,
  longest_streak_in_cycle integer not null default 0,

  updated_at timestamptz not null default now(),

  primary key (cycle_id, user_id),

  constraint group_cycle_stats_non_negative
    check (current_streak >= 0 and longest_streak_in_cycle >= 0),
  constraint group_cycle_stats_longest_gte_current
    check (longest_streak_in_cycle >= current_streak)
);

create index group_cycle_stats_user_idx on public.group_cycle_stats (user_id);

create trigger group_cycle_stats_set_updated_at
  before update on public.group_cycle_stats
  for each row execute function public.set_updated_at();

-- Whether EVERY current member completed all their active goals on a date.
-- Evaluated at the 2 AM rollover; members flagged streak_grace are excluded.
create table public.group_daily_completion (
  cycle_id uuid not null references public.group_cycles (id) on delete cascade,
  date date not null,
  all_members_completed boolean not null,

  primary key (cycle_id, date)
);

comment on table public.group_daily_completion is
  'Derived at the 2 AM rollover. Only users who are current members at rollover '
  'time count; members with group_members.streak_grace = true are excluded '
  'entirely and neither break nor extend the streak.';

-- Leaderboard source. Per-user, per-category, scoped to a group.
-- group_id is NOT derivable from any other column here, so it is a real key
-- component rather than duplicated state.
create table public.group_member_category_stats (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  category_id uuid not null references public.goal_categories (id) on delete restrict,

  -- Counters accrue from the user's joined_at, not from group creation.
  total_completions integer not null default 0,
  total_possible integer not null default 0,

  current_streak integer not null default 0,
  longest_streak integer not null default 0,

  updated_at timestamptz not null default now(),

  primary key (group_id, user_id, category_id),

  constraint gmcs_non_negative
    check (total_completions >= 0 and total_possible >= 0
           and current_streak >= 0 and longest_streak >= 0),
  -- Completion rate is total_completions / total_possible, so it must never
  -- exceed 1. Catches double-counting at the source.
  constraint gmcs_completions_within_possible
    check (total_completions <= total_possible),
  constraint gmcs_longest_gte_current
    check (longest_streak >= current_streak)
);

comment on table public.group_member_category_stats is
  'Zeroed outright on kick (section 21), unlike progress_entries which are '
  'preserved. Being removed from a group costs leaderboard standing, including '
  'for a member who later rejoins.';

create index gmcs_user_idx on public.group_member_category_stats (user_id);
create index gmcs_category_idx on public.group_member_category_stats (category_id);

create trigger gmcs_set_updated_at
  before update on public.group_member_category_stats
  for each row execute function public.set_updated_at();

-- Cross-group, cross-cycle totals. Unaffected by any group resetting.
create table public.user_lifetime_stats (
  user_id uuid primary key references public.users (id) on delete cascade,

  current_streak integer not null default 0,
  longest_streak_ever integer not null default 0,
  total_days_completed integer not null default 0,
  total_goals_achieved integer not null default 0,

  -- Opt-in. When false, readable only by the owner; when true, readable by
  -- anyone sharing a group. Enforced in RLS (section 4).
  visible_on_profile boolean not null default false,

  updated_at timestamptz not null default now(),

  constraint uls_non_negative
    check (current_streak >= 0 and longest_streak_ever >= 0
           and total_days_completed >= 0 and total_goals_achieved >= 0),
  constraint uls_longest_gte_current
    check (longest_streak_ever >= current_streak),
  -- A streak cannot be longer than the number of completed days it is made of.
  constraint uls_streak_within_days
    check (longest_streak_ever <= total_days_completed)
);

create trigger user_lifetime_stats_set_updated_at
  before update on public.user_lifetime_stats
  for each row execute function public.set_updated_at();

-- Every user needs exactly one lifetime-stats row, from signup onward. Creating
-- it alongside the user avoids every read path having to handle "row does not
-- exist yet" as a separate case from "all zeroes".
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, first_name, last_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data ->> 'given_name',
    new.raw_user_meta_data ->> 'family_name',
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    )
  )
  on conflict (id) do nothing;

  insert into public.user_lifetime_stats (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from anon, authenticated, public;;
