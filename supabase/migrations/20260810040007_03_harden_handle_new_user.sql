-- Solarity, step 2b revision: harden the signup trigger.
--
-- Two changes from the original:
--   1. Removed the split_part() fallbacks for first_name / last_name. Splitting
--      a full name on whitespace is wrong for compound surnames, multiple given
--      names, and family-name-first cultures. These columns are now populated
--      only from structured provider fields, and left NULL when the provider
--      does not supply them. A null field is honest; a mis-parsed one looks
--      like real data and quietly misleads.
--   2. Added ON CONFLICT (id) DO NOTHING. This trigger runs inside the auth
--      signup transaction, so any error here blocks account creation entirely.
--      Making the insert idempotent means a duplicate or replayed event can
--      never prevent someone from signing up.

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

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creates the public.users row for a new auth.users signup. Name fields are '
  'populated only from structured OAuth claims (given_name/family_name) and '
  'left NULL otherwise; onboarding is responsible for collecting them. '
  'Idempotent, so it cannot block signup on a replayed event.';;
