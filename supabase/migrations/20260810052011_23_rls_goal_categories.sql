-- Solarity RLS, step 4d: reference data
-- goal_categories
--
-- The only table in the schema where the answer to "who can read this?" is
-- "everyone signed in". It is a fixed, seeded, non-sensitive lookup list that
-- the goal-creation form has to render before a user has any goals, circles, or
-- relationships at all.
--
-- Still scoped to `authenticated` rather than made public: anon holds no grants
-- anywhere in this system (section 4), and an unauthenticated visitor has no
-- screen that needs a category list.

create policy goal_categories_select_all on public.goal_categories
  for select to authenticated
  using (true);

grant select on public.goal_categories to authenticated;

-- No INSERT / UPDATE / DELETE policy or grant. The list is fixed at launch and
-- managed by migration or direct insert under service_role. More importantly,
-- `color_hex` is denormalized into galaxy_stars at achievement time and
-- `category_id` is a live FK from goals, so a client-side edit would
-- retroactively recolour every existing goal referencing it (section 11).

comment on policy goal_categories_select_all on public.goal_categories is
  'Read-only reference data. USING (true) is intentional: the list is identical '
  'for every user and contains nothing sensitive.';;
