-- Solarity RLS, step 4a: shared predicates
-- Architecture doc section 4
--
-- WHY A SEPARATE SCHEMA
--
-- Unlike trigger functions, RLS helper functions must be EXECUTE-able by the
-- `authenticated` role: a policy expression is evaluated with the privileges of
-- whoever runs the query, so revoking EXECUTE would make every policy fail with
-- permission denied rather than simply returning no rows.
--
-- But anything in `public` is published by PostgREST as an RPC endpoint. These
-- are SECURITY DEFINER functions that bypass RLS internally, so exposing them as
-- callable API surface is exactly what the last few steps worked to avoid.
--
-- A schema PostgREST does not expose resolves both: policies can call them,
-- clients cannot reach them over HTTP.
--
-- WHY SECURITY DEFINER
--
-- The natural policy on group_members ("you may see rows for groups you belong
-- to") must query group_members to decide, which re-triggers the same policy and
-- recurses until Postgres aborts. SECURITY DEFINER runs the lookup as the
-- function owner with RLS bypassed, so the inner query never re-enters it.

create schema if not exists private;

grant usage on schema private to authenticated;

create function private.is_group_member(p_group_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = (select auth.uid())
  );
$$;

create function private.is_group_admin(p_group_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = (select auth.uid())
      and gm.role in ('owner', 'admin')
  );
$$;

create function private.is_group_owner(p_group_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = (select auth.uid())
      and gm.role = 'owner'
  );
$$;

-- The core visibility rule (section 4): two users see each other's progress
-- only if they share at least one group.
create function private.shares_group_with(p_user_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = p_user_id
  );
$$;

-- Directional: has p_user_id blocked the current user? Overrides opt-in
-- profile visibility (section 20 item 11).
create function private.is_blocked_by(p_user_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_blocks b
    where b.blocker_user_id = p_user_id
      and b.blocked_user_id = (select auth.uid())
  );
$$;

-- goal_group_visibility is sparse: a missing row means visible. Encoding that
-- coalesce once here means no policy or Storage rule has to remember it.
create function private.is_goal_hidden_in_group(p_goal_id uuid, p_group_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (
      select v.hidden from public.goal_group_visibility v
      where v.goal_id = p_goal_id and v.group_id = p_group_id
    ),
    false
  );
$$;

grant execute on function private.is_group_member(uuid) to authenticated;
grant execute on function private.is_group_admin(uuid) to authenticated;
grant execute on function private.is_group_owner(uuid) to authenticated;
grant execute on function private.shares_group_with(uuid) to authenticated;
grant execute on function private.is_blocked_by(uuid) to authenticated;
grant execute on function private.is_goal_hidden_in_group(uuid, uuid) to authenticated;

comment on schema private is
  'Internal helpers for RLS policies. Not exposed by PostgREST. Functions here '
  'are SECURITY DEFINER and bypass RLS by design; they must never be reachable '
  'as API endpoints.';;
