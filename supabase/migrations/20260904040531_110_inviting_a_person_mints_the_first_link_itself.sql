-- Inviting somebody no longer dead-ends on "generate a link first".
--
-- ## The report
--
-- The first person outside the project was invited by name. The invite refused
-- with `INVITE_LINK_MISSING`, the inviter went and pressed Generate, came back
-- and invited again, and it worked — a second apart in the timestamps. What
-- they remembered afterwards was "it said something about expired", which is
-- the tell: the refusal was noise between them and the thing they asked for,
-- and it did not survive as a sentence, only as a bad feeling about invites.
--
-- ## Why the refusal was there, and why it does not cover this case
--
-- `invite_user_to_circle` reads the Circle's live link and never mints one,
-- because `create_invite_link` **rotates**: it disables every enabled link
-- before inserting, so an invite that quietly generated one would revoke the
-- link members are already passing around in a group chat. That reasoning is
-- sound and is kept.
--
-- It just does not apply when there is no live link at all. **There is nothing
-- to revoke**, so minting is free of the exact hazard the refusal exists to
-- prevent. The rule was right and its scope was one case too wide.
--
-- ## Admins only, and that is not a formality
--
-- `create_invite_link` is owner-and-admin. This function is any member, so an
-- unconditional mint would be a way around that check — a plain member could
-- cause a bearer credential for the Circle to exist by pressing Invite. So a
-- member still gets the refusal, with copy that names who can fix it rather
-- than pointing at a button they cannot see.
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
  v_is_admin boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated'
      using errcode = 'insufficient_privilege', hint = 'NOT_AUTHENTICATED';
  end if;

  -- Membership first, so every refusal below is one a member is entitled to
  -- learn. Answering "that Circle is full" to a stranger would confirm the
  -- Circle exists.
  select gm.role in ('owner', 'admin') into v_is_admin
  from public.group_members gm
  where gm.group_id = p_group_id and gm.user_id = v_uid;

  if v_is_admin is null then
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
    if v_is_admin then
      -- **Nothing live means nothing to revoke**, so this cannot take a link
      -- out of anybody's hands — which is the whole objection to minting here.
      -- `create_invite_link` re-checks admin, status and capacity against the
      -- same `auth.uid()`, and writes its own `invite_link_regenerated` audit
      -- row, so the link is indistinguishable from one made by the button.
      v_token := public.create_invite_link(p_group_id);
    else
      raise exception 'That Circle has no live invite link'
        using errcode = 'check_violation', hint = 'INVITE_LINK_MISSING';
    end if;
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

-- ── assertions ───────────────────────────────────────────────────────────────
--
-- Asked of the *installed* definition, not of this file's text, and phrased so
-- they cannot be satisfied by the prose above: each one names something the
-- body must reference to work at all.
do $$
declare
  v_src text;
begin
  select p.prosrc into v_src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'invite_user_to_circle';

  if v_src is null then
    raise exception 'invite_user_to_circle is missing';
  end if;

  -- It reaches the minting function at all.
  if v_src not like '%create_invite_link(p_group_id)%' then
    raise exception 'the mint is not wired up';
  end if;

  -- And only behind the admin flag, which is the check that stops this being a
  -- way for a plain member around create_invite_link's own role test.
  if v_src not like '%if v_is_admin then%' then
    raise exception 'the mint is not gated on the caller being an admin';
  end if;

  -- The refusal survives for everybody else.
  if v_src not like '%INVITE_LINK_MISSING%' then
    raise exception 'a non-admin no longer gets a named refusal';
  end if;

  -- Still nobody's default: the function is not reachable without a session.
  if has_function_privilege('anon', 'public.invite_user_to_circle(uuid, uuid)', 'execute') then
    raise exception 'anon can execute invite_user_to_circle';
  end if;
  if not has_function_privilege('authenticated', 'public.invite_user_to_circle(uuid, uuid)', 'execute') then
    raise exception 'authenticated cannot execute invite_user_to_circle';
  end if;
end;
$$;

notify pgrst, 'reload schema';
