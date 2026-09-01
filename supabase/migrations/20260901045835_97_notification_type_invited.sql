-- Step 18b. `invited`, on its own, because Postgres insists.
--
-- **An enum value added inside a transaction cannot be used in that
-- transaction** ("unsafe use of new value"). Migration 88 exists for exactly
-- this reason and this is the same rule, not a stylistic echo: migration 98
-- inserts a notification of this type, so it cannot be in this file.
alter type public.notification_type add value if not exists 'invited';
