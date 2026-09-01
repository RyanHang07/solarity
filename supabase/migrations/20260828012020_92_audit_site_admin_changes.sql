-- 92. `audit_action_type` gains `site_admin_granted` and `site_admin_revoked`.
--
-- ## Alone, for the reason migration 88 was alone
--
-- **A value added to an enum inside a transaction cannot be used later in that
-- same transaction.** Postgres allows `alter type ... add value` and then
-- refuses `unsafe use of new value` the moment anything references it — a
-- policy, a default, or a proof block inserting one row to check. Migrations
-- apply transactionally, so this file adds the values and stops. Migration 93
-- is the one that writes them.
--
-- ## Named `site_admin_`, not `admin_`
--
-- The enum already has `admin_promoted` and `admin_demoted`, and they mean
-- **admin of one Circle** — the `group_member_role` sense. Reusing them would
-- put two unrelated powers in one audit stream and make "who was made an
-- admin, and of what" unanswerable from the log.
--
-- ## Why granting admin is audited at all
--
-- It is the only privilege in the product that lets one person read another's
-- private content. The build plan's original position was that promotion should
-- never have a UI, precisely because a promotion UI is the highest-value target
-- in the app. Shipping one anyway is a deliberate trade, and an audit row is
-- part of the price: every grant and revoke names who did it and to whom.

alter type public.audit_action_type add value if not exists 'site_admin_granted';
alter type public.audit_action_type add value if not exists 'site_admin_revoked';
