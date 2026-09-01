-- Fixes migration 99, which resolved the token to a group id and then never
-- used it.
--
-- **The `where gm.group_id = v_group_id` was missing.** The function looked
-- right: it took a token, checked the link was live, refused when it was not,
-- and returned members. What it returned was the first ten rows of
-- `group_members` across every Circle in the database, joined to their
-- usernames and avatar keys, to anybody holding any live invite link.
--
-- Two things made it invisible on the way past. The guard clause is the part
-- that looks like the security, and it is correct; the leak is in the query
-- underneath it, which reads as ordinary. And `limit 10` is the size a correct
-- answer would also be, so even the row count looks plausible.
--
-- **The rule this belongs to** is the one in `patterns.md` about RLS not being
-- a substitute for a WHERE clause, arriving from the other side: a
-- `SECURITY DEFINER` function has no RLS to fall back on at all, so a filter
-- that is missing is simply missing. A definer function that resolves an
-- identifier and does not then filter by it is the shape to look for.
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
  -- Live links only. A revoked or expired token stops naming the members in the
  -- same breath it stops working, so this cannot become a way to keep watching
  -- a Circle you were removed from.
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
  where gm.group_id = v_group_id
  -- Owner first, then in the order people arrived. The owner is the one an
  -- invitee is most likely to recognise, because they are usually who sent it.
  order by (gm.role <> 'owner'), gm.joined_at
  limit 10;
end;
$$;

revoke execute on function public.circle_preview_members(text) from public;
grant execute on function public.circle_preview_members(text) to anon, authenticated;
