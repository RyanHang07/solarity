-- Support functions for the account-lifecycle Edge Functions (section 16) and
-- the photo retention sweep (section 8).
--
-- The SQL lives here rather than inline in Deno so it is testable with the same
-- DO-block pattern as everything else, and so the Edge Functions stay thin
-- wrappers around a single call.

-- ---------------------------------------------------------------------------
-- Data export (section 16)
-- ---------------------------------------------------------------------------
-- Returns the caller's own data only. Runs as the invoking user rather than
-- SECURITY DEFINER, so RLS applies and it is structurally incapable of
-- returning anyone else's rows even if the WHERE clause were wrong.
create function public.export_user_data()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'exported_at', now(),
    'profile', (
      select to_jsonb(x) from (
        select u.id, u.username, u.first_name, u.last_name, u.avatar_url,
               u.checkin_timezone, u.created_at
        from public.users u where u.id = v_uid
      ) x
    ),
    'lifetime_stats', (
      select to_jsonb(x) from (
        select current_streak, longest_streak_ever, total_days_completed,
               total_goals_achieved, visible_on_profile
        from public.user_lifetime_stats where user_id = v_uid
      ) x
    ),
    'goals', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select g.id, g.title, c.name as category, g.deadline,
               g.achieved_at, g.archived_at, g.created_at
        from public.goals g
        join public.goal_categories c on c.id = g.category_id
        where g.user_id = v_uid
        order by g.created_at
      ) x
    ), '[]'::jsonb),
    'check_ins', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select pe.check_in_date, pe.note, pe.photo_url, pe.created_at
        from public.progress_entries pe
        where pe.user_id = v_uid
        order by pe.check_in_date
      ) x
    ), '[]'::jsonb),
    'daily_completion', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select date, all_completed from public.daily_completion
        where user_id = v_uid order by date
      ) x
    ), '[]'::jsonb),
    'circles', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select gr.name, gm.role, gm.joined_at
        from public.group_members gm
        join public.groups gr on gr.id = gm.group_id
        where gm.user_id = v_uid
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.export_user_data() from public;
grant execute on function public.export_user_data() to authenticated;

-- ---------------------------------------------------------------------------
-- Account deletion: scrub content and hand back the media to remove
-- ---------------------------------------------------------------------------
-- progress_entries survive deletion in anonymized form (section 16) because
-- other members' historical stats are computed against them. The FKs already
-- null the attribution; this additionally scrubs the free-text note, which is
-- user-generated content the FK cannot anonymize.
--
-- Returns every Storage path the Edge Function must delete. Called before the
-- auth user is removed, since afterwards the rows can no longer be located.
create function private.scrub_and_list_user_media(p_user_id uuid)
returns table (bucket text, path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    select 'checkin-photos'::text, pe.photo_url
    from public.progress_entries pe
    where pe.user_id = p_user_id and pe.photo_url is not null
    union all
    select 'avatars'::text, u.avatar_url
    from public.users u
    where u.id = p_user_id and u.avatar_url is not null;

  update public.progress_entries
  set note = null, photo_url = null
  where user_id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Photo retention (section 8): fixed 90-day age
-- ---------------------------------------------------------------------------
-- The doc tied this to group_cycles.ended_at, but a check-in belongs to a
-- user-owned goal and is visible in every circle that user is in, so "the cycle
-- this photo belongs to" is not a question the schema can answer. A fixed age
-- is predictable for users, cheap to compute, and independent of circle churn.
-- The check-in row and every statistic derived from it survive; only the image
-- is removed.
create function private.list_expired_photos(p_days integer default 90, p_limit integer default 1000)
returns table (entry_id uuid, path text)
language sql
stable
security definer
set search_path = ''
as $$
  select pe.id, pe.photo_url
  from public.progress_entries pe
  where pe.photo_url is not null
    and pe.check_in_date < (current_date - p_days)
  order by pe.check_in_date
  limit p_limit;
$$;

create function private.mark_photos_purged(p_entry_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  update public.progress_entries
  set photo_url = null
  where id = any(p_entry_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Service-role only. None of these are reachable by a client.
revoke execute on function private.scrub_and_list_user_media(uuid) from public;
revoke execute on function private.list_expired_photos(integer, integer) from public;
revoke execute on function private.mark_photos_purged(uuid[]) from public;

-- Supports the retention scan.
create index if not exists progress_entries_photo_expiry_idx
  on public.progress_entries (check_in_date)
  where photo_url is not null;;
