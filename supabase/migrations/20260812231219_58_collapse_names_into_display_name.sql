-- Collapse three competing name concepts into two.
--
-- Found during the first browser verification pass: `first_name` and
-- `last_name` were null on every account and always would be. The trigger
-- reads `raw_user_meta_data ->> 'given_name'` / `'family_name'`, but Supabase's
-- Google provider supplies neither. Its actual keys are:
--   avatar_url, email, email_verified, full_name, iss, name, phone_verified,
--   picture, provider_id, sub
--
-- So the columns had a reader and no writer. That is bug pattern two in
-- build-plan.md, and the earlier decision to take "structured OAuth claims
-- only" was sound reasoning resting on a false premise.
--
-- The deeper problem was three overlapping concepts: a legal-shaped
-- first/last pair, an OAuth full name, and a username. Solarity has no use for
-- a legal name: there is no billing, no invoicing, no formal correspondence.
-- Two concepts is the conventional split and the one every comparable product
-- lands on:
--
--   username     unique, ASCII, the identity. Rosters, digests, leaderboards.
--   display_name optional, non-unique, free-form. Cosmetic only.
--
-- Display rule everywhere: coalesce(display_name, username). Username is
-- guaranteed present after onboarding, so there is never nothing to render.

alter table public.users add column display_name text;

-- Backfill from Google's full name. Existing rows are all null, so this is
-- strictly an improvement rather than a data migration.
update public.users u
set display_name = nullif(btrim(left(au.raw_user_meta_data ->> 'full_name', 50)), '')
from auth.users au
where au.id = u.id
  and au.raw_user_meta_data ->> 'full_name' is not null;

-- 50 to match groups.name. btrim so whitespace cannot masquerade as a name;
-- a display_name of "   " would render as a blank roster entry.
alter table public.users drop constraint if exists users_name_lengths;
alter table public.users add constraint users_display_name_length
  check (display_name is null or char_length(btrim(display_name)) between 1 and 50);

-- Column grants do not extend to new columns, so they must be explicit.
-- SELECT is needed by circle-mates to render a roster; UPDATE is the user
-- editing their own, governed by the existing row-level policy on users.
grant select (display_name), update (display_name) on public.users to authenticated;

-- Rewritten to read what Google actually sends.
--
-- `display_name` is tried first so the email signup flow can pass its own
-- value through `signUp({ options: { data } })` without a second write.
-- `left(...50)` matters: an over-long Google name would violate the CHECK and
-- abort the whole signup, which is a hard failure for a cosmetic field.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  insert into public.users (id, display_name, avatar_url)
  values (
    new.id,
    nullif(
      btrim(left(coalesce(
        new.raw_user_meta_data ->> 'display_name',  -- our own signup form
        new.raw_user_meta_data ->> 'full_name',     -- Google
        new.raw_user_meta_data ->> 'name'           -- last resort
      ), 50)),
      ''
    ),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    )
  )
  on conflict (id) do nothing;

  insert into public.user_lifetime_stats (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$function$;

-- The export is a GDPR-shaped obligation, so it must describe the columns that
-- exist rather than the ones that used to.
create or replace function public.export_user_data()
returns jsonb
language plpgsql
set search_path to ''
as $function$
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
        select u.id, u.username, u.display_name, u.avatar_url,
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
$function$;

-- Last, so nothing above can reference a column that has already gone.
-- Dropping a column drops its grants with it.
alter table public.users drop column first_name;
alter table public.users drop column last_name;

comment on column public.users.display_name is
  'Optional, non-unique, cosmetic. Render coalesce(display_name, username). '
  'Profanity screening happens in the app layer, as it does for username.';;
