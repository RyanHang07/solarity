-- 85. `users.avatar_url` holds a Storage key you own, and nothing else.
--
-- ## Three problems in one column, found while planning 15f
--
-- The column has never had a writer in the app, and it is not empty. Both
-- existing accounts carry a **Google profile-picture URL**, copied at signup by
-- `handle_new_user` from `raw_user_meta_data`.
--
-- **1. Those URLs cannot render.** The CSP's `img-src` is `'self' data: blob:`
-- plus the Supabase origin. `lh3.googleusercontent.com` is not on it, so every
-- one of them is a blocked request and a violation report.
--
-- **2. Nobody chose to publish them.** Step 15 makes profiles visible to any
-- signed-in user. Shipping that on top of this column would take a photo the
-- person gave to Google in order to sign in, and show it to strangers.
--
-- **3. The column is forgeable.** `authenticated` holds `update (avatar_url)`
-- and there is no CHECK, so a client can point it at any key in the bucket —
-- including `<someone else's uid>/avatar.jpg`. The storage policies stop you
-- *writing* into another person's folder; nothing stopped you *naming* it.
--
-- That third one is migration 80 again, for a different column. Same hole,
-- found the same way, closed the same way.
--
-- ## What this does
--
-- Nulls the two remote URLs, stops the trigger copying new ones, and pins the
-- column to `<your id>/…`. After this there is exactly one kind of value in it
-- and exactly one way to render it.
--
-- **The alternative was allowing both a key and an https URL.** Rejected: it
-- costs a CSP widening to a third-party image host, two render paths, a weaker
-- CHECK, and a request to Google every time any signed-in user opens that
-- profile.
--
-- ## Deletion already handles it
--
-- `job_scrub_and_list_user_media` has returned `('avatars', u.avatar_url)`
-- since migration 50, so `delete-account` already removes the object. It was
-- previously being handed an https URL as an object path, which Storage would
-- treat as a missing object and warn about — now it is handed a real key.

-- ---------------------------------------------------------------------------
-- 1. Clear what is there. Two rows, neither of which was ever renderable.
-- ---------------------------------------------------------------------------
update public.users
   set avatar_url = null
 where avatar_url is not null;

-- ---------------------------------------------------------------------------
-- 2. Stop the trigger seeding new ones.
--
-- Only the `avatar_url` argument changes; `display_name` is left exactly as it
-- was, because a name typed into Google's consent screen is a name the person
-- chose to give, and it is not published to strangers by this step.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, display_name, avatar_url)
  values (
    new.id,
    nullif(
      btrim(left(coalesce(
        new.raw_user_meta_data ->> 'display_name',  -- our own signup form
        new.raw_user_meta_data ->> 'full_name',     -- Google
        new.raw_user_meta_data ->> 'name'           -- last resort
      ), 50)),
      ''
    ),
    -- **Deliberately null, since migration 85.** This used to copy
    -- `raw_user_meta_data ->> 'avatar_url'`, which is a Google URL: blocked by
    -- our own CSP, and a photo the person handed to Google to sign in rather
    -- than one they chose to publish. Avatars are uploaded, or absent.
    null
  )
  on conflict (id) do nothing;

  insert into public.user_lifetime_stats (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Pin the shape.
--
-- Null-permissive: no avatar is the default and the common case. The rule is
-- only about what a non-null value may name.
-- ---------------------------------------------------------------------------
alter table public.users
  add constraint users_avatar_url_is_own_key
  check (avatar_url is null or avatar_url like id::text || '/%');

comment on constraint users_avatar_url_is_own_key on public.users is
  'avatar_url must name an object inside this user''s own folder in the avatars bucket. Without it, `update (avatar_url)` lets a client point the column at someone else''s object and the profile renders their face as its own — migration 80''s hole, in a second column. Never an https URL: the CSP blocks third-party image hosts and a Google avatar is not a picture anyone chose to publish.';

-- ---------------------------------------------------------------------------
-- Proof, rolled back.
-- ---------------------------------------------------------------------------
do $$
declare
  v_user uuid;
  v_other uuid;
  v_types text[];
begin
  if exists (select 1 from public.users where avatar_url is not null) then
    raise exception 'a remote avatar_url survived the update';
  end if;

  select id into v_user from public.users limit 1;
  select id into v_other from public.users where id <> v_user limit 1;

  if v_user is null then
    raise notice 'no users to prove against; skipping';
  else
    -- The control: your own key is accepted.
    update public.users set avatar_url = v_user::text || '/avatar.jpg' where id = v_user;
    if (select avatar_url from public.users where id = v_user) is null then
      raise exception 'a valid own key did not take';
    end if;

    -- A remote URL is refused, which is the case that existed in the table.
    begin
      update public.users set avatar_url = 'https://lh3.googleusercontent.com/a/x'
       where id = v_user;
      raise exception 'an https avatar_url was accepted';
    exception
      when check_violation then null;
    end;

    -- **The one that matters.** Naming another user's folder is refused.
    if v_other is not null then
      begin
        update public.users set avatar_url = v_other::text || '/avatar.jpg'
         where id = v_user;
        raise exception 'a key in another user''s folder was accepted';
      exception
        when check_violation then null;
      end;
    end if;

    -- A bare filename with no folder is refused too: `storage.foldername`
    -- would return no first element and the policy comparison would be null.
    begin
      update public.users set avatar_url = 'avatar.jpg' where id = v_user;
      raise exception 'a folderless key was accepted';
    exception
      when check_violation then null;
    end;
  end if;

  -- **The bucket is the other half of this change**, and it lives outside the
  -- migrations. `image/webp` is the trap migration 82 was written to escape:
  -- Safari cannot encode WebP and falls back to PNG silently, so an iPhone
  -- would be refused by Storage and the UI would have to explain a message it
  -- never sees.
  select allowed_mime_types into v_types from storage.buckets where id = 'avatars';
  if v_types is distinct from array['image/jpeg'] then
    raise exception
      'the avatars bucket still allows %; set allowed_mime_types to {image/jpeg}', v_types;
  end if;

  raise exception 'rollback: migration 85 proof complete';
exception
  when others then
    if sqlerrm <> 'rollback: migration 85 proof complete' then
      raise;
    end if;
end;
$$;
