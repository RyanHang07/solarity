-- 94. Two reads the dashboard needs and 93 did not provide.
--
-- ## `am_i_admin()`, because the app has to gate a route
--
-- `private.is_admin()` is revoked from `authenticated` and the `private` schema
-- is not exposed, so **nothing in the application can ask the question it needs
-- to answer before rendering `/admin`**. The alternative was calling
-- `admin_report_queue()` and treating the raise as a no — which works, and
-- makes an expected outcome arrive as an exception on every page load by a
-- non-admin.
--
-- It reveals only whether *you* are an admin. There is no argument, so it
-- cannot be asked about anyone else.
--
-- ## `admin_list_admins()`, because revoking needs a list
--
-- 93 can grant and revoke, and nothing could enumerate. An admin-only UI for a
-- privilege you cannot see the holders of is not reviewable.

create function public.am_i_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin();
$$;

comment on function public.am_i_admin() is
  'Whether the caller is a site admin. No argument, so it cannot be asked about anyone else. Exists because private.is_admin() is unreachable from the application and /admin has to gate before it renders.';

create function public.admin_list_admins()
returns table (user_id uuid, username text, display_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Not an administrator'
      using errcode = 'insufficient_privilege', hint = 'NOT_SITE_ADMIN';
  end if;

  return query
    select u.id, u.username, u.display_name
    from public.users u
    where u.role = 'admin'
    order by u.username;
end;
$$;

revoke execute on function public.am_i_admin() from public, anon;
revoke execute on function public.admin_list_admins() from public, anon;
grant execute on function public.am_i_admin() to authenticated;
grant execute on function public.admin_list_admins() to authenticated;

do $$
declare
  v_a uuid;
  v_refused boolean := false;
begin
  select id into v_a from public.users limit 1;
  if v_a is null then
    raise notice 'no users; skipping';
    return;
  end if;

  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_a::text)::text, true);

  if public.am_i_admin() then
    raise exception 'a standard user reported as admin';
  end if;

  begin
    perform * from public.admin_list_admins();
  exception when insufficient_privilege then v_refused := true;
  end;
  if not v_refused then
    raise exception 'a standard user listed the admins';
  end if;

  update public.users set role = 'admin' where id = v_a;

  if not public.am_i_admin() then
    raise exception 'an admin did not report as admin';
  end if;
  if (select count(*) from public.admin_list_admins()) <> 1 then
    raise exception 'the admin list did not contain the one admin';
  end if;

  raise exception 'rollback: migration 94 proof complete';
exception
  when others then
    if sqlerrm <> 'rollback: migration 94 proof complete' then
      raise;
    end if;
end;
$$;
