-- 79. The roster reports check-in photos.
--
-- ## Why this is the first migration step 13 needs
--
-- Everything else about photos has existed since 45 and 64: both buckets, the
-- read policy through `private.can_view_checkin_photo`, the insert policy
-- narrowed to `private.owns_active_goal`, and the 90-day purge. What has never
-- existed is any way for a *Circle member* to learn that a photo is there.
-- `circle_roster` returns `id`, `title`, `hidden`, `checked`, `note`,
-- `entry_id` and `note_shared`, and nothing else.
--
-- ## A boolean would not have worked, though it looks like it would
--
-- The object key is `{user_id}/{goal_id}/{entry_id}.webp`, and **`entry_id` is
-- returned only for your own rows** — migration 72 scoped it that way on
-- purpose. A viewer handed `has_photo: true` could not name the object it
-- refers to. So this returns the masked `photo_url`, which is the key the
-- column already stores and the same value `job_list_expired_photos` hands
-- straight to Storage.
--
-- **A key is a name, not a door.** The bucket is private; holding the key gets
-- you nothing without a signed URL, and signing one still has to pass
-- `checkin_photos_select`.
--
-- ## The masking rule, and where it deliberately differs
--
-- `photo_url` is masked **exactly like `note`, minus the opt-in**:
--
--   * yours, always. Migration 72 established that masking never applies to
--     yourself, having found `can_view_checkin_photo` hiding a user's own photo
--     from them.
--   * someone else's, only when the goal is not hidden **in this Circle**.
--   * `note` additionally requires `note_shared`. **A photo has no such flag,
--     and that asymmetry is intended.** `note_shared` exists because a note is
--     a sentence you might not want read; a photo is the proof, so a photo
--     nobody can see is a photo nobody asked for. Hiding the goal is the
--     control, and there is no second switch. If that ever changes it is a
--     column, a grant, a change to `can_view_checkin_photo` and a second tick
--     box — not a small edit here.
--
-- **This is not the same rule the Storage policy applies, and that is correct.**
-- `can_view_checkin_photo` serves a photo when **at least one** shared Circle
-- can see the goal, because a Storage request cannot say which Circle it is
-- about. This function masks per Circle, because a Circle where you hid a goal
-- should not show its photo. So the same photo can be withheld here and served
-- by a direct signed URL. Both are right for their own job. Do not "fix" one by
-- copying the other: migration 71 had to undo exactly that, where
-- `circle_roster` re-implemented a hiding rule inline and the two copies agreed
-- only while each was one line.
--
-- ## What changed in the body
--
-- Unchanged from migration 72 except:
--   * `active_goal` gains `photo_present`, a plain `pe.photo_url is not null`,
--   * `active_goal` gains `photo_key`,
--   * the jsonb gains `photo_url`.
--
-- The visibility test is written in the **outer** select against `ag.hidden`
-- and `ag.is_self`, which are already computed, rather than calling
-- `private.is_goal_hidden_in_group` a third time. The `note` case above calls
-- it once more because a select list cannot reference its own output column;
-- there is no reason to pay that again.

