-- Advisor follow-up.
--
-- 1. Drop a redundant index I created in step 2f. daily_completion's primary
--    key already indexes (user_id, date); Postgres scans a btree backwards
--    just as efficiently as forwards, so a separate DESC index buys nothing
--    and costs write throughput plus storage.
drop index public.daily_completion_user_date_idx;

-- 2. Cover two foreign keys that had no index (linter 0001).
--
--    An unindexed FK is slow in a specific and easy-to-miss way: every DELETE
--    or key UPDATE on the *parent* table must scan the entire child table to
--    check for referencing rows. goal_categories is small, but the scan is of
--    public.goals, which is not.
create index goals_category_id_idx on public.goals (category_id);
create index invite_links_created_by_idx on public.invite_links (created_by);;
