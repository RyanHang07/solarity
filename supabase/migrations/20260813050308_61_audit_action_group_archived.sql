-- Adds the `group_archived` audit action.
--
-- SEPARATE FROM ITS FIRST USE ON PURPOSE. Postgres refuses to use a new enum
-- value in the same transaction that added it, so migration 62 creates the
-- archive_circle RPC that writes this value. Combining them fails at apply
-- time, and worse, fails on a shadow-database replay after appearing to work
-- locally.
--
-- Every value in this enum must have a writer (see the standing check in
-- build-plan.md). This one's writer arrives in the very next migration, so the
-- gap is one file wide.

alter type public.audit_action_type add value if not exists 'group_archived';;
