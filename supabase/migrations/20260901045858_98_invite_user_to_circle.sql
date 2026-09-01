-- Step 18b. Inviting a person rather than handing out a link.
--
-- **It reads the Circle's live link, it never mints one.** `create_invite_link`
-- disables every existing link before inserting, so an invite that quietly
-- generated one would revoke the link members are already sharing. No link is a
-- refusal with a name, and the panel offers the generate button that already
-- exists.
create or replace function public.invite_user_to_circle(
  p_group_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_group record;
  v_count integer;
  v_token text;
  v_inviter text;
begin
  if v_uid is null then
    raise exception 'Not authenticated'
      using errcode = 'insufficient_privilege', hint = 'NOT_AUTHENTICATED';
  end if;

  -- Membership first, so every refusal below is one a member is entitled to
  -- learn. Answering "that Circle is full" to a stranger would confirm the
  -- Circle exists.
  if not exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = v_uid
  ) then
    raise exception 'Not a member of that Circle'
      using errcode = 'check_violation', hint = 'NOT_A_MEMBER';
  end if;

  select g.name, g.group_status into v_group
  from public.groups g where g.id = p_group_id;

  if v_group.group_status <> 'active' then
    raise exception 'That Circle is not active'
      using errcode = 'check_violation', hint = 'CIRCLE_INACTIVE';
  end if;

  -- **A block is answered as "no such person", on purpose.** Distinguishing
  -- "blocked you" from "does not exist" would turn this into a detector for
  -- being blocked, which is the one thing blocking must not announce. Same
  -- masking as `profile_by_username`.
  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_user_id = v_uid and b.blocked_user_id = p_user_id)
       or (b.blocker_user_id = p_user_id and b.blocked_user_id = v_uid)
  ) or not exists (
    select 1 from public.users u where u.id = p_user_id and u.username is not null
  ) then
    raise exception 'No such person'
      using errcode = 'check_violation', hint = 'NOT_FOUND';
  end if;

  if exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = p_user_id
  ) then
    raise exception 'Already in that Circle'
      using errcode = 'check_violation', hint = 'ALREADY_MEMBER';
  end if;

  select count(*) into v_count
  from public.group_members gm where gm.group_id = p_group_id;

  -- Checked here as well as by `join_circle`, because an invite that can only
  -- end in "this Circle is full" is worse than a refusal now.
  if v_count >= 10 then
    raise exception 'That Circle is full'
      using errcode = 'check_violation', hint = 'CIRCLE_FULL';
  end if;

  select il.token into v_token
  from public.invite_links il
  where il.group_id = p_group_id
    and il.enabled
    and (il.expires_at is null or il.expires_at > now())
  order by il.created_at desc
  limit 1;

  if v_token is null then
    raise exception 'That Circle has no live invite link'
      using errcode = 'check_violation', hint = 'INVITE_LINK_MISSING';
  end if;

  -- **One unread invite per person per Circle**, and a repeat is success rather
  -- than an error. The button is going to be pressed twice by somebody who is
  -- not sure the first one worked, and the honest answer to that is "yes, they
  -- have it", not a second row in their list.
  if exists (
    select 1 from public.notifications n
    where n.user_id = p_user_id
      and n.type = 'invited'
      and n.read_at is null
      and n.payload ->> 'group_id' = p_group_id::text
  ) then
    return;
  end if;

  select u.username into v_inviter from public.users u where u.id = v_uid;

  -- The token travels in the payload, which is what makes the notification a
  -- working invite rather than a pointer at one. `notifications` is readable
  -- only by its own user, so the credential is no wider than the person it was
  -- issued to. See build-plan.md, step 18, for the cost accepted here.
  insert into public.notifications (user_id, type, payload)
  values (
    p_user_id,
    'invited',
    jsonb_build_object(
      'group_id', p_group_id,
      'circle_name', v_group.name,
      'token', v_token,
      'inviter_username', v_inviter
    )
  );
end;
$$;

revoke execute on function public.invite_user_to_circle(uuid, uuid) from public, anon;
grant execute on function public.invite_user_to_circle(uuid, uuid) to authenticated;
