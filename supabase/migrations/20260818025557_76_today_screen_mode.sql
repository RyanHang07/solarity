-- 76. How often the daily check-in screen greets you.
--
-- ## What this is
--
-- Step 9 puts `/today` between sign-in and the dashboard when the day is
-- unfinished. Three settings, because "every morning" and "leave me alone" are
-- both reasonable and neither should be assumed:
--
--   every_open  — once per browser session, whenever the day is unfinished
--   once_daily  — once per check-in date (the default)
--   never       — never diverts; /today stays reachable by link
--
-- **The screen never appears on a finished day, whatever the setting.** That is
-- why the first value is not called `always`.
--
-- ## What is NOT here
--
-- "I have already seen it today" is a **cookie**, not a column. It is a device
-- fact rather than an account fact, and putting it here would mean a write on a
-- page render — the first read path in this app that writes. The cost is seeing
-- the screen once per device per day, which is defensible: you check in from
-- whichever device you have.
--
-- ## Grants
--
-- `SELECT` and `UPDATE` for `authenticated`, because the settings page reads it
-- and writes it directly; there is nothing here a `SECURITY DEFINER` function
-- would add, unlike `pending_checkin_timezone`, which had to be hidden.
--
-- **Circle-mates can therefore read it**, since `users_select_self_or_groupmate`
-- is row-level and grants are per column. Stated rather than discovered: this is
-- a display preference and leaking it reveals nothing. Migration 75 is the
-- precedent for anything that would.

create type public.today_screen_mode as enum ('every_open', 'once_daily', 'never');

comment on type public.today_screen_mode is
  'How often /today diverts the dashboard on an unfinished day. Never diverts on a finished one, which is why the first value is not "always".';

alter table public.users
  add column today_screen_mode public.today_screen_mode not null default 'once_daily';

comment on column public.users.today_screen_mode is
  'Per-account. The matching "seen it today" marker is a cookie, deliberately: it is a device fact, and a column would mean writing during a page render.';

grant select (today_screen_mode), update (today_screen_mode)
  on public.users to authenticated;

do $$
begin
  if not has_column_privilege('authenticated','public.users','today_screen_mode','SELECT') then
    raise exception 'authenticated cannot read today_screen_mode';
  end if;
  if not has_column_privilege('authenticated','public.users','today_screen_mode','UPDATE') then
    raise exception 'authenticated cannot write today_screen_mode';
  end if;
  if has_column_privilege('anon','public.users','today_screen_mode','SELECT') then
    raise exception 'anon can read today_screen_mode';
  end if;

  -- Migration 75 replaced the table-level SELECT with named columns. If this
  -- ever passes, that has been undone and every column is public again.
  if has_column_privilege('authenticated','public.users','pending_checkin_timezone','SELECT') then
    raise exception 'the users table grant is back: pending_checkin_timezone is readable again';
  end if;

  if (select count(*) from public.users where today_screen_mode <> 'once_daily') > 0 then
    raise exception 'existing rows did not default to once_daily';
  end if;
end;
$$;
