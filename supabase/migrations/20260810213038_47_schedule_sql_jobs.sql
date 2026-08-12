-- Scheduling. pg_cron runs inside Postgres, so the pure-SQL jobs need no
-- network hop, no shared secret, and no deployed app. The two HTTP jobs
-- (Edge Functions) are scheduled separately once their secret is in Vault.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- Rollover — HOURLY, no argument.
-- ---------------------------------------------------------------------------
-- Hourly rather than daily because "2 AM local" occurs at 24 different UTC
-- moments; a daily run would process most users at the wrong time. Repeat
-- visits are made safe by users.last_rollover_date and
-- group_cycles.last_rollover_date. Passing NO argument is essential — an
-- explicit date bypasses both guards and double-counts incremental streaks.
select cron.schedule(
  'solarity-rollover-hourly',
  '5 * * * *',                      -- :05 past each hour, off the busy top-of-hour
  $$ select public.run_daily_rollover(); $$
);

-- ---------------------------------------------------------------------------
-- Digest — daily.
-- ---------------------------------------------------------------------------
-- Runs after the rollover has had time to finalize yesterday for most
-- timezones. Idempotent: skips any Circle already holding a digest for the
-- target date, so an extra run neither duplicates snapshots nor re-notifies.
select cron.schedule(
  'solarity-digest-daily',
  '20 * * * *',                     -- hourly, but self-skipping per Circle
  $$ select public.build_daily_digests(); $$
);

-- ---------------------------------------------------------------------------
-- Retention sweep — daily, off-peak.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'solarity-retention-daily',
  '30 4 * * *',
  $$ select public.run_retention_sweep(); $$
);;
