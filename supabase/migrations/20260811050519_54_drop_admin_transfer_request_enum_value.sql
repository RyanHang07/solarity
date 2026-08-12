-- Drop admin_transfer_request from notification_type.
--
-- It implied ownership transfer required the recipient's acceptance, but
-- transfer_ownership completes immediately, and automatic succession already
-- assigns ownership without consent when an owner deletes their account.
-- Keeping it left the enum misdescribing how the system actually works.
--
-- Postgres cannot drop an enum value in place, so the type is rewritten. This is
-- as cheap as it will ever be: verified zero rows use the value, and doing it
-- after launch would mean rewriting a populated column.

alter type public.notification_type rename to notification_type_old;

create type public.notification_type as enum (
  'digest',
  'kicked',
  'invite_accepted',
  'group_locked_renewal'
);

alter table public.notifications
  alter column type type public.notification_type
  using type::text::public.notification_type;

drop type public.notification_type_old;

comment on column public.notifications.type is
  'Every value has a writer: digest (build_daily_digests), kicked '
  '(handle_membership_removal), invite_accepted (join_circle), '
  'group_locked_renewal (run_daily_rollover). cosmetic_unlocked joins this list '
  'when the galaxy ships — add the value in one migration, use it in the next.';;
