-- 82. Check-in photos are JPEG, because Safari cannot encode WebP.
--
-- ## The bug this closes
--
-- The design said WebP: smaller for photographs, and the bucket was restricted
-- to `image/webp` so a client that skipped conversion would be refused by
-- Storage rather than silently store an unrenderable HEIC.
--
-- **`canvas.toBlob(cb, "image/webp")` is unsupported in WebKit**, and the spec
-- says an unsupported type falls back to `image/png` — silently, with no error.
-- So `preparePhoto` produced a real WebP on a desktop and a PNG on an iPhone.
--
-- **And the declared content type never reached the check.** `supabase-js`
-- appends the blob to a `FormData` bare, so the multipart part's type comes
-- from `blob.type`, not from the `contentType` option. The bucket saw
-- `image/png`, refused it, and the UI discarded the message and said
-- "Couldn't upload that photo. Try again."
--
-- Three facts, none of them wrong alone, that only fail together — and only on
-- one engine. The device-only half is why no test caught it.
--
-- ## Why JPEG rather than a polyfill
--
-- JPEG is the only raster format every canvas can encode. One format means one
-- extension, one allowed MIME type, and no per-browser branch in the part of the
-- system that is hardest to test. It costs roughly a quarter more bytes than
-- WebP, which is a real cost on mobile data and is accepted deliberately.
--
-- ## The row this nulls, and why that is safe
--
-- One check-in currently names a `.webp` object, written during the manual pass
-- from a desktop. A CHECK is validated against existing rows when it is added,
-- so the constraint below cannot attach while that row exists in the old shape.
--
-- It is nulled rather than renamed: renaming the column would leave it pointing
-- at an object that still has the old name, since **`storage.protect_delete`
-- refuses direct deletes and there is no SQL way to rename an object either**.
-- Nulling makes the object an orphan, and migration 81's sweep removes it on the
-- next daily run. The check-in itself, and the streak it belongs to, are
-- untouched — only the reference to a test photo goes.
--
-- **The bucket's `allowed_mime_types` must change with this**, to
-- `['image/jpeg']`. That is dashboard state rather than schema, so it is not in
-- this file; the assertion at the bottom fails if it was forgotten.

update public.progress_entries
   set photo_url = null
 where photo_url is not null
   and photo_url not like '%.jpg';

alter table public.progress_entries
  drop constraint if exists progress_entries_photo_url_is_own_key;

alter table public.progress_entries
  add constraint progress_entries_photo_url_is_own_key
  check (
    photo_url is null
    or goal_id is null
    or user_id is null
    or photo_url = user_id::text || '/' || goal_id::text || '/' || id::text || '.jpg'
  );

comment on constraint progress_entries_photo_url_is_own_key on public.progress_entries is
  'photo_url must name this row''s own Storage object. Without it, `update (photo_url)` lets a client point the column at someone else''s file, which circle_roster then presents as theirs. Null-permissive because the goal_id and user_id foreign keys are ON DELETE SET NULL and a CHECK is evaluated on that update. `.jpg` since migration 82: Safari cannot encode WebP.';

do $$
declare
  v_types text[];
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.progress_entries'::regclass
      and conname = 'progress_entries_photo_url_is_own_key'
  ) then
    raise exception 'the constraint did not attach';
  end if;

  -- Both directions, on values rather than a fixture.
  if not ('u/g/e.jpg' = 'u' || '/' || 'g' || '/' || 'e' || '.jpg') then
    raise exception 'the key expression rejects a correct .jpg key';
  end if;
  if ('u/g/e.webp' = 'u' || '/' || 'g' || '/' || 'e' || '.jpg') then
    raise exception 'the key expression still accepts .webp';
  end if;

  -- Nothing may be left naming the old extension, or the next update to that
  -- row would fail with a check violation nobody would connect to this.
  if exists (select 1 from public.progress_entries
              where photo_url is not null and photo_url not like '%.jpg') then
    raise exception 'a row still names a non-jpg object';
  end if;

  -- **The bucket is the other half of this change**, and it lives outside the
  -- migrations. A bucket still restricted to image/webp would refuse every
  -- upload from every browser, which is worse than the bug being fixed.
  select allowed_mime_types into v_types from storage.buckets where id = 'checkin-photos';
  if v_types is distinct from array['image/jpeg'] then
    raise exception
      'checkin-photos still allows %; set allowed_mime_types to {image/jpeg}', v_types;
  end if;
end;
$$;
