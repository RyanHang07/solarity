-- 1. Users may delete their own notifications.
--
--    Notifications are a delivery inbox, not a historical record. What actually
--    happened lives in audit_log: append-only, no client read policy, FKs that
--    SET NULL rather than cascade so it survives account deletion. Duplicating
--    that history into the one table the user controls buys nothing, and
--    retaining rows after someone taps "delete" is only defensible when the
--    retention is genuinely needed.

create policy notifications_delete_own on public.notifications
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant delete on public.notifications to authenticated;

-- 2. Record membership arrivals and departures.
--
--    audit_log covered kicks, role changes, transfers, invite-link changes,
--    deadline changes, cycle resets and streak decisions — but not joining or
--    voluntarily leaving. group_members.joined_at answers "when did they join"
--    only while they are still a member, and vanishes the moment they leave, so
--    "was this person ever in this circle, and when" became unanswerable after
--    the fact. That matters given the kick / block / re-invite flows in
--    section 20.

alter type public.audit_action_type add value 'member_joined';
alter type public.audit_action_type add value 'member_left';;
