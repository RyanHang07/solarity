# Part 2: data and schema

**Two migrations, and one semantic the adapter guessed wrong.**

Scope note: v1 is **cosmetics stored, not editable**. There is no settings editor and no `user_galaxy_prefs` table — sun colour and nebula stay at their defaults, and `buildGalaxySnapshot` accepts an empty cosmetics object. That removes a table, a settings surface and a live preview from this part, and it can be added later without changing anything below.

---

## The mapping, stated once

The adapter takes four inputs. None of them is the table you would guess from the field name.

| Adapter input | Solarity source | Note |
|---|---|---|
| `goals[]` → planets | `goals` where `archived_at is null` **and `achieved_at is null`** | An achieved goal is not a planet. Capped at 10 by `GOAL_LIMIT` |
| `achievements[]` → stars | **`goals` where `achieved_at is not null`** | **There is no achievements table**, and there does not need to be one. Achieving is irreversible (step 14), so the goal leaves the active list and becomes permanent — exactly what the galaxy does with it: the planet is removed and a star is added. The two models agree by accident, and the accident is worth writing down |
| `goals[].shine` | A `progress_entries` row for the goal on **that user's** check-in date | Not today's date. `current_checkin_date()` answers for the caller, and the 2 AM boundary is per person |
| `goals[].categorySlug` | `goal_categories.slug` via `goals.category_id` | By slug, never by uuid — the uuid differs per environment and migration 4 says so |
| `cosmetics` | `{}` in v1 | Defaults resolve to `DEFAULT_SUN_COLOR` and no nebula |
| `goalCosmetics` | Migration 107 below | Rolled at goal creation, never at render |

**`dayClosed`** is `computeDayClosed(goals)` in the adapter, and Solarity already has this stored: `daily_completion.all_completed`. **Prefer the stored value.** A day with zero active goals is written `false`, never skipped, and the adapter's `goals.length > 0 && every(shine)` happens to agree — but one is derived by a trigger the streak depends on, and the other is a helper in a render module.

---

## The semantic the adapter got wrong

`SolarityGoalRow` has a `hidden?: boolean`, and `buildGalaxySnapshotForUser` filters those goals out of the planets while still counting them for `dayClosed`.

**There is no such field on a goal.** Hiding is `goal_group_visibility (goal_id, group_id, hidden)` — **per Circle**. A goal is hidden *from a particular Circle*, not hidden in general.

So in **part 3, the personal galaxy, nothing is hidden.** It is your own view of your own goals, and applying a per-Circle mask there would reproduce a bug this codebase has already shipped once: `patterns.md`, "an exemption applied to one field of a rule, not its siblings" — `circle_roster` masked your own goal's title from *you*, and `can_view_checkin_photo` hid your own photo from yourself.

**Drop `hidden` from the row type** rather than pass `false`. A field that must always be false is a field someone eventually sets.

In **part 4 it becomes real**, per Circle, and it is handled by migration 108 below rather than by a boolean on a goal.

---

## Migration 107: `goal_cosmetics`

The handoff ships `sql/001_galaxy_cosmetics.sql`. **It is a sketch, not a migration**, and it breaks four standing rules of this project. Take the columns; rewrite the rest.

| Handoff SQL | Solarity requires |
|---|---|
| `references auth.users (id)` | **`references public.users (id)`.** Every table here hangs off `public.users`, whose row is created by the `on_auth_user_created` trigger |
| No RLS | **RLS enabled in the migration.** `patterns.md` shape 1: no migration enabled RLS once, the dashboard's event trigger did it invisibly, and a rebuild produced an open database |
| No grants | **Grants are checked before RLS**, so no policy rescues a missing one |
| Unqualified names | `search_path = ''` and fully qualified names, as every function since migration 7 |

Also drop `user_galaxy_prefs` from the sketch entirely — not in v1.

```
goal_cosmetics
  goal_id        uuid primary key references public.goals(id) on delete cascade
  user_id        uuid not null references public.users(id) on delete cascade
  planet_radius  smallint check (planet_radius between 10 and 20)
  surface_kind   text check (surface_kind in ('terra','gas','arid','ice','lava','storm'))
  belt_mode      text not null default 'auto' check (belt_mode in ('auto','on','off'))
  belt_visible   boolean
  updated_at     timestamptz not null default now()
```

**Two things the sketch gets right, and one it is silent on.**

