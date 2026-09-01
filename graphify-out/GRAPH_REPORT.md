# Graph Report - solarity  (2026-08-31)

## Corpus Check
- 281 files · ~186,821 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1332 nodes · 2394 edges · 181 communities (126 shown, 55 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 43 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `6a60b161`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- push-client.ts
- dependencies
- devDependencies
- enforce
- compilerOptions
- photo-upload.ts
- requireEnv
- settings.ts
- errors.ts
- db.ts
- privacy/page.tsx
- today-roster.tsx
- app/layout.tsx
- photos.spec.ts
- roster.spec.ts
- digest-days.ts
- supabase/proxy.ts
- sign-in/page.tsx
- createClient
- database.types.ts
- 20260811045639_51_close_unwritten_state_gaps.sql
- 20260810202140_34_live_daily_completion_triggers.sql
- graph-freshness.mjs
- invite-panel.tsx
- admin.ts
- 20260810042820_13_stats_and_streak_tables.sql
- moderation.ts
- [username]/page.tsx
- sections.ts
- public.export_user_data
- server.ts
- 20260810055111_31_circle_rpcs.sql
- public.export_user_data
- public.circle_roster
- csp-report/route.ts
- 20260810200600_32_onboarding_and_gap_fixes.sql
- public.join_circle
- 20260810045521_18_rls_helper_functions.sql
- public.circle_roster
- digests.spec.ts
- send-digest-push/index.ts
- 20260810044029_16_constraints_and_caps.sql
- public.build_daily_digests
- public.circle_roster
- public.circle_roster
- public.circle_roster
- public.build_daily_digests
- public.circle_roster
- userIdByEmail
- public.run_daily_rollover
- public.trg_goal_achievement_is_final
- private.rollover_user_day
- public.circle_roster
- public.circle_roster
- skeleton.tsx
- 20260828012127_93_admin_moderation_functions.sql
- public.profile_by_username
- 20260810035022_02_users_and_username_history.sql
- public.blocked_accounts
- 20260810041855_08_normalize_ownership_deadline_and_hardening.sql
- public.join_circle
- 20260813045733_60_hint_codes_on_user_facing_raises.sql
- public.circle_roster
- deadlineLabel
- public.progress_entries
- 20260810053407_27_group_helpers_and_owner_settings_guard.sql
- public.groups
- 20260810043149_14_notifications_push_and_digest.sql
- 20260810043744_15_trust_and_safety_tables.sql
- private.circle_checkin_date
- public.job_list_orphan_photos
- purge-expired-photos/index.ts
- 20260810052121_24_rls_helpers_checkin_date_and_goal_owner.sql
- 20260811045000_50_move_job_helpers_to_public_for_service_role.sql
- playwright
- public.goals
- public.goal_group_visibility
- private.is_cycle_member
- public.run_retention_sweep
- public.handle_membership_removal
- public.handle_membership_removal
- public.set_circle_deadline
- public.archive_circle
- error/page.tsx
- reset-ratelimit.mjs
- test-email.mjs
- public.progress_entries
- private.owns_active_goal
- public.create_invite_link
- private.can_view_checkin_photo
- private.invoke_edge_function
- public.set_circle_deadline
- public.my_pending_checkin_timezone
- eslint.config.mjs
- postcss.config.mjs
- vitest.config.mts
- public.audit_log
- public.group_daily_completion
- public.group_member_category_stats
- public.goal_categories
- public.goals
- public.group_members
- public.groups
- public.users
- public.users
- public.push_subscriptions
- public.content_reports
- public.notifications
- public.notifications
- public.content_reports
- public.daily_completion
- public.digest_snapshots
- public.goal_categories
- public.goal_group_visibility
- public.goals
- public.group_cycle_stats
- public.group_cycles
- public.group_members
- public.groups
- public.invite_links
- public.notifications
- public.progress_entries
- public.push_subscriptions
- public.user_blocks
- public.user_lifetime_stats
- public.username_history
- public.users
- public.users
- public.users
- public.progress_entries
- public.progress_entries
- public.goals
- private.is_admin
- public.admin_set_role
- public.users

## God Nodes (most connected - your core abstractions)
1. `createClient()` - 105 edges
2. `requireEnv()` - 48 edges
3. `toMessage()` - 48 edges
4. `ActionResult` - 30 edges
5. `storageStateFor()` - 28 edges
6. `enforce()` - 25 edges
7. `Database` - 23 edges
8. `userIdByEmail()` - 21 edges
9. `admin` - 18 edges
10. `sessionFor()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `CircleSettingsPage()` --calls--> `createClient()`  [EXTRACTED]
  app/(app)/circles/[id]/settings/page.tsx → lib/supabase/server.ts
- `InstallPage()` --calls--> `createClient()`  [EXTRACTED]
  app/onboarding/install/page.tsx → lib/supabase/server.ts
- `NotificationsPage()` --calls--> `createClient()`  [EXTRACTED]
  app/onboarding/notifications/page.tsx → lib/supabase/server.ts
- `OnboardingPage()` --calls--> `createClient()`  [EXTRACTED]
  app/onboarding/page.tsx → lib/supabase/server.ts
- `Home()` --calls--> `createClient()`  [EXTRACTED]
  app/page.tsx → lib/supabase/server.ts

## Import Cycles
- None detected.

## Communities (181 total, 55 thin omitted)

### Community 0 - "push-client.ts"
Cohesion: 0.08
Nodes (40): dismissPushNudgeAction(), metadata, NotificationsSectionPage(), circleLabel(), describe(), hrefFor(), MarkRead(), NotificationRow (+32 more)

### Community 1 - "dependencies"
Cohesion: 0.05
Nodes (40): next, obscenity, dependencies, browser-image-compression, next, obscenity, react, react-dom (+32 more)

### Community 2 - "devDependencies"
Cohesion: 0.06
Nodes (35): eslint, eslint-config-next, jsdom, nodemailer, devDependencies, eslint, eslint-config-next, jsdom (+27 more)

### Community 3 - "enforce"
Cohesion: 0.14
Nodes (18): DEAD_LINK, joinCircle(), JoinButton(), DEAD, EXPLAIN, JoinPage(), metadata, enforce() (+10 more)

### Community 4 - "compilerOptions"
Cohesion: 0.07
Nodes (29): dom, dom.iterable, esnext, **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules (+21 more)

### Community 5 - "photo-upload.ts"
Cohesion: 0.09
Nodes (41): attachCheckinPhoto(), setAvatar(), AvatarForm(), upload(), SAYS, PhotoButton(), remove(), upload() (+33 more)

### Community 6 - "requireEnv"
Cohesion: 0.08
Nodes (26): JOINER(), OWNER(), EMAIL(), FIXTURE, ownerPage(), admin, requireEnv(), EMAIL() (+18 more)

### Community 7 - "settings.ts"
Cohesion: 0.13
Nodes (22): blockedAccounts(), deleteAccount(), exportUserData(), MODES, pendingTimezone(), TodayMode, updatePushShowsCircleName(), updateStatsVisibility() (+14 more)

### Community 8 - "errors.ts"
Cohesion: 0.13
Nodes (12): archiveCircle(), createCircle(), resolveStreakDecision(), ArchivePanel(), CircleSettingsPage(), metadata, StreakDecision(), CreateCircleForm() (+4 more)

### Community 9 - "db.ts"
Cohesion: 0.10
Nodes (26): checkinTimezone(), clearRateLimits(), deleteByPattern(), deleteNotifications(), E2E_PREFIX, forgetParked(), insertNotification(), markUnread() (+18 more)

### Community 10 - "privacy/page.tsx"
Cohesion: 0.17
Nodes (14): metadata, robots(), sitemap(), metadata, PolicyPage(), PolicySection(), CONTACT_EMAIL, formatVersion() (+6 more)

### Community 11 - "today-roster.tsx"
Cohesion: 0.16
Nodes (12): CirclePage(), DigestSummary, formatDeadline(), metadata, MIN_GAP_MS, RefreshOnReturn(), TodayRoster(), formatProgress() (+4 more)

### Community 12 - "app/layout.tsx"
Cohesion: 0.14
Nodes (16): geistMono, geistSans, metadata, viewport, Branch, InstallNudge(), install(), InstallPage() (+8 more)

### Community 13 - "photos.spec.ts"
Cohesion: 0.15
Nodes (17): circleWithLink(), clientFor(), withTempGoal(), assertOk(), circleName(), deleteE2EGoals(), ensureUnfinishedDay(), freeGoalSlots() (+9 more)

### Community 14 - "roster.spec.ts"
Cohesion: 0.22
Nodes (12): createCircleViaApi(), deleteE2ECircles(), findCircleByName(), inviteTokenFor(), setGroupStreak(), diagnose(), createCircleInTheUi(), pages() (+4 more)

### Community 15 - "digest-days.ts"
Cohesion: 0.25
Nodes (13): DigestPanel(), addDays(), DAYS_SHOWN, DigestDay, DigestSnapshot, formatDay(), groupByDay(), orderCircles() (+5 more)

### Community 16 - "supabase/proxy.ts"
Cohesion: 0.19
Nodes (13): contentSecurityPolicy(), CSP_REPORT_GROUP, CSP_REPORT_PATH, FIXED_HEADERS, originOf(), reportingEndpoints(), policy(), PUBLIC_PREFIXES (+5 more)

### Community 17 - "sign-in/page.tsx"
Cohesion: 0.22
Nodes (9): signInWithGoogle(), GET(), metadata, SignInPage(), Home(), LegalFooter(), MESSAGES, Notice() (+1 more)

### Community 18 - "createClient"
Cohesion: 0.16
Nodes (23): checkIn(), removeCheckinPhoto(), setNoteSharing(), undoCheckIn(), achieveGoal(), archiveGoal(), createGoal(), setCircleVisibility() (+15 more)

### Community 19 - "database.types.ts"
Cohesion: 0.05
Nodes (54): leaveToday(), markTodaySeen(), CirclesSectionPage(), metadata, CircleRow, CirclesPanel(), ArchivedGoalsPage(), metadata (+46 more)

### Community 20 - "20260811045639_51_close_unwritten_state_gaps.sql"
Cohesion: 0.17
Nodes (12): public.trg_audit_invite_toggle, public.trg_audit_role_change, group_members_audit_role_change, invite_links_audit_toggle, public.handle_membership_removal(), public.join_circle(), public.resolve_streak_decision(), public.group_members (+4 more)

### Community 21 - "20260810202140_34_live_daily_completion_triggers.sql"
Cohesion: 0.13
Nodes (11): public.trg_goal_achieved_counter, public.trg_goal_completion_recount, public.trg_progress_entry_completion, goals_count_achievement, goals_maintain_completion, private.checkin_date_for(), private.recompute_daily_completion(), progress_entries_maintain_completion (+3 more)

### Community 22 - "graph-freshness.mjs"
Cohesion: 0.14
Nodes (12): candidates(), ext(), INDEXED, manifest, missingTracked, missingUntracked, modified, NEVER_INDEXED (+4 more)

### Community 23 - "invite-panel.tsx"
Cohesion: 0.33
Nodes (7): generateInviteLink(), revokeInviteLink(), formatExpiry(), InvitePanel(), noSubscribe(), readOrigin(), serverOrigin()

### Community 24 - "admin.ts"
Cohesion: 0.13
Nodes (17): amIAdmin(), listAdmins(), reportDetail(), reportQueue(), ReportStatus, resolveReport(), setRole(), AdminLayout() (+9 more)

### Community 25 - "20260810042820_13_stats_and_streak_tables.sql"
Cohesion: 0.20
Nodes (12): gmcs_set_updated_at, group_cycle_stats_set_updated_at, public.group_cycle_stats, public.group_daily_completion, public.group_member_category_stats, public.user_lifetime_stats, public.goal_categories, public.group_cycles (+4 more)

### Community 26 - "moderation.ts"
Cohesion: 0.19
Nodes (12): blockUser(), referenceIsValid(), REPORTABLE, reportContent(), ReportType, revalidateAfterBlockChange(), unblockUser(), ReportCheckin() (+4 more)

### Community 27 - "[username]/page.tsx"
Cohesion: 0.22
Nodes (10): signOut(), Profile, profileByUsername(), signedAvatarUrl(), AppLayout(), metadata, OwnProfilePage(), PublicProfilePage() (+2 more)

### Community 28 - "sections.ts"
Cohesion: 0.43
Nodes (5): activeSection(), BadgeKey, Section, SECTIONS, TabBar()

### Community 29 - "public.export_user_data"
Cohesion: 0.17
Nodes (10): private.list_expired_photos(), public.export_user_data(), public.daily_completion, public.goal_categories, public.goals, public.group_members, public.groups, public.progress_entries (+2 more)

### Community 30 - "server.ts"
Cohesion: 0.27
Nodes (8): completeOnboarding(), noSubscribe(), OnboardingForm(), readTimezone(), serverTimezone(), metadata, OnboardingPage(), createAdminClient()

### Community 31 - "20260810055111_31_circle_rpcs.sql"
Cohesion: 0.27
Nodes (9): public.circle_preview(), public.cycle_continue(), public.cycle_reset(), public.join_circle(), public.transfer_ownership(), public.group_members, public.groups, public.invite_links (+1 more)

### Community 32 - "public.export_user_data"
Cohesion: 0.18
Nodes (9): public.export_user_data(), public.daily_completion, public.goal_categories, public.goals, public.group_members, public.groups, public.progress_entries, public.user_lifetime_stats (+1 more)

### Community 33 - "public.circle_roster"
Cohesion: 0.20
Nodes (9): private.checkin_date_at(), public.circle_roster(), public.goal_group_visibility, public.goals, public.group_cycles, public.group_members, public.groups, public.progress_entries (+1 more)

### Community 34 - "csp-report/route.ts"
Cohesion: 0.20
Nodes (10): noContent(), POST(), runtime, CspViolation, isRecord(), normalise(), num(), parseCspReport() (+2 more)

### Community 35 - "20260810200600_32_onboarding_and_gap_fixes.sql"
Cohesion: 0.22
Nodes (8): public.handle_membership_removal, group_members_on_removal, public.complete_onboarding(), public.create_invite_link(), public.sync_checkin_timezone(), pg_catalog.pg_timezone_names, public.group_members, public.username_history

### Community 36 - "public.join_circle"
Cohesion: 0.27
Nodes (8): public.trg_disable_links_on_status_change, groups_disable_links_on_status_change, public.circle_preview(), public.join_circle(), public.group_members, public.groups, public.invite_links, public.user_blocks

### Community 37 - "20260810045521_18_rls_helper_functions.sql"
Cohesion: 0.27
Nodes (9): private.is_blocked_by(), private.is_goal_hidden_in_group(), private.is_group_admin(), private.is_group_member(), private.is_group_owner(), private.shares_group_with(), public.goal_group_visibility, public.group_members (+1 more)

### Community 38 - "public.circle_roster"
Cohesion: 0.22
Nodes (9): private.is_goal_hidden_in_group(), public.circle_roster(), public.goal_group_visibility, public.goals, public.group_cycles, public.group_members, public.groups, public.progress_entries (+1 more)

### Community 39 - "digests.spec.ts"
Cohesion: 0.39
Nodes (6): checkinDateFor(), daysBack(), deleteDigests(), seedDigests(), OWNER(), seededCircle()

### Community 40 - "send-digest-push/index.ts"
Cohesion: 0.28
Nodes (5): digest, CRON_SECRET, VAPID_PRIVATE, VAPID_PUBLIC, teaser

### Community 41 - "20260810044029_16_constraints_and_caps.sql"
Cohesion: 0.22
Nodes (8): public.enforce_active_goal_cap, public.enforce_group_member_cap, goals_enforce_active_cap, group_members_enforce_cap, public.enforce_active_goal_cap(), public.enforce_group_member_cap(), public.goals, public.group_members

### Community 42 - "public.build_daily_digests"
Cohesion: 0.22
Nodes (8): public.build_daily_digests(), public.daily_completion, public.digest_snapshots, public.group_cycle_stats, public.group_cycles, public.group_members, public.groups, public.users

### Community 43 - "public.circle_roster"
Cohesion: 0.22
Nodes (8): public.circle_roster(), public.goal_group_visibility, public.goals, public.group_cycles, public.group_members, public.groups, public.progress_entries, public.users

### Community 44 - "public.circle_roster"
Cohesion: 0.22
Nodes (8): public.circle_roster(), public.goal_group_visibility, public.goals, public.group_cycles, public.group_members, public.groups, public.progress_entries, public.users

### Community 45 - "public.circle_roster"
Cohesion: 0.25
Nodes (8): private.can_view_checkin_photo(), public.circle_roster(), public.goals, public.group_cycles, public.group_members, public.groups, public.progress_entries, public.users

### Community 46 - "public.build_daily_digests"
Cohesion: 0.22
Nodes (8): public.build_daily_digests(), public.daily_completion, public.digest_snapshots, public.group_cycle_stats, public.group_cycles, public.group_members, public.groups, public.users

### Community 47 - "public.circle_roster"
Cohesion: 0.25
Nodes (7): public.circle_roster(), public.goals, public.group_cycles, public.group_members, public.groups, public.progress_entries, public.users

### Community 48 - "userIdByEmail"
Cohesion: 0.24
Nodes (12): ACCOUNTS, sessionCookiesFor(), AUTH_DIR, E2EAccount, statePath(), userIdByEmail(), globalTeardown(), clearSavedModes() (+4 more)

### Community 49 - "public.run_daily_rollover"
Cohesion: 0.25
Nodes (7): locked, public.run_daily_rollover(), public.set_checkin_timezone(), pg_catalog.pg_timezone_names, public.group_cycles, public.group_members, public.users

### Community 50 - "public.trg_goal_achievement_is_final"
Cohesion: 0.25
Nodes (7): public.trg_goal_achievement_is_final, goals_achievement_is_final, public.trg_goal_achievement_is_final(), public.goal_categories, public.goals, public.user_lifetime_stats, public.users

### Community 51 - "private.rollover_user_day"
Cohesion: 0.29
Nodes (6): private.rollover_user_day(), public.run_daily_rollover(), public.daily_completion, public.group_cycles, public.group_members, public.users

### Community 52 - "public.circle_roster"
Cohesion: 0.29
Nodes (7): private.current_checkin_date(), public.circle_roster(), public.goal_group_visibility, public.goals, public.group_members, public.progress_entries, public.users

### Community 53 - "public.circle_roster"
Cohesion: 0.25
Nodes (7): public.circle_roster(), public.goals, public.group_cycles, public.group_members, public.groups, public.progress_entries, public.users

### Community 56 - "public.profile_by_username"
Cohesion: 0.40
Nodes (4): public.profile_by_username(), public.user_blocks, public.user_lifetime_stats, public.users

### Community 57 - "20260810035022_02_users_and_username_history.sql"
Cohesion: 0.33
Nodes (5): auth.users, public.handle_new_user, on_auth_user_created, public.username_history, public.users

### Community 58 - "public.blocked_accounts"
Cohesion: 0.50
Nodes (3): public.blocked_accounts(), public.user_blocks, public.users

### Community 59 - "20260810041855_08_normalize_ownership_deadline_and_hardening.sql"
Cohesion: 0.43
Nodes (5): goals_set_updated_at, group_members_set_updated_at, groups_set_updated_at, public.set_updated_at, users_set_updated_at

### Community 60 - "public.join_circle"
Cohesion: 0.38
Nodes (6): public.circle_preview(), public.join_circle(), public.group_members, public.groups, public.invite_links, public.user_blocks

### Community 61 - "20260813045733_60_hint_codes_on_user_facing_raises.sql"
Cohesion: 0.33
Nodes (5): public.create_invite_link(), public.enforce_active_goal_cap(), public.enforce_group_member_cap(), public.goals, public.group_members

### Community 62 - "public.circle_roster"
Cohesion: 0.29
Nodes (6): public.circle_roster(), public.goal_group_visibility, public.goals, public.group_members, public.progress_entries, public.users

### Community 63 - "deadlineLabel"
Cohesion: 0.47
Nodes (6): Deadline(), Goal, GoalsSummary(), deadlineLabel(), format(), isOverdue()

### Community 64 - "public.progress_entries"
Cohesion: 0.40
Nodes (5): public, public.daily_completion, public.progress_entries, public.goals, public.users

### Community 65 - "20260810053407_27_group_helpers_and_owner_settings_guard.sql"
Cohesion: 0.33
Nodes (4): public.guard_group_owner_only_settings, groups_guard_owner_only_settings, private.member_role(), public.group_members

### Community 66 - "public.groups"
Cohesion: 0.67
Nodes (5): public.group_cycles, public.group_members, public.groups, public.invite_links, public.users

### Community 67 - "20260810043149_14_notifications_push_and_digest.sql"
Cohesion: 0.40
Nodes (5): public.digest_snapshots, public.notifications, public.push_subscriptions, public.groups, public.users

### Community 68 - "20260810043744_15_trust_and_safety_tables.sql"
Cohesion: 0.47
Nodes (5): public.audit_log, public.content_reports, public.user_blocks, public.groups, public.users

### Community 69 - "private.circle_checkin_date"
Cohesion: 0.40
Nodes (5): private.circle_checkin_date(), public.run_daily_rollover(), public.group_cycles, public.group_members, public.users

### Community 70 - "public.job_list_orphan_photos"
Cohesion: 0.60
Nodes (4): storage.objects, public.job_list_orphan_photos(), public.job_null_missing_photos(), public.progress_entries

### Community 72 - "20260810052121_24_rls_helpers_checkin_date_and_goal_owner.sql"
Cohesion: 0.40
Nodes (4): private.current_checkin_date(), private.owns_goal(), public.goals, public.users

### Community 74 - "playwright"
Cohesion: 0.50
Nodes (3): npx, playwright, @playwright/mcp

### Community 75 - "public.goals"
Cohesion: 0.67
Nodes (3): public.goal_categories, public.goals, public.users

### Community 76 - "public.goal_group_visibility"
Cohesion: 0.50
Nodes (3): public.goal_group_visibility, public.goals, public.groups

### Community 77 - "private.is_cycle_member"
Cohesion: 0.50
Nodes (3): private.is_cycle_member(), public.group_cycles, public.group_members

### Community 78 - "public.run_retention_sweep"
Cohesion: 0.50
Nodes (3): public.run_retention_sweep(), public.digest_snapshots, public.notifications

### Community 79 - "public.handle_membership_removal"
Cohesion: 0.50
Nodes (3): public.handle_membership_removal(), public.group_members, public.users

### Community 80 - "public.handle_membership_removal"
Cohesion: 0.50
Nodes (3): public.handle_membership_removal(), public.group_members, public.users

### Community 81 - "public.set_circle_deadline"
Cohesion: 0.50
Nodes (3): public.set_circle_deadline(), public.group_members, public.groups

### Community 82 - "public.archive_circle"
Cohesion: 0.50
Nodes (3): public.archive_circle(), public.group_members, public.groups

### Community 86 - "public.progress_entries"
Cohesion: 0.67
Nodes (3): public.goals, public.progress_entries, public.users

## Knowledge Gaps
- **185 isolated node(s):** `npx`, `@playwright/mcp`, `metadata`, `Category`, `Circle` (+180 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **55 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createClient()` connect `createClient` to `push-client.ts`, `enforce`, `photo-upload.ts`, `settings.ts`, `errors.ts`, `today-roster.tsx`, `app/layout.tsx`, `sign-in/page.tsx`, `database.types.ts`, `invite-panel.tsx`, `admin.ts`, `moderation.ts`, `[username]/page.tsx`, `server.ts`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Why does `Database` connect `database.types.ts` to `enforce`, `photo-upload.ts`, `requireEnv`, `db.ts`, `today-roster.tsx`, `photos.spec.ts`, `digest-days.ts`, `userIdByEmail`, `supabase/proxy.ts`, `admin.ts`, `moderation.ts`, `server.ts`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Why does `requireEnv()` connect `requireEnv` to `digests.spec.ts`, `db.ts`, `photos.spec.ts`, `roster.spec.ts`, `userIdByEmail`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **What connects `npx`, `@playwright/mcp`, `metadata` to the rest of the system?**
  _185 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `push-client.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08408163265306122 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.05714285714285714 - nodes in this community are weakly interconnected._