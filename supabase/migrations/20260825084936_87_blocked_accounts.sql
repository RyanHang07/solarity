-- 87. The list of people you have blocked, with names.
--
-- ## Why this needs a function at all
--
-- Blocking is mutual invisibility: `profile_by_username` returns no rows once
-- either party has blocked the other. **So the moment you block someone, their
-- profile is the one place you can no longer reach the Unblock button.** The
-- control has to live somewhere else, and somewhere else needs their username.
--
-- `users_select_self_or_groupmate` will not supply it. You may not share a
-- Circle with the person you blocked, and even when you do, relying on that
-- would make the list silently incomplete rather than wrong — the worst kind.
--
-- **The narrowest possible definer function**: it returns username and display
-- name for accounts *you* have blocked, and nothing else about them. The
-- caller already knows these people exist, because the caller is who blocked
-- them.
--
-- ## Not `is_blocked_by`
--
-- That helper answers "has x blocked me" and is deliberately not reused here.
-- This is the other direction — who *I* have blocked — and conflating the two
-- is exactly the mistake `profile_by_username` had to spell out both sides to
-- avoid.

create function public.blocked_accounts()
returns table (
  user_id uuid,
  username text,
  display_name text,
  blocked_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.username, u.display_name, b.created_at
  from public.user_blocks b
  join public.users u on u.id = b.blocked_user_id
  where b.blocker_user_id = (select auth.uid())
    -- Belt to the grant's braces. A definer function reachable by `anon` would
    -- otherwise answer with someone else's list, since `auth.uid()` is null and
    -- `blocker_user_id` is never null.
    and (select auth.uid()) is not null
  order by b.created_at desc;
$$;

comment on function public.blocked_accounts() is
  'Usernames of accounts the caller has blocked. SECURITY DEFINER because users_select_self_or_groupmate will not return a blocked account you share no Circle with, and blocking hides their profile from you — so this list is the only place an Unblock control can live.';

revoke execute on function public.blocked_accounts() from public, anon;
grant execute on function public.blocked_accounts() to authenticated;

do $$
declare
  v_a uuid;
  v_b uuid;
  v_rows integer;
begin
  select id into v_a from public.users where username is not null limit 1;
  select id into v_b from public.users where username is not null and id <> v_a limit 1;

  if v_a is null or v_b is null then
    raise notice 'need two onboarded users; skipping';
    return;
  end if;

  -- No caller, no list. The `anon` case.
  select count(*) into v_rows from public.blocked_accounts();
  if v_rows <> 0 then
    raise exception 'blocked_accounts answered with no authenticated caller';
  end if;

  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_a::text)::text, true);

  insert into public.user_blocks (blocker_user_id, blocked_user_id) values (v_a, v_b);

  select count(*) into v_rows from public.blocked_accounts();
  if v_rows <> 1 then
    raise exception 'expected 1 blocked account, got %', v_rows;
  end if;

  if (select username from public.blocked_accounts()) is null then
    raise exception 'the list returned a row with no username';
  end if;

  -- **Direction matters.** As the person who was blocked, the list is empty:
  -- this returns who you blocked, never who blocked you.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_b::text)::text, true);

  select count(*) into v_rows from public.blocked_accounts();
  if v_rows <> 0 then
    raise exception 'being blocked put someone in your own blocked list';
  end if;

  raise exception 'rollback: migration 87 proof complete';
exception
  when others then
    if sqlerrm <> 'rollback: migration 87 proof complete' then
      raise;
    end if;
end;
$$;
