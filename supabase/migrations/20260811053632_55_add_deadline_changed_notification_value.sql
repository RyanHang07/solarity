-- Adding the enum value only. Postgres rejects using a newly added value in the
-- same transaction that added it ("unsafe use of new value of enum type"), so
-- the write lands in the next migration.
--
-- Needed because dropping the two-day notice rule means a deadline can now move
-- to tomorrow with nothing telling members it happened.

alter type public.notification_type add value 'deadline_changed';;
