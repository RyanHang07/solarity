-- 109. `circle_roster` returns what the Circle galaxy needs to draw.
--
-- ## What was missing
--
-- The roster returns, per goal: `id`, `title` (masked when hidden), `hidden`,
-- `checked`, `note`, `entry_id`, `note_shared`, `photo_url`. **No category, for
-- anybody** — so the galaxy had a colour for your own planets and nothing for
-- anyone else's, and a Circle of ten would have drawn nine members in grey.
--
-- Six additions, at three levels:
--
-- | Added | Level | For |
-- |---|---|---|
-- | `category_slug` | goal | The planet's colour |
-- | `belt_visible` | goal | Its shape. Migration 107 |
-- | `joined_at` | member | Their slot in the sky |
-- | `all_completed` | member | Whether their sun is lit |
-- | `sky_closed` | Circle | The Circle-complete moment. Migration 108 |
-- | `achievement_count` | Circle | The sky's ambience tier |
--
-- ## `joined_at`, which the layout cannot do without
--
-- This function orders itself `(user_id = v_uid) desc, joined_at asc` and
-- returns neither term. That order is right for a list — you are at the top of
-- your own roster — and **wrong for a sky**, where it would mean every viewer
-- saw a different arrangement of the same Circle.
--
-- The layout makes one promise: a member's slot depends only on when they
-- joined, so nobody moves when somebody else arrives. That cannot be kept from
-- a viewer-dependent order, and it cannot be kept from user ids. So the column
-- is returned, the galaxy sorts by it, the list keeps showing you first, and
-- the two orders are deliberately different rather than accidentally the same.
--
-- ## Two dates, and they are the two this product already has
--
-- `all_completed` is read against **each member's own** check-in date, the same
-- date their `checked_count` and `total_count` are computed against. So a
-- member's sun agrees with the numbers printed beside it.
--
-- `sky_closed` is `private.group_day_closed` against **the Circle's** date —
-- the owner's day, which is what the group streak has always been evaluated on.
--
-- **They can disagree**, for a member whose timezone puts them on a different
-- date than the owner: every sun lit while the sky stays open. That split is
-- not introduced here. It is the same one that already exists between a
-- member's roster row and the Circle's streak, and resolving it in a renderer
-- would mean the galaxy disagreeing with one of the two numbers on the page.
--
-- ## Hidden goals keep their colour and their belt
--
-- Asked three times, including a middle option that would have coloured only
-- your own and one that would have given hidden goals a deliberately plain
-- shape. Confirmed each time, and it is a widening of migration 64 rather than
-- an oversight, so what it costs is written down:
--
--   * there are nine categories with nine fixed hex values, so **the colour is
--     the category** — a coloured, untitled planet tells the other members that
--     you have a hidden goal in, say, Mindfulness & Mental Health
--   * the belt carries no meaning of its own but it is **a stable fingerprint**:
--     the same hidden goal is recognisably the same planet across days
--
-- Title, note and photo stay masked. Circle-mates already know a hidden goal
-- exists and whether it was checked, because the day's fraction has to be
-- honest. Reverting is one `case` expression, since `is_self` is in scope.
--
-- ## Dropped and recreated
--
-- `create or replace` cannot change a return type, and this adds four columns.
-- The grants go with the function and are restated.

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
  joined_at timestamptz,
  checked_count integer,
  total_count integer,
  all_completed boolean,
  sky_closed boolean,
  achievement_count integer,
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
  v_circle_date date;
  v_sky_closed boolean;
  v_achievements integer;
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

  -- The Circle's own day: the owner's, which is what `circle_checkin_date`
  -- resolves and what the streak is evaluated on. Written against `v_at` rather
  -- than calling that function, so a frozen roster answers for the instant it
  -- was frozen at instead of for today.
  select private.checkin_date_at(gm.user_id, v_at) into v_circle_date
  from public.group_members gm
  where gm.group_id = p_group_id and gm.role = 'owner'
  limit 1;

  v_sky_closed := coalesce(private.group_day_closed(p_group_id, v_circle_date), false);

  -- Achieved goals across current members. The sky therefore dims when someone
  -- leaves and takes their achievements with them, which is the honest reading
  -- of what *this Circle* has done.
  select count(*)::integer into v_achievements
  from public.group_members gm
  join public.goals g on g.user_id = gm.user_id
  where gm.group_id = p_group_id
    and g.achieved_at is not null
    and g.achieved_at <= v_at;

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
           -- Unmasked for everyone, deliberately. See the header.
           cat.slug as category_slug,
           g.belt_visible,
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
    join public.goal_categories cat on cat.id = g.category_id
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
         -- **Unmasked, on purpose.** An avatar is not about a goal, and it is
         -- already public to every signed-in user.
         u.avatar_url,
         m.role,
         m.user_id = v_uid as is_self,
         m.streak_grace,
         v_status::text as circle_status,
         v_as_of as as_of,
         m.checkin_date,
         m.joined_at,
         coalesce(count(*) filter (where ag.checked), 0)::integer as checked_count,
         coalesce(count(ag.goal_id), 0)::integer as total_count,
         -- Their own day, matching the two counts above. See the header on why
         -- this and `sky_closed` are allowed to disagree.
         coalesce(dc.all_completed, false) as all_completed,
         v_sky_closed as sky_closed,
         v_achievements as achievement_count,
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', ag.goal_id,
               'title', case when ag.hidden and not ag.is_self then null
                             else ag.title end,
               'hidden', ag.hidden,
               'checked', ag.checked,
               'category_slug', ag.category_slug,
               'belt_visible', ag.belt_visible,
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
  left join public.daily_completion dc
         on dc.user_id = m.user_id and dc.date = m.checkin_date
  left join active_goal ag on ag.user_id = m.user_id
  group by m.user_id, u.username, u.display_name, u.avatar_url, m.role,
           m.streak_grace, m.checkin_date, m.joined_at, dc.all_completed
  order by (m.user_id = v_uid) desc, m.joined_at asc;
