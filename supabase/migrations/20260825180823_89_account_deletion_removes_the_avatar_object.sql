-- 89. Account deletion removes the avatar object even when the column is null.
--
-- ## The hole, found by auditing 15f before commit
--
-- `job_scrub_and_list_user_media` listed the avatar to delete **only when
-- `users.avatar_url` was not null**:
--
--   select 'avatars', u.avatar_url from public.users u
--    where u.id = p_user_id and u.avatar_url is not null;
--
-- And "Remove picture" clears the column **without deleting the object** — one
-- fixed key per person, overwritten in place, so there is never more than one
-- and nothing is orphaned by a replacement. That was a reasonable decision on
-- its own and it composes into a bad one:
--
--   remove your picture  ->  column null, object retained
--   delete your account  ->  the scrub finds nothing to remove
--   result               ->  a photograph of someone's face outlives the
--                            account they deleted
--
-- **Two correct-looking choices, wrong together.** Neither file was wrong when
-- it was written; the failure lives in the seam, which is where this project
-- keeps finding them.
--
-- ## The fix
--
-- Emit the key **unconditionally**. It is deterministic — `<user_id>/avatar.jpg`,
-- pinned by `users_avatar_url_is_own_key` in migration 85 — so it can be
-- derived rather than looked up, and Storage treats removing an object that is
-- not there as a no-op the Edge Function already logs and moves past.
--
-- **Derived, not read.** Reading the column is what made the guarantee depend on
-- a value the person had just cleared. A deletion path must not ask permission
-- of the state it is deleting.
--
-- ## Why not delete the object when the picture is removed
--
-- Considered, and rejected again here. Clearing the column has one job — stop
-- rendering the picture — and adding a Storage round trip gives it a way to
-- fail at something the person did not ask for. Deletion is the guarantee, and
-- deletion now covers it.

create or replace function public.job_scrub_and_list_user_media(p_user_id uuid)
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
    -- **Unconditional, and derived from the id rather than read from the
    -- column.** `avatar_url` is null for anyone who removed their picture
    -- without replacing it, and the object is still there. The key is fixed by
    -- migration 85's CHECK, so it is knowable without the column; Storage
    -- ignores a remove for an object that does not exist.
    select 'avatars'::text, u.id::text || '/avatar.jpg'
    from public.users u
    where u.id = p_user_id;

  update public.progress_entries
  set note = null, photo_url = null
  where user_id = p_user_id;
end;
$$;

comment on function public.job_scrub_and_list_user_media(uuid) is
  'Scrubs note text and lists every Storage object belonging to a user, for delete-account. The avatar key is DERIVED from the user id rather than read from users.avatar_url: removing your picture clears the column and keeps the object, so reading it would let a deleted account leave its photograph behind. Migration 89.';

-- ---------------------------------------------------------------------------
-- Proof, rolled back.
--
-- **This calls the function, which scrubs notes and photo_urls for the probe
-- user.** Everything below happens inside a block whose exception handler rolls
-- it back, exactly as migrations 83 and 84 do; nothing survives.
-- ---------------------------------------------------------------------------
do $$
declare
  v_user uuid;
  v_avatars integer;
  v_path text;
begin
  select id into v_user from public.users limit 1;
  if v_user is null then
    raise notice 'no users to prove against; skipping';
    return;
  end if;

  -- The case that was broken: no avatar recorded at all.
  update public.users set avatar_url = null where id = v_user;

  select count(*), max(path) into v_avatars, v_path
  from public.job_scrub_and_list_user_media(v_user)
  where bucket = 'avatars';

  if v_avatars <> 1 then
    raise exception 'expected one avatar path with a null column, got %', v_avatars;
  end if;

  if v_path <> v_user::text || '/avatar.jpg' then
    raise exception 'the derived avatar key is %, expected %',
      v_path, v_user::text || '/avatar.jpg';
  end if;

  raise exception 'rollback: migration 89 proof complete';
exception
  when others then
    if sqlerrm <> 'rollback: migration 89 proof complete' then
      raise;
    end if;
end;
$$;
