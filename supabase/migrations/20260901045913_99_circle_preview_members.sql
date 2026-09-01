-- Step 18c. Who is already in the Circle you were invited to.
--
-- **Superseded by migration 100 within the hour, and left here as history.**
-- The query below resolves a token to a group id and then never filters by it,
-- so it returned the first ten rows of `group_members` across every Circle in
-- the database. Do not copy this file; 100 is the one that works, and its
-- comment says how it got past review.
--
-- **A companion to `circle_preview`, not an extension of it.** Adding columns
-- there means dropping and recreating a function granted to `anon`, and the two
-- answer different questions: one is "is this link usable", this is "who would
-- I be joining".
create or replace function public.circle_preview_members(p_token text)
returns table (username text, avatar_url text, role text)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_group_id uuid;
begin
  select il.group_id into v_group_id
  from public.invite_links il
  join public.groups g on g.id = il.group_id
  where il.token = p_token
    and il.enabled
    and (il.expires_at is null or il.expires_at > now())
    and g.group_status = 'active';

  if v_group_id is null then
    return;
  end if;

  return query
  select u.username, u.avatar_url, gm.role::text
  from public.group_members gm
  join public.users u on u.id = gm.user_id
  order by (gm.role <> 'owner'), gm.joined_at
  limit 10;
end;
$$;

revoke execute on function public.circle_preview_members(text) from public;
grant execute on function public.circle_preview_members(text) to anon, authenticated;
