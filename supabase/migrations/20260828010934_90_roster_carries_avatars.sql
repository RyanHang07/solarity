-- 90. `circle_roster` returns each member's avatar key.
--
-- Step 15f shipped avatars to `/profile` and to settings, and the plan said
-- "shown on the profile **and the roster**". The roster half was missed, and a
-- picture that only appears on a page you have to navigate to is not the point
-- of a picture.
--
-- ## Why the RPC has to change rather than the page
--
-- `users_select_self_or_groupmate` would let a member read a circle-mate's
-- `avatar_url` directly — they do share a Circle. That would mean a second read
-- of `public.users` beside a function whose entire job is to return exactly
-- what a viewer may see about the people in this Circle, and two places
-- deciding what a roster row contains.
--
-- ## Masking does not apply, and that is deliberate
--
-- Goal titles, notes and photos are withheld when a goal is hidden in this
-- Circle. **An avatar is not about a goal.** It is the same picture the person
-- publishes on a profile that every signed-in user can already open, so
-- withholding it here would hide something one tap away and make the row harder
-- to read for no gain.
--
-- **Blocking does not apply either.** A block hides profiles from each other and
-- deliberately does not remove either party from a shared Circle — the roster is
-- the one place you still see each other, and the copy on the Block control says
-- so. Masking the avatar there would half-apply a rule the product states
-- plainly.
--
-- ## The key, not a URL
--
-- The column holds `<user_id>/avatar.jpg` and the bucket is private, so this
-- returns the key and `getCircleRoster` exchanges it for a signed URL in one
-- batched call, exactly as it already does for check-in photos. The key never
-- reaches a component.
--
-- ## Dropped and recreated, not replaced
--
-- `create or replace` cannot change a function's return type, and this adds a
-- column to `returns table`. The grants go with the function, so they are
-- restated below.

drop function if exists public.circle_roster(uuid);

create function public.circle_roster(p_group_id uuid)
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
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
         -- **Unmasked, on purpose.** See the header: an avatar is not about a
         -- goal, and it is already public to every signed-in user.
         u.avatar_url,
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
  group by m.user_id, u.username, u.display_name, u.avatar_url, m.role,
           m.streak_grace, m.checkin_date, m.joined_at
  order by (m.user_id = v_uid) desc, m.joined_at asc;
end;
$$;

comment on function public.circle_roster(uuid) is
  'One Circle''s roster for the calling member. Goal titles, notes and check-in photos are masked when a goal is hidden in this Circle; avatar_url is NOT, because an avatar is not about a goal and is already visible to any signed-in user on the profile. Returns Storage keys, never URLs — getCircleRoster signs them as the caller.';

revoke execute on function public.circle_roster(uuid) from public, anon;
grant execute on function public.circle_roster(uuid) to authenticated;

do $$
declare
  v_group uuid;
  v_uid uuid;
  v_cols text[];
begin
  select array_agg(a.attname order by a.attnum) into v_cols
  from pg_proc p
  join unnest(p.proallargtypes, p.proargnames) with ordinality as a(typ, attname, attnum)
    on true
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'circle_roster';

  if not ('avatar_url' = any(v_cols)) then
    raise exception 'circle_roster does not return avatar_url; got %', v_cols;
  end if;

  -- A real call, so the added column cannot break the grouping. Read-only.
  select gm.group_id, gm.user_id into v_group, v_uid
  from public.group_members gm limit 1;

  if v_group is null then
    raise notice 'no memberships to prove against; skipping';
  else
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_uid::text)::text, true);
    perform * from public.circle_roster(v_group);
  end if;
end;
$$;
