-- Step 19. The four types a Circle can talk with.
--
-- **Alone, because an enum value added inside a transaction cannot be used in
-- that transaction.** Migrations 88 and 97 exist for the same reason; 103
-- inserts rows of these types, so it cannot be this file.
--
-- What each one is for, and why each is safe to send:
--   goal_achieved         rare by construction: achieving is final (83)
--   circle_first_finisher at most one per Circle per day, whatever the size
--   last_one_left         at most one per Circle per day, to one person
--   circle_activity       coalesced into an undelivered row; see 103
alter type public.notification_type add value if not exists 'goal_achieved';
alter type public.notification_type add value if not exists 'circle_first_finisher';
alter type public.notification_type add value if not exists 'last_one_left';
alter type public.notification_type add value if not exists 'circle_activity';
