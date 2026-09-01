-- 91. Site-wide roles, so `content_reports` can finally have a reader.
--
-- ## The gap this opens the door to
--
-- Reporting shipped in 15e with a writer and no reader: reports land in a table
-- nobody can see. That is 8h in the other direction and the thing step 15 was
-- meant to stop doing. A moderation surface needs to know who is allowed to
-- moderate, and nothing in the schema could say.
--
-- ## `user_role`, not `group_member_role`
--
-- There is already an `admin` in this database: `group_member_role` is
-- `owner | admin | member` and means *admin of one Circle*. **These are
-- different powers and must never be confused** — a Circle admin manages an
-- invite link, a site admin reads other people's reported content. Separate
-- enum, separate column, and the audit values in migration 92 are named
-- `site_admin_*` for the same reason.
--
-- ## The column is not readable or writable by anyone
--
-- `authenticated` holds `update (avatar_url, display_name, push_shows_circle_name,
-- today_screen_mode)` on `public.users` and **`role` is deliberately not added
-- to that list**. Nor is it added to the SELECT grant, so no client can read
-- anyone's role either — not their own, not somebody else's.
--
-- Every admin path is a `SECURITY DEFINER` function that asks `is_admin()`
-- first. That is the same shape as `circle_roster` and `profile_by_username`:
-- the base table stays shut and one function decides.
--
-- **No policies are added here on purpose.** A policy would be a second place
-- the rule lives; the functions in migration 93 are the only door.
--
-- ## The first admin comes from SQL
--
-- Nothing in the app can create the first one, because there is nobody to
-- authorise it. It is one statement in the dashboard:
--
--   update public.users set role = 'admin' where username = '...';
--
-- Migration 93 adds promotion *by an existing admin*, audited, with a guard
-- against removing the last one.

create type public.user_role as enum ('standard', 'admin');

alter table public.users
  add column role public.user_role not null default 'standard';

comment on column public.users.role is
  'Site-wide role, distinct from group_member_role which is per-Circle. Deliberately absent from the SELECT and UPDATE grants to `authenticated`: nobody can read or write it through PostgREST, and every admin path is a SECURITY DEFINER function that calls private.is_admin(). Set the first one with SQL.';

/**
 * Is the caller a site admin?
 *
 * `private`, so PostgREST cannot address it — the schema is not exposed.
 * `stable` because it is read many times in one statement.
 *
 * **Returns false for an unauthenticated caller** rather than raising, so it
 * composes inside a `where` clause without needing a null guard at every call
 * site. A function that must refuse loudly raises on its own.
 */
create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users u
    where u.id = (select auth.uid())
      and u.role = 'admin'
  );
$$;

revoke execute on function private.is_admin() from public, anon, authenticated;

do $$
declare
  v_user uuid;
  v_grants text[];
begin
  /**
   * **The assertion that matters most in this file.** A `role` column that
   * `authenticated` could read or write would let anyone make themselves an
   * admin with one PATCH, and it would look exactly like a working feature.
   *
   * **SELECT, INSERT and UPDATE only.** The first version of this checked for
   * *any* grant and failed: `authenticated` holds `REFERENCES` on every column
   * of `public.users`, from a table-level grant. REFERENCES permits creating a
   * foreign key that points at the column and permits neither reading nor
   * writing it, so it is not the privilege this is guarding against — and a
   * check that refuses it would be refusing the wrong thing loudly.
   */
  select array_agg(privilege_type) into v_grants
  from information_schema.role_column_grants
  where table_schema = 'public' and table_name = 'users'
    and grantee = 'authenticated' and column_name = 'role'
    and privilege_type in ('SELECT', 'INSERT', 'UPDATE');

  if v_grants is not null then
    raise exception 'authenticated has % on users.role; it must have none', v_grants;
  end if;

  select id into v_user from public.users limit 1;
  if v_user is null then
    raise notice 'no users; skipping the behaviour check';
    return;
  end if;

  -- Default is standard, and a fresh account is not an admin.
  if (select count(*) from public.users where role <> 'standard') <> 0 then
    raise exception 'a user already holds a non-default role';
  end if;

  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_user::text)::text, true);

  if private.is_admin() then
    raise exception 'a standard user reported as admin';
  end if;

  update public.users set role = 'admin' where id = v_user;

  if not private.is_admin() then
    raise exception 'an admin did not report as admin';
  end if;

  -- No caller at all is not an admin, and must not raise.
  perform set_config('request.jwt.claims', '', true);
  if private.is_admin() then
    raise exception 'is_admin() answered true with no caller';
  end if;

  raise exception 'rollback: migration 91 proof complete';
exception
  when others then
    if sqlerrm <> 'rollback: migration 91 proof complete' then
      raise;
    end if;
end;
$$;
