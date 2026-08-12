-- Solarity initial schema, step 2a: enum types
-- Postgres 17 provides gen_random_uuid() in core, so no extensions are required.

-- Group lifecycle state (architecture doc section 3, `groups`; section 7)
create type group_status as enum ('active', 'locked', 'archived');

-- Membership roles (section 3 `group_members`; section 9)
create type group_member_role as enum ('owner', 'admin', 'member');

-- Reportable content types (section 3 `content_reports`; section 18 item 8).
-- 'planet_avatar' is unused until the deferred galaxy system ships.
create type content_report_type as enum ('checkin_photo', 'checkin_note', 'planet_avatar');

-- Report review lifecycle (section 3 `content_reports`)
create type content_report_status as enum ('pending', 'reviewed', 'actioned', 'dismissed');

-- In-app notification types (section 3 `notifications`).
-- 'cosmetic_unlocked' deliberately excluded from v1; added when the galaxy ships.
create type notification_type as enum (
  'digest',
  'kicked',
  'invite_accepted',
  'admin_transfer_request',
  'group_locked_renewal'
);

-- Which stats tab a group shows by default (section 21, leaderboard display)
create type default_stats_view as enum ('cycle_stats', 'leaderboard');

-- Privileged actions recorded in audit_log (section 19; last two added with the
-- group streak feature in section 21)
create type audit_action_type as enum (
  'member_kicked',
  'ownership_transferred',
  'admin_promoted',
  'admin_demoted',
  'invite_link_toggled',
  'invite_link_regenerated',
  'group_deadline_changed',
  'group_cycle_reset',
  'group_cycle_extended',
  'group_streak_continued',
  'group_streak_reset'
);;
