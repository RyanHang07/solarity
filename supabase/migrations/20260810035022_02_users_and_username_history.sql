-- Solarity initial schema, step 2b: identity tables
-- Architecture doc section 3 (`users`, `username_history`)

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,

  -- Captured from the OAuth provider at signup, editable afterwards.
  first_name text,
  last_name text,

  -- Public-facing identity across the whole product. Nullable because OAuth
  -- signup cannot supply it; onboarding is responsible for setting it before
  -- the user can participate. Postgres permits multiple NULLs under a unique
  -- constraint, so uniqueness still holds for every name actually chosen.
  username text unique,

  avatar_url text,

  -- Frozen timezone used to compute the 2 AM check-in day boundary. Updated
  -- only at each rollover, never read live per-request, so that travel cannot
  -- grant a second check-in or skip a day. See section 3, `progress_entries`.
  checkin_timezone text not null default 'UTC',
  checkin_day_started_at timestamptz,

  created_at timestamptz not null default now()
);

comment on column public.users.username is
  'Nullable until onboarding completes. Unique across all non-null values.';
comment on column public.users.checkin_timezone is
  'IANA timezone name, frozen at the last 2 AM rollover (not read live).';

-- Support/moderation lookup trail for renames. Never surfaced in the UI.
create table public.username_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  old_username text not null,
  changed_at timestamptz not null default now()
);

create index username_history_user_id_idx
  on public.username_history (user_id, changed_at desc);

-- Populates public.users when Supabase Auth creates an auth.users row.
-- SECURITY DEFINER so it can write to public.users regardless of the caller,
-- with an empty search_path (Supabase's recommended hardening) so every object
-- reference must be fully qualified and cannot be hijacked by a shadowing schema.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, first_name, last_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'given_name',
      split_part(new.raw_user_meta_data ->> 'full_name', ' ', 1)
    ),
    coalesce(
      new.raw_user_meta_data ->> 'family_name',
      nullif(split_part(new.raw_user_meta_data ->> 'full_name', ' ', 2), '')
    ),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();;