create or replace function public.circle_roster(p_group_id uuid)
returns table (
  user_id uuid,
  username text,
  display_name text,
  role text,
  is_self boolean,
  streak_grace boolean,
  circle_status text,
  as_of timestamptz,
  checkin_date date,
  checked_count integer,
  total_count integer,
  goals jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status public.group_status;
  v_as_of timestamptz;
  v_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated'
      using errcode = 'insufficient_privilege', hint = 'NOT_AUTHENTICATED';
  end if;

  if not private.is_group_member(p_group_id) then
    raise exception 'You are not a member of this Circle'
      using errcode = 'insufficient_privilege', hint = 'NOT_A_MEMBER';
  end if;

  select g.group_status into v_status from public.groups g where g.id = p_group_id;

  if v_status <> 'active' then
    select max(gc.ended_at) into v_as_of
    from public.group_cycles gc where gc.group_id = p_group_id;

    if v_as_of is null then
      select g.updated_at into v_as_of from public.groups g where g.id = p_group_id;
    end if;
  end if;

  v_at := coalesce(v_as_of, now());

  return query
  with member as (
    select gm.user_id, gm.role::text as role, gm.joined_at, gm.streak_grace,
           private.checkin_date_at(gm.user_id, v_at) as checkin_date
    from public.group_members gm
    where gm.group_id = p_group_id
  ),
  active_goal as (
    select m.user_id, g.id as goal_id, g.title, m.checkin_date,
           m.user_id = v_uid as is_self,
           private.is_goal_hidden_in_group(g.id, p_group_id) as hidden,
           pe.id is not null as checked,
           case when m.user_id = v_uid then pe.id else null end as entry_id,
           case when m.user_id = v_uid then coalesce(pe.note_shared, false)
                else false end as note_shared,
           -- Split in two so the outer select can apply the visibility test
           -- against `hidden` and `is_self` without re-deriving either.
           pe.photo_url is not null as photo_present,
           pe.photo_url as photo_key,
           case
             when pe.note is null then null
             when m.user_id = v_uid then pe.note
             when pe.note_shared
              and not private.is_goal_hidden_in_group(g.id, p_group_id) then pe.note
             else null
           end as note
    from member m
    join public.goals g on g.user_id = m.user_id
    left join public.progress_entries pe
           on pe.goal_id = g.id
          and pe.check_in_date = m.checkin_date
          and pe.created_at <= v_at
    where g.created_at <= v_at
      and (g.archived_at is null or g.archived_at > v_at)
      and (g.achieved_at is null or g.achieved_at > v_at)
  )
  select m.user_id,
         u.username,
         u.display_name,
         m.role,
         m.user_id = v_uid as is_self,
         m.streak_grace,
         v_status::text as circle_status,
         v_as_of as as_of,
         m.checkin_date,
         coalesce(count(*) filter (where ag.checked), 0)::integer as checked_count,
         coalesce(count(ag.goal_id), 0)::integer as total_count,
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', ag.goal_id,
               'title', case when ag.hidden and not ag.is_self then null
                             else ag.title end,
               'hidden', ag.hidden,
               'checked', ag.checked,
               'note', ag.note,
               'entry_id', ag.entry_id,
               'note_shared', ag.note_shared,
               -- Yours always; someone else's only when the goal is not hidden
               -- in this Circle. No `photo_shared` term, deliberately.
               'photo_url', case
                              when not ag.photo_present then null
                              when ag.is_self then ag.photo_key
                              when ag.hidden then null
                              else ag.photo_key
                            end
             )
             order by ag.hidden, ag.title
           ) filter (where ag.goal_id is not null),
           '[]'::jsonb
         ) as goals
  from member m
  join public.users u on u.id = m.user_id
  left join active_goal ag on ag.user_id = m.user_id
  group by m.user_id, u.username, u.display_name, m.role, m.streak_grace,
           m.checkin_date, m.joined_at
  order by (m.user_id = v_uid) desc, m.joined_at asc;
end;
$$;

comment on function public.circle_roster(uuid) is
  'One row per member with their active goals for the day. Masks title, note and photo_url for goals hidden in this Circle; never masks your own row (migration 72). photo_url is the Storage object key, not a URL: the bucket is private and checkin_photos_select still governs every read.';

do $$
declare
  v_def text := pg_get_functiondef('public.circle_roster(uuid)'::regprocedure);
begin
  -- `create or replace` at an unchanged signature keeps grants, but assert it
  -- rather than trust it: a changed signature would be a new object with none,
  -- and the failure would surface as a bare 42501 somewhere else entirely.
  if not has_function_privilege('authenticated', 'public.circle_roster(uuid)', 'EXECUTE') then
    raise exception 'authenticated lost EXECUTE on circle_roster';
  end if;
  if has_function_privilege('anon', 'public.circle_roster(uuid)', 'EXECUTE') then
    raise exception 'anon gained EXECUTE on circle_roster';
  end if;

  -- The deployed body is the one this file describes. Cheap, and it is the
  -- check that catches a migration written here and never applied, or applied
  -- from an older copy.
  if v_def not like '%''photo_url'', case%' then
    raise exception 'circle_roster does not emit photo_url';
  end if;
  if v_def not like '%photo_present%' then
    raise exception 'circle_roster is missing the photo_present split';
  end if;

  -- Storage keeps its own, deliberately different, rule. If someone removes it
  -- believing this function replaced it, trip here rather than in production.
  if not has_function_privilege('authenticated', 'private.can_view_checkin_photo(uuid, uuid)', 'EXECUTE') then
    raise exception 'authenticated lost EXECUTE on can_view_checkin_photo';
  end if;
  if has_function_privilege('anon', 'private.can_view_checkin_photo(uuid, uuid)', 'EXECUTE') then
    raise exception 'anon gained EXECUTE on can_view_checkin_photo';
  end if;

  -- The column this reads. `authenticated` needs SELECT on it for its own rows
  -- via RLS, and the function is SECURITY DEFINER so it does not depend on
  -- that, but a revoke here would break the check-in screen without touching
  -- the roster: worth failing loudly in the same place.
  if not has_column_privilege('authenticated', 'public.progress_entries', 'photo_url', 'SELECT') then
    raise exception 'authenticated cannot read progress_entries.photo_url';
  end if;
  if not has_column_privilege('authenticated', 'public.progress_entries', 'photo_url', 'UPDATE') then
    raise exception 'authenticated cannot write progress_entries.photo_url, which 13c needs';
  end if;
end;
$$;
