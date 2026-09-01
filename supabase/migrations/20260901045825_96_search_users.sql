-- Step 18a. Finding somebody by the start of their username.
--
-- **This is the first directory the app has ever had.** `profile_by_username`
-- needs the whole handle; this needs three characters. That is a deliberate
-- widening, and every guard below exists because of it.
create or replace function public.search_users(
  p_query text,
  p_group_id uuid default null
)
returns table (id uuid, username text, avatar_url text)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_needle text;
begin
  if v_uid is null then
    raise exception 'Not authenticated'
      using errcode = 'insufficient_privilege', hint = 'NOT_AUTHENTICATED';
  end if;

  v_needle := lower(trim(coalesce(p_query, '')));

  -- **The floor is here, not in the browser.** Two characters returns a slice
  -- of the whole table, and a client-side check is a suggestion. Silent rather
  -- than an exception: an empty box is not an error, it is a box you have not
  -- finished typing in.
  if length(v_needle) < 3 then
    return;
  end if;

  -- **Escaped before it reaches `like`, and this is the whole enumeration
  -- hole.** `%` as a query is a request for every user in the system, and `_`
  -- is a single-character wildcard that would quietly widen every search. The
  -- backslash goes first, or it would escape the escapes added after it.
  v_needle := replace(v_needle, '\', '\\');
  v_needle := replace(v_needle, '%', '\%');
  v_needle := replace(v_needle, '_', '\_');

  return query
  select u.id, u.username, u.avatar_url
  from public.users u
  where u.username is not null
    -- `lower(username)` matches `users_username_lower_key`, so this is an index
    -- scan rather than a sequential one over every account.
    and lower(u.username) like v_needle || '%' escape '\'
    and u.id <> v_uid
    -- Blocked in either direction. `moderation` treats a block as mutual
    -- invisibility, and a search that returned someone you blocked would be the
    -- one place that stopped being true.
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_user_id = v_uid and b.blocked_user_id = u.id)
         or (b.blocker_user_id = u.id and b.blocked_user_id = v_uid)
    )
    -- Already inside, when a Circle is named. Without this the results are a
    -- list of people the Invite button will refuse, which reads as broken.
    and (
      p_group_id is null
      or not exists (
        select 1 from public.group_members gm
        where gm.group_id = p_group_id and gm.user_id = u.id
      )
    )
  order by lower(u.username)
  -- Ten, matching a Circle's capacity. A larger page would be a bigger scrape
  -- per request for no gain: you are looking for one person you already know.
  limit 10;
end;
$$;

revoke execute on function public.search_users(text, uuid) from public, anon;
grant execute on function public.search_users(text, uuid) to authenticated;
