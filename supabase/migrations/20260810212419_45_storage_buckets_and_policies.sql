-- Storage buckets and policies.
--
-- PATH CONVENTION (fixed — changing it later means migrating objects):
--   checkin-photos : {user_id}/{goal_id}/{entry_id}.webp
--   avatars        : {user_id}/{filename}
--
-- The check-in path encodes owner AND goal so the policy can evaluate both the
-- shared-Circle rule and the not-hidden rule from the path alone, without
-- joining progress_entries on every object read.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('checkin-photos', 'checkin-photos', false, 10485760, array['image/webp']),
  ('avatars',        'avatars',        false,  2097152, array['image/webp'])
on conflict (id) do nothing;

-- Everything is normalized to WebP client-side before upload (section 9), so
-- restricting the bucket to image/webp means a client that skips conversion is
-- rejected by Storage rather than silently storing an unrenderable HEIC.
-- Neither bucket is public: both are governed entirely by the policies below.

-- ---------------------------------------------------------------------------
-- Can the current user see this check-in photo?
-- ---------------------------------------------------------------------------
-- Note this is NOT is_goal_hidden_in_group() applied per-Circle. Hiding is
-- per-Circle and a viewer may share several Circles with the owner, so the
-- correct rule is "readable if there exists AT LEAST ONE shared Circle where
-- this goal is not hidden". Evaluating a single Circle would hide a photo that
-- is legitimately visible elsewhere.
create function private.can_view_checkin_photo(p_owner uuid, p_goal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = p_owner
      and not private.is_goal_hidden_in_group(p_goal_id, mine.group_id)
  );
$$;

revoke execute on function private.can_view_checkin_photo(uuid, uuid) from public;
grant execute on function private.can_view_checkin_photo(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- checkin-photos
-- ---------------------------------------------------------------------------
-- Enforced as a Storage policy rather than only as API-layer masking, so the
-- restriction holds even if a client obtains a direct object URL.

create policy checkin_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'checkin-photos'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or private.can_view_checkin_photo(
           ((storage.foldername(name))[1])::uuid,
           ((storage.foldername(name))[2])::uuid
         )
    )
  );

create policy checkin_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'checkin-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and array_length(storage.foldername(name), 1) = 2
  );

create policy checkin_photos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'checkin-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy checkin_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'checkin-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- avatars — lower sensitivity, behaves like a profile picture
-- ---------------------------------------------------------------------------

create policy avatars_select on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars');

create policy avatars_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy avatars_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy avatars_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );;
