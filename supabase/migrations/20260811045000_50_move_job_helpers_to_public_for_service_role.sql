-- BUG 2: purge-expired-photos and delete-account called private.* functions via
-- supabase-js `.schema("private").rpc(...)`. PostgREST only honours a schema
-- header for schemas listed in its exposed-schemas config, and `private` is
-- deliberately not one — so those calls could never have worked.
--
-- Exposing `private` would hand clients the RLS-bypassing helpers it exists to
-- hide. Instead, the three functions that are only ever called from Edge
-- Functions move to `public`, with EXECUTE granted to service_role ALONE.
--
-- A public function with no anon/authenticated grant is unreachable by clients:
-- PostgREST resolves it, then Postgres refuses. It also stays off the linter's
-- SECURITY DEFINER report, which only flags functions those two roles can call.

create function public.job_list_expired_photos(p_days integer default 90, p_limit integer default 1000)
returns table (entry_id uuid, path text)
language sql
stable
security definer
set search_path = ''
as $$
  select pe.id, pe.photo_url
  from public.progress_entries pe
  where pe.photo_url is not null
    and pe.check_in_date < (current_date - p_days)
  order by pe.check_in_date
  limit p_limit;
$$;

create function public.job_mark_photos_purged(p_entry_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  update public.progress_entries set photo_url = null where id = any(p_entry_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function public.job_scrub_and_list_user_media(p_user_id uuid)
returns table (bucket text, path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    select 'checkin-photos'::text, pe.photo_url
    from public.progress_entries pe
    where pe.user_id = p_user_id and pe.photo_url is not null
    union all
    select 'avatars'::text, u.avatar_url
    from public.users u
    where u.id = p_user_id and u.avatar_url is not null;

  update public.progress_entries
  set note = null, photo_url = null
  where user_id = p_user_id;
end;
$$;

-- Reachable by the trusted server role only.
revoke execute on function public.job_list_expired_photos(integer, integer) from public, anon, authenticated;
revoke execute on function public.job_mark_photos_purged(uuid[])            from public, anon, authenticated;
revoke execute on function public.job_scrub_and_list_user_media(uuid)       from public, anon, authenticated;

grant execute on function public.job_list_expired_photos(integer, integer) to service_role;
grant execute on function public.job_mark_photos_purged(uuid[])            to service_role;
grant execute on function public.job_scrub_and_list_user_media(uuid)       to service_role;

-- The private.* originals are now unused; drop them rather than leave two
-- copies of the same logic to drift apart.
drop function private.list_expired_photos(integer, integer);
drop function private.mark_photos_purged(uuid[]);
drop function private.scrub_and_list_user_media(uuid);

comment on function public.job_list_expired_photos(integer, integer) is
  'Job-only. In public because Edge Functions reach it over PostgREST, which '
  'cannot address the private schema. Unreachable by clients: no anon or '
  'authenticated grant.';;
