-- 81. Garbage collection for check-in photos, in both directions.
--
-- ## Two states step 13 can produce, and neither was reachable before it
--
-- **A file no row names.** `attachCheckinPhoto` is a separate step from the
-- upload, on purpose: the check-in wins and the photo is best effort, so an
-- upload that succeeds and an attach that fails leaves an object behind.
-- `undoCheckIn` can produce the same thing from the other end, because it
-- deletes the object first and deliberately continues if the row delete then
-- fails — someone who tapped Undo should not be refused because Storage was
-- briefly unavailable.
--
-- `job_list_expired_photos` cannot see any of these: it finds objects
-- **through** `photo_url`, so a file nothing points at is invisible to the one
-- job meant to clean it up. It would sit in a private bucket forever.
--
-- **A row naming a file that is gone.** The mirror image, reachable by the same
-- `undoCheckIn` path, and by any future writer that removes an object and then
-- fails to clear the column. Harmless to look at — the component says the link
-- expired — but the row goes on claiming something that cannot be true.
--
-- ## Why this is SQL rather than a Storage listing
--
-- `storage.objects` is an ordinary table. "Which files does no row reference"
-- is therefore a join, not a paginated crawl of the Storage API, and it is
-- exact rather than eventually consistent with itself.
--
-- ## The grace window is the safety-critical parameter
--
-- An object is only an orphan if nothing *will* reference it either. Between
-- the upload and `attachCheckinPhoto` there is a real gap — a slow phone on bad
-- signal — and a sweep with no grace would delete a photo someone had just
-- taken, with no message and nothing to recover.
--
-- **24 hours**, because the two mistakes are not symmetrical. An unreferenced
-- object is invisible to everyone and costs only storage, so waiting is nearly
-- free; deleting a live photo is not. With a daily schedule an orphan survives
-- up to two days, which nobody experiences.
--
-- Both helpers live in `public` with EXECUTE for `service_role` alone, for the
-- reason migration 50 records: PostgREST honours a schema header only for
-- schemas in its exposed list, and `private` deliberately is not one.

create function public.job_list_orphan_photos(
  p_grace_hours integer default 24,
  p_limit integer default 1000
)
returns table (name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'checkin-photos'
    and o.created_at < now() - make_interval(hours => p_grace_hours)
    and not exists (
      select 1 from public.progress_entries pe where pe.photo_url = o.name
    )
  order by o.created_at
  limit p_limit;
$$;

comment on function public.job_list_orphan_photos(integer, integer) is
  'Storage objects in checkin-photos that no progress_entries row references and that are older than the grace window. These are unreachable by job_list_expired_photos, which finds objects through photo_url. Called by purge-expired-photos.';

/**
 * The other direction: rows naming an object that is not there.
 *
 * Returns the count rather than the rows, because there is nothing for the
 * caller to do with them: the fix is the update itself, and Storage is not
 * involved. Unlike `job_mark_photos_purged`, which the edge function calls
 * *after* deleting files, this one removes nothing.
 */
create function public.job_null_missing_photos(p_limit integer default 1000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with stale as (
    select pe.id
    from public.progress_entries pe
    where pe.photo_url is not null
      and not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'checkin-photos' and o.name = pe.photo_url
      )
    limit p_limit
  )
  update public.progress_entries pe
     set photo_url = null
    from stale
   where pe.id = stale.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.job_null_missing_photos(integer) is
  'Clears photo_url on rows whose Storage object no longer exists. Reachable because undoCheckIn removes the object before the row and continues if the row delete fails. Deletes nothing; only stops rows claiming a photo that cannot be served.';

revoke execute on function public.job_list_orphan_photos(integer, integer) from public, anon, authenticated;
revoke execute on function public.job_null_missing_photos(integer)          from public, anon, authenticated;
grant  execute on function public.job_list_orphan_photos(integer, integer) to service_role;
grant  execute on function public.job_null_missing_photos(integer)         to service_role;

do $$
begin
  -- Callable by the job, and by nobody else. `job_null_missing_photos` writes,
  -- so a stray grant here would hand any signed-in user a way to blank other
  -- people's photo references.
  if not has_function_privilege('service_role', 'public.job_list_orphan_photos(integer, integer)', 'EXECUTE') then
    raise exception 'service_role cannot call job_list_orphan_photos';
  end if;
  if not has_function_privilege('service_role', 'public.job_null_missing_photos(integer)', 'EXECUTE') then
    raise exception 'service_role cannot call job_null_missing_photos';
  end if;

  if has_function_privilege('authenticated', 'public.job_list_orphan_photos(integer, integer)', 'EXECUTE') then
    raise exception 'authenticated can call job_list_orphan_photos';
  end if;
  if has_function_privilege('authenticated', 'public.job_null_missing_photos(integer)', 'EXECUTE') then
    raise exception 'authenticated can call job_null_missing_photos';
  end if;
  if has_function_privilege('anon', 'public.job_null_missing_photos(integer)', 'EXECUTE') then
    raise exception 'anon can call job_null_missing_photos';
  end if;
end;
$$;
