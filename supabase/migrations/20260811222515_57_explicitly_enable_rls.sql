-- CRITICAL PORTABILITY FIX, found when `supabase db diff` first replayed the
-- migration history into a shadow database.
--
-- Not one migration ever enabled RLS. Every table has it today only because the
-- project's "Enable automatic RLS" setting installs an event trigger that
-- switches it on as each table is created. That trigger is created by the
-- Supabase dashboard, not by anything in this history.
--
-- So a rebuild from these migrations — a shadow database, a staging project, a
-- disaster recovery — produced 21 tables with RLS OFF and all 41 policies
-- present but INERT. A policy on a table without RLS enabled does nothing, and
-- `authenticated` holds real grants, so the rebuilt database would have been
-- wide open to any signed-in user.
--
-- Enabling RLS where it is already enabled is a no-op, so this is safe to apply
-- to the live project and safe to re-run.
--
-- Rule going forward: every CREATE TABLE gets an explicit ENABLE ROW LEVEL
-- SECURITY in the same migration. The dashboard setting stays on as a safety
-- net, but the migration history must stand alone.

alter table public.users                        enable row level security;
alter table public.username_history             enable row level security;
alter table public.goal_categories              enable row level security;
alter table public.goals                        enable row level security;
alter table public.goal_group_visibility        enable row level security;
alter table public.groups                       enable row level security;
alter table public.group_members                enable row level security;
alter table public.group_cycles                 enable row level security;
alter table public.invite_links                 enable row level security;
alter table public.progress_entries             enable row level security;
alter table public.daily_completion             enable row level security;
alter table public.group_cycle_stats            enable row level security;
alter table public.group_daily_completion       enable row level security;
alter table public.group_member_category_stats  enable row level security;
alter table public.user_lifetime_stats          enable row level security;
alter table public.notifications                enable row level security;
alter table public.push_subscriptions           enable row level security;
alter table public.digest_snapshots             enable row level security;
alter table public.content_reports              enable row level security;
alter table public.user_blocks                  enable row level security;
alter table public.audit_log                    enable row level security;
