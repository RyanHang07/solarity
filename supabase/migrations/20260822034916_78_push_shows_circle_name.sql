alter table public.users
  add column push_shows_circle_name boolean not null default true;

comment on column public.users.push_shows_circle_name is
  'Whether a push body may name the Circle it is about. Default true: a notification nobody can attribute is not a prompt. False keeps lock screens contentless, which matters when a Circle name is itself sensitive.';

-- `users` carries COLUMN-level grants since migration 75, so a new column is
-- invisible and unwritable until it is named. Both directions, deliberately.
grant select (push_shows_circle_name) on public.users to authenticated;
grant update (push_shows_circle_name) on public.users to authenticated;

do $$
begin
  if not has_column_privilege('authenticated', 'public.users', 'push_shows_circle_name', 'SELECT') then
    raise exception 'authenticated cannot read its own push_shows_circle_name';
  end if;
  if not has_column_privilege('authenticated', 'public.users', 'push_shows_circle_name', 'UPDATE') then
    raise exception 'authenticated cannot set its own push_shows_circle_name';
  end if;

  -- anon reads nothing here, and never has.
  if has_column_privilege('anon', 'public.users', 'push_shows_circle_name', 'SELECT') then
    raise exception 'anon can read push_shows_circle_name';
  end if;

  -- The guard migration 75 and 76 both carry: adding a column must not have
  -- widened anything else. A table-level grant would make every future column
  -- readable the moment it exists, which is the bug 75 fixed.
  if has_column_privilege('authenticated', 'public.users', 'pending_checkin_timezone', 'SELECT') then
    raise exception 'pending_checkin_timezone became readable';
  end if;
  if has_column_privilege('authenticated', 'public.users', 'last_rollover_date', 'SELECT') then
    raise exception 'last_rollover_date became readable';
  end if;
end;
$$;