end;
$$;

comment on function public.circle_roster(uuid) is
  'One Circle''s roster for the calling member. Goal titles, notes and check-in photos are masked when a goal is hidden in this Circle; avatar_url, category_slug and belt_visible are NOT — the first because an avatar is not about a goal, the other two deliberately, so the galaxy can draw a hidden goal as a coloured planet with no title. Returns Storage keys, never URLs. all_completed is each member''s own day; sky_closed is the Circle''s, via private.group_day_closed.';

revoke execute on function public.circle_roster(uuid) from public, anon;
grant execute on function public.circle_roster(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_group uuid;
  v_uid uuid;
  v_cols text[];
  v_missing text[];
  v_rows bigint;
  v_goal jsonb;
begin
  select array_agg(a.attname order by a.attnum) into v_cols
  from pg_proc p
  join unnest(p.proallargtypes, p.proargnames) with ordinality as a(typ, attname, attnum)
    on true
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'circle_roster';

  select array_agg(c) into v_missing
  from unnest(array['joined_at','all_completed','sky_closed','achievement_count']) c
  where not (c = any(v_cols));

  if v_missing is not null then
    raise exception 'circle_roster is missing %; got %', v_missing, v_cols;
  end if;

  -- A real call, as a real member, so the added joins and the wider GROUP BY
  -- cannot break the aggregation. Read-only.
  select gm.group_id, gm.user_id into v_group, v_uid
  from public.group_members gm
  join public.goals g on g.user_id = gm.user_id
  limit 1;

  if v_group is null then
    raise notice 'no membership with goals to prove against; skipping the call';
  else
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_uid::text)::text, true);

    select count(*) into v_rows from public.circle_roster(v_group);
    if v_rows = 0 then
      raise exception 'circle_roster returned no rows for a real member';
    end if;

    -- Every goal carries a category. A null here is the failure the whole
    -- migration exists to fix, and an inner join could have dropped the goal
    -- entirely instead — so this checks the goal is present *and* coloured.
    select r.goals -> 0 into v_goal
    from public.circle_roster(v_group) r
    where r.user_id = v_uid and jsonb_array_length(r.goals) > 0;

    if v_goal is null then
      raise exception 'the caller has goals but the roster returned none';
    end if;
    if v_goal ->> 'category_slug' is null then
      raise exception 'a goal came back with no category_slug: %', v_goal;
    end if;
    if v_goal -> 'belt_visible' is null then
      raise exception 'a goal came back with no belt_visible: %', v_goal;
    end if;
  end if;

  raise notice 'circle_roster: % rows, category and belt present', v_rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- The rolled-back proof, run through the MCP and recorded here.
--
-- The assertions above run as a member reading their *own* row, which cannot
-- see masking at all. This one reads a circle-mate's goal, hides it, reads it
-- again, and then tries the whole thing as somebody who is not in the Circle.
-- Every write is discarded by a deliberate `raise` at the end.
--
--   visible goal          hidden=false  title present  slug=hobbies  belt=false
--   hidden in this Circle title NULL    hidden=true    slug present  belt present  checked present
--   non-member            refused (insufficient_privilege / NOT_A_MEMBER)
--
-- The first run of this proof reported "title absent" on the goal it had picked
-- as the visible control, which looked like masking leaking onto everything.
-- It was not: the goal chosen at random was already hidden. The query now
-- excludes `hidden_everywhere` and anything `is_goal_hidden_in_group` already
-- covers, so the control is a control. **A negative case that was never
-- positive proves nothing**, and it took a second look to notice.
-- ---------------------------------------------------------------------------
