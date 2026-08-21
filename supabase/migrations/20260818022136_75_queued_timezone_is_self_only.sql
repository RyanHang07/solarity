-- 75. A queued timezone is nobody else's business, and `users` gets the
-- column-level grants it was assumed to already have.
--
-- ## Two problems, one cause
--
-- `users_select_self_or_groupmate` is a ROW policy. Grants are per COLUMN. So
-- anything readable at all is readable by every circle-mate, and migration 74's
-- `pending_checkin_timezone` announced a trip you had not taken yet.
--
-- The fix would not take. **`authenticated` held a TABLE-level SELECT on
-- `public.users`**, so a column-level revoke removed nothing, and 74's
-- `grant select (pending_checkin_timezone)` had been redundant from the start —
-- its assertion passed for the wrong reason.
--
-- This matters beyond one column: with a table grant, **every column ever added
-- to `users` is readable by circle-mates the moment it exists**. `goals` has
-- always been explicit, which is why adding `hidden_everywhere` in 71 needed a
-- deliberate grant and could not have leaked by default. `users` should work
-- the same way.
--
-- ## What stays readable
--
-- Exactly what the app selects today: `username` and `display_name` for
-- rosters, `avatar_url` for when it renders, `checkin_timezone` because the
-- roster explains its counts with it, and `id` to join on.
--
-- Dropped: `created_at`, `updated_at`, `last_rollover_date`,
-- `checkin_day_started_at` and `pending_checkin_timezone`. No client query
-- names any of them, and the first four are rollover bookkeeping that no member
-- has a reason to see. Anything needed later gets granted on purpose.
--
-- `SECURITY DEFINER` functions are unaffected: they run as the owner, so
-- `export_user_data`, `circle_roster` and the rollover keep working.

revoke select on public.users from authenticated;

grant select (id, username, display_name, avatar_url, checkin_timezone)
  on public.users to authenticated;

create or replace function public.my_pending_checkin_timezone()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.pending_checkin_timezone
  from public.users u
  where u.id = (select auth.uid());
$$;

comment on function public.my_pending_checkin_timezone() is
  'Your own queued timezone, or null. Exists because a column grant cannot be self-only: users_select_self_or_groupmate is row-level, so any readable column is readable by every circle-mate. Scoped to auth.uid() and nothing else.';

revoke all on function public.my_pending_checkin_timezone() from public;
revoke all on function public.my_pending_checkin_timezone() from anon;
grant execute on function public.my_pending_checkin_timezone() to authenticated;

do $$
declare c text;
begin
  -- Off, including via any table-level grant. `has_column_privilege` answers
  -- the question that matters rather than the one the catalog makes easy.
  foreach c in array array['pending_checkin_timezone','checkin_day_started_at',
                           'last_rollover_date','created_at','updated_at']
  loop
    if has_column_privilege('authenticated', 'public.users', c, 'SELECT') then
      raise exception 'authenticated can still read users.%', c;
    end if;
  end loop;

  -- On, because the app reads them.
  foreach c in array array['id','username','display_name','avatar_url','checkin_timezone']
  loop
    if not has_column_privilege('authenticated', 'public.users', c, 'SELECT') then
      raise exception 'authenticated lost users.%, which the app reads', c;
    end if;
  end loop;

  if has_column_privilege('anon', 'public.users', 'username', 'SELECT') then
    raise exception 'anon can read users';
  end if;

  if not has_function_privilege('authenticated', 'public.my_pending_checkin_timezone()', 'EXECUTE') then
    raise exception 'authenticated cannot call my_pending_checkin_timezone';
  end if;
  if has_function_privilege('anon', 'public.my_pending_checkin_timezone()', 'EXECUTE') then
    raise exception 'anon can call my_pending_checkin_timezone';
  end if;
end;
$$;
