-- Solarity: design review fixes.
--
-- 1. Single source of truth for ownership. groups.owner_id duplicated the
--    group_members row with role='owner', with nothing keeping them in sync.
--    group_members wins: the partial unique index already guarantees exactly
--    one owner per group, so the duplicate column is pure drift risk.
alter table public.groups drop column owner_id;

-- 2. Single source of truth for the deadline. Section 7 treats the deadline as
--    a property of the cycle (it drives locking and renewal), so the copy on
--    groups was vestigial.
alter table public.groups drop column deadline;

comment on table public.groups is
  'Ownership lives in group_members (role = ''owner''), not here. The active '
  'deadline lives on the group''s open group_cycles row, not here.';

-- 3. Case-insensitive usernames. A plain UNIQUE on username allowed both
--    "Ryan" and "ryan" to exist, which is a cheaper impersonation route than
--    the unicode lookalikes section 18 already guards against.
alter table public.users drop constraint users_username_key;

create unique index users_username_lower_key
  on public.users (lower(username));

comment on index public.users_username_lower_key is
  'Case-insensitive uniqueness. Lookups must query lower(username) = lower($1) '
  'to use this index.';

-- 4. Modification timestamps. Shared trigger function, applied to every table
--    whose rows are edited after creation.
--
--    Deliberately SECURITY INVOKER (the default): this function needs no
--    elevated privileges, so it should not have any. Contrast handle_new_user(),
--    which genuinely does.
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from anon, authenticated, public;

alter table public.users add column updated_at timestamptz not null default now();
alter table public.goals add column updated_at timestamptz not null default now();
alter table public.groups add column updated_at timestamptz not null default now();
alter table public.group_members add column updated_at timestamptz not null default now();

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

create trigger goals_set_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();

create trigger groups_set_updated_at
  before update on public.groups
  for each row execute function public.set_updated_at();

create trigger group_members_set_updated_at
  before update on public.group_members
  for each row execute function public.set_updated_at();

-- 5. Colour values must actually be colours.
alter table public.goal_categories
  add constraint goal_categories_color_hex_format
  check (color_hex ~ '^#[0-9A-Fa-f]{6}$');;
