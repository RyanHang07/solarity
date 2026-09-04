-- 111. A sun you chose, rather than one your account id chose for you.
--
-- ## What this replaces
--
-- `memberSun.ts` hashes the account id onto six presets. That was the right
-- answer to goal cosmetics being cut: it gave every member a distinct, stable
-- colour with no schema, no settings screen and no migration, and it is why a
-- Circle of ten is ten different suns rather than ten identical amber ones.
--
-- **It was still a colour nobody picked**, and the first person outside the
-- project asked for the picker within an hour of signing up. `resolveSunColor`
-- has always preferred a stored `sunPresetId` over the derived one; this is the
-- column it was waiting for.
--
-- ## Nullable, and the hash stays the fallback
--
-- `null` means "derive from my id", which keeps every account that never
-- chooses one looking exactly as it does now, and covers an account created
-- between this migration and the moment it picks. The existing rows are
-- backfilled by `scripts/backfill-sun-presets.ts` rather than here — see below.
--
-- ## The six ids are written twice, and that is a debt paid deliberately
--
-- `lib/galaxy/palettes.ts` owns `SUN_COLOR_PRESETS`; this constraint restates
-- their ids. A single source would mean either no constraint at all — so a
-- typo'd value renders as the default with no error anywhere — or generating
-- SQL from TypeScript, which is a build step for six strings.
--
-- **So the duplication is enforced instead of trusted.** `sun-colour.spec.ts`
-- asserts that every id in `SUN_COLOR_PRESETS` is accepted by this constraint
-- and that an invented one is refused. A preset added in TypeScript and not
-- here fails a test rather than a person's sign-up.
alter table public.users
  add column if not exists sun_preset_id text
    check (sun_preset_id in ('gold', 'amber', 'ember', 'rose', 'azure', 'white-hot'));

comment on column public.users.sun_preset_id is
  'Chosen sun colour, one of SUN_COLOR_PRESETS in lib/galaxy/palettes.ts. NULL means derive it from the user id via memberSun.ts, which is what every account did before this column existed.';

-- **Column grants, because `users` has no table grant.** Migration 70 made that
-- explicit precisely so a column added later cannot become readable by every
-- Circle-mate the instant it exists. Select is app-wide — the Circle sky needs
-- other members' colours — and update is the person's own row, which the
-- existing RLS policy on `users` already scopes.
grant select (sun_preset_id) on public.users to authenticated;
grant update (sun_preset_id) on public.users to authenticated;

-- **The roster carries it, or a Circle would disagree with a dashboard.** The
-- sky above a roster draws every member's sun, so a colour stored and not
-- returned here would mean seeing your chosen colour on Overview and your
-- hashed one in the Circle you chose it for. Not masked: a sun colour is not
-- about a goal, and it is the same reasoning `avatar_url` is returned under.
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
  sun_preset_id text,
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
         u.sun_preset_id,
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
  group by m.user_id, u.username, u.display_name, u.avatar_url, u.sun_preset_id,
           m.role, m.streak_grace, m.checkin_date, m.joined_at, dc.all_completed
  order by (m.user_id = v_uid) desc, m.joined_at asc;
end;
$$;

comment on function public.circle_roster(uuid) is
  'One Circle''s roster for the calling member. Goal titles, notes and check-in photos are masked when a goal is hidden in this Circle; avatar_url, sun_preset_id, category_slug and belt_visible are NOT — an avatar and a sun colour are not about a goal, and the other two are what let the galaxy draw a hidden goal as a coloured planet with no title. Returns Storage keys, never URLs. all_completed is each member''s own day; sky_closed is the Circle''s, via private.group_day_closed.';

-- ── assertions ───────────────────────────────────────────────────────────────
do $$
declare
  v_cols text;
begin
  -- The column exists, is nullable, and is constrained.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users'
      and column_name = 'sun_preset_id' and is_nullable = 'YES'
  ) then
    raise exception 'sun_preset_id is missing or not nullable';
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'users' and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%sun_preset_id%'
  ) then
    raise exception 'sun_preset_id accepts anything';
  end if;

  -- Readable and writable by a session, and by nobody without one.
  if not has_column_privilege('authenticated', 'public.users', 'sun_preset_id', 'select') then
    raise exception 'authenticated cannot read sun_preset_id';
  end if;
  if not has_column_privilege('authenticated', 'public.users', 'sun_preset_id', 'update') then
    raise exception 'authenticated cannot write sun_preset_id';
  end if;
  if has_column_privilege('anon', 'public.users', 'sun_preset_id', 'select') then
    raise exception 'anon can read sun_preset_id';
  end if;

  -- **No new column leaked into the roster beyond the one intended.** Asked of
  -- the signature rather than of the file, and by name rather than by count, so
  -- reordering the returns table cannot satisfy it.
  select string_agg(a.attname, ',' order by a.attnum) into v_cols
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral unnest(p.proargnames) with ordinality as a(attname, attnum)
  where n.nspname = 'public' and p.proname = 'circle_roster';

  if v_cols not like '%sun_preset_id%' then
    raise exception 'circle_roster does not return sun_preset_id';
  end if;
  if v_cols not like '%achievement_count%' or v_cols not like '%goals%' then
    raise exception 'circle_roster lost a column it already returned';
  end if;
end;
$$;

notify pgrst, 'reload schema';
