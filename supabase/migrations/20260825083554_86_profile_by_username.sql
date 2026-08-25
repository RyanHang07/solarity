-- 86. One profile, for whoever is asking.
--
-- ## Why this is a function and not a widened policy
--
-- Profiles are visible to any signed-in user, not only to Circle-mates. The
-- obvious way to get there is to relax `users_select_self_or_groupmate`. That
-- would be wrong, and the reason is the difference between a row filter and a
-- column grant.
--
-- `authenticated` holds column SELECT on `public.users` for `username`,
-- `display_name` and `avatar_url` — **and also `checkin_timezone`,
-- `today_screen_mode` and `push_shows_circle_name`.** RLS filters *rows*.
-- Widening the policy would not widen it to the three profile columns; it would
-- widen it to all six, everywhere, on every surface. A timezone is a coarse
-- location signal and the two preference columns describe how a person uses the
-- app. None of that belongs to a stranger who typed a username.
--
-- Narrowing the grants first was considered and rejected: those columns have
-- live readers in settings and the check-in gate, and breaking working screens
-- to enable a new one is the wrong trade.
--
-- **`circle_roster` is already this pattern**: a `SECURITY DEFINER` function
-- that decides what a viewer may see and returns exactly that, with the base
-- tables left shut. This is the same shape for a different question, and it
-- keeps the widening scoped to one function that can be read in full.
--
-- It also returns `users.created_at`, which `authenticated` cannot select at
-- all. That is not a loophole; it is the point. The function chooses.
--
-- ## Blocking, and why a block must be undetectable
--
-- `private.is_blocked_by(x)` answers "has x blocked me" — one direction — and
-- the existing stats policy uses it that way. **Mutual invisibility needs
-- both**, so it is spelled out here rather than by changing a helper several
-- policies depend on.
--
-- A blocked profile returns **no rows**, exactly like a username that does not
-- exist. If blocking produced a distinguishable result, "did they block me"
-- becomes a thing to probe, and the answer is information the blocker chose to
-- withhold.
--
-- ## Stats are opt-in, and absent is not zero
--
-- `visible_on_profile` defaults to false. When it is off the numbers come back
-- null and `stats_visible` is false, so a caller can say "hasn't shared these"
-- rather than rendering four zeroes — which would be a wrong answer rather than
-- a withheld one.
--
-- **You always see your own**, whatever the toggle says. That mirrors
-- `user_lifetime_stats_select_visible`, whose first clause is
-- `user_id = auth.uid()`.

create function public.profile_by_username(p_username text)
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  member_since timestamptz,
  is_self boolean,
  stats_visible boolean,
  current_streak integer,
  longest_streak_ever integer,
  total_days_completed integer,
  total_goals_achieved integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    u.id,
    u.username,
    u.display_name,
    u.avatar_url,
    u.created_at,
    u.id = (select auth.uid()),
    -- The toggle as the caller sees it: your own profile always shows.
    coalesce(s.visible_on_profile, false) or u.id = (select auth.uid()),
    case when coalesce(s.visible_on_profile, false) or u.id = (select auth.uid())
         then s.current_streak end,
    case when coalesce(s.visible_on_profile, false) or u.id = (select auth.uid())
         then s.longest_streak_ever end,
    case when coalesce(s.visible_on_profile, false) or u.id = (select auth.uid())
         then s.total_days_completed end,
    case when coalesce(s.visible_on_profile, false) or u.id = (select auth.uid())
         then s.total_goals_achieved end
  from public.users u
  left join public.user_lifetime_stats s on s.user_id = u.id
  where
    -- **Signed in, asserted here as well as by the grant below.** A
    -- `SECURITY DEFINER` function runs as its owner, so forgetting to revoke
    -- from `anon` would publish every profile to the open internet. Two
    -- independent things now have to be wrong for that to happen.
    (select auth.uid()) is not null

    -- `lower(...) = lower(...)` is what hits the unique index on
    -- `lower(username)`. A plain `=` would be a sequential scan and would also
    -- fail to find `Ryan` when the URL says `ryan`.
    and lower(u.username) = lower(p_username)

    -- A username is required to have a profile at all. Onboarding sets it; an
    -- account that has not finished onboarding is not a person to look up.
    and u.username is not null

    -- Mutual invisibility. Either direction hides the profile from the other.
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_user_id = u.id and b.blocked_user_id = (select auth.uid()))
         or (b.blocker_user_id = (select auth.uid()) and b.blocked_user_id = u.id)
    );
$$;

comment on function public.profile_by_username(text) is
  'One profile for a signed-in caller. SECURITY DEFINER so profiles can be open to any signed-in user without widening users_select_self_or_groupmate, which is a row filter and would have exposed checkin_timezone and the preference columns along with the three profile ones. Returns no rows when the username does not exist OR when either party has blocked the other, so a block is undetectable. Stats are null unless visible_on_profile is set or the caller is the subject.';

-- Signed-in callers only. The `auth.uid() is not null` test above is the second
-- lock; this is the first.
revoke execute on function public.profile_by_username(text) from public, anon;
grant execute on function public.profile_by_username(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Proof, rolled back.
--
-- Runs as the table owner, so it proves the function's own logic. Whether the
-- grants agree with it is a question only a real signed-in client can answer,
-- and `e2e/profile.spec.ts` asks it.
-- ---------------------------------------------------------------------------
do $$
declare
  v_a uuid;
  v_b uuid;
  v_name text;
  v_rows integer;
begin
  select id, username into v_a from public.users where username is not null limit 1;
  select id into v_b from public.users
   where username is not null and id <> v_a limit 1;
  select username into v_name from public.users where id = v_a;

  if v_a is null or v_b is null then
    raise notice 'need two onboarded users to prove against; skipping';
    return;
  end if;

  -- Without a caller there is no profile. This is the anon case, and the
  -- assertion that the `auth.uid() is not null` guard is load-bearing.
  select count(*) into v_rows from public.profile_by_username(v_name);
  if v_rows <> 0 then
    raise exception 'a profile was returned with no authenticated caller';
  end if;

  -- Case-insensitive lookup, which is what the unique index is built on.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_b::text)::text, true);

  select count(*) into v_rows from public.profile_by_username(upper(v_name));
  if v_rows <> 1 then
    raise exception 'an uppercased username found % rows, expected 1', v_rows;
  end if;

  -- A username nobody has is simply absent.
  select count(*) into v_rows from public.profile_by_username('__no_such_user__');
  if v_rows <> 0 then
    raise exception 'a nonexistent username returned a profile';
  end if;

  -- ------------------------------------------------------------- blocking
  -- b is asking about a. a blocks b: a disappears for b.
  insert into public.user_blocks (blocker_user_id, blocked_user_id)
  values (v_a, v_b);

  select count(*) into v_rows from public.profile_by_username(v_name);
  if v_rows <> 0 then
    raise exception 'a blocked profile was still returned';
  end if;

  delete from public.user_blocks
   where blocker_user_id = v_a and blocked_user_id = v_b;

  -- And the other direction, which `is_blocked_by` alone would not catch:
  -- b blocks a, and a still disappears for b.
  insert into public.user_blocks (blocker_user_id, blocked_user_id)
  values (v_b, v_a);

  select count(*) into v_rows from public.profile_by_username(v_name);
  if v_rows <> 0 then
    raise exception 'blocking someone did not hide them from you';
  end if;

  raise exception 'rollback: migration 86 proof complete';
exception
  when others then
    if sqlerrm <> 'rollback: migration 86 proof complete' then
      raise;
    end if;
end;
$$;