Right: the `planet_radius` range and the `surface_kind` CHECK — exactly the shape this codebase wants (`patterns.md`, "a text column with no CHECK, filled by a client").

Silent: **`user_id` duplicates what `goal_id` already determines.** Keep it, because RLS wants to answer "is this mine?" without joining `goals` on every row, and part 4 reads cosmetics for ten people at once. But it must be **derived, not accepted from the client** — set it from `goals.user_id` inside the insert path, or a client can file cosmetics for someone else's goal under their own id.

**The roll happens once, at creation, and is then permanent.** If it were rolled at render time the planet would change appearance on every load — the kind of thing nobody reports and everybody notices.

**Which means goal creation gains a second write, and the two must not drift.** Both writes go inside the existing `create_goal` RPC, with the roll passed in as parameters: one transaction, no orphan possible. **`GOAL_LIMIT` is raised inside that RPC**, so an eleventh goal that fails must not leave a cosmetics row behind — which one transaction gives for free and two client calls do not.

### The backfill, which is not optional

**Every goal that already exists has no cosmetics row.** Without a backfill, existing goals render with defaults while new ones vary — a difference that is visible and unexplainable.

Reproducing `createGoalCosmeticsRoll`'s distribution in SQL would be a second implementation of the same rule. **Run it as a one-off script that imports the real function**, and record in `history.md` that it ran.

---

## Migration 108: the roster carries categories

**Part 4 cannot render a single circle-mate's planet without this.** `circle_roster` returns, per goal: `id`, `title` (masked when hidden), `hidden`, `checked`, `note`, `entry_id`, `note_shared`, `photo_url`. **It returns no category, for anybody** — so there is no colour for any planet but your own.

Add `category_slug` to the goals payload. **And the colour of a hidden goal is a masking decision, not plumbing.**

### The decision taken, deliberately

**Hidden goals get their category colour, for everyone.** Asked twice, including a middle option that would have coloured only your own; confirmed both times.

**What it costs, recorded so it is a decision rather than an oversight.** There are nine categories with nine fixed, distinct hex values, so **the colour is the category** — it is not a fuzzy signal. A coloured, untitled planet tells the other nine members of a Circle that you have a hidden goal in "Mindfulness & Mental Health" or "Health & Wellness". Migration 64 exists to withhold exactly this class of inference: it masks title, note and photo for hidden goals, and this widens what a circle-mate can learn about a goal you chose to hide.

**What it does not change.** Circle-mates already know a hidden goal *exists* and whether it was checked — `hidden` and `checked` are both in the payload today, because the day's fraction has to be honest. The title, the note and the photo stay masked. This adds the category and nothing else.

**Revisiting it is cheap**, and worth saying: switching to neutral-for-others later is a change to one `case` expression in the roster RPC, since `is_self` is already in scope there. Nothing in the renderer would need to change.

The migration follows the roster's existing shape — `security definer`, `search_path = ''`, the masking expressed as a `case` beside the existing ones, and a rolled-back proof **with a negative control** showing a non-member gets nothing.

---

## Steps

| | Step | Proof |
|---|---|---|
| 2a | Migration 107, `goal_cosmetics` | Rolled-back: another user cannot select or update the row, with a negative control showing the owner can. A CHECK rejects `surface_kind = 'plaid'` and `planet_radius = 40` |
| 2b | `create_goal` writes both rows in one transaction | Rolled-back: the eleventh goal raises `GOAL_LIMIT` and leaves **no** cosmetics row |
| 2c | Backfill script | `goals` without a cosmetics row is zero; the count is recorded in `history.md` |
| 2d | Migration 108, `category_slug` on the roster | Rolled-back, as a real circle-mate: a visible goal carries its slug, a hidden goal carries its slug and a null title, and a non-member gets nothing |
| 2e | Regenerate `lib/database.types.ts` | Properly — it has been hand-patched as a delta since migration 106. Preserve `graphql_public`, which the MCP generator omits |
| 2f | The readers, in `lib/galaxy/solarity/` | Unit tests over the mapping, especially `shine` against a per-user check-in date |

**Every migration follows the standing routine**: assertions at the bottom, apply through the MCP, **write the file under the version the server recorded**, prove `md5(prosrc)` matches, and commit the file. Applying without committing leaves the repo claiming a schema it does not have, and nothing in CI notices.
