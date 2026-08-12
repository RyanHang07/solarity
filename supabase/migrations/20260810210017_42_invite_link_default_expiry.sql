-- Invite links now expire 7 days after creation by default.
--
-- A link is a bearer credential: whoever holds the URL can join. Left permanent,
-- one forwarded message, screenshot, or stale group chat keeps a way in open
-- indefinitely. Seven days matches how Slack and Discord invites behave, bounds
-- the exposure window, and costs an owner one tap to regenerate — infrequent
-- anyway, since a circle caps at 10 members.
--
-- The caller can still pass an explicit p_expires_at (including a longer window,
-- or NULL for a permanent link) when there's a reason to.

create or replace function public.create_invite_link(
  p_group_id uuid,
  p_expires_at timestamptz default null,
  p_use_default_expiry boolean default true
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text;
  v_count integer;
  v_status public.group_status;
  v_expires timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = v_uid and gm.role in ('owner','admin')
  ) then
    raise exception 'Only an owner or admin may create an invite link'
      using errcode = 'insufficient_privilege';
  end if;

  -- A link for a locked or archived circle could never be used (join_circle
  -- requires 'active'), so refuse to mint one rather than hand back a dud.
  select group_status into v_status from public.groups where id = p_group_id;
  if v_status is distinct from 'active' then
    raise exception 'This circle is not active' using errcode = 'invalid_parameter_value';
  end if;

  select count(*) into v_count from public.group_members gm where gm.group_id = p_group_id;
  if v_count >= 10 then
    raise exception 'This circle is full' using errcode = 'check_violation';
  end if;

  v_expires := case
    when p_expires_at is not null then p_expires_at
    when p_use_default_expiry then now() + interval '7 days'
    else null                       -- explicit opt-out: a permanent link
  end;

  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');

  update public.invite_links set enabled = false
  where group_id = p_group_id and enabled;

  insert into public.invite_links (group_id, token, created_by, expires_at)
  values (p_group_id, v_token, v_uid, v_expires);

  insert into public.audit_log (actor_user_id, group_id, action_type, metadata)
  values (v_uid, p_group_id, 'invite_link_regenerated',
          jsonb_build_object('expires_at', v_expires));

  return v_token;
end;
$$;

revoke execute on function public.create_invite_link(uuid, timestamptz, boolean) from public;
grant execute on function public.create_invite_link(uuid, timestamptz, boolean) to authenticated;

-- The old 2-argument signature would otherwise linger as a second, expiry-less
-- entry point.
drop function if exists public.create_invite_link(uuid, timestamptz);;
