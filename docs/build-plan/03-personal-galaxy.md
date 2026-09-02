# Part 3: the personal galaxy

**A compact panel on `/dashboard` Overview. One sun, your own goals.**

This part exists to de-risk part 4. Everything in it — the mount lifecycle, the touch-scroll behaviour, the snapshot round trip, the light-mode question — is a problem the Circle galaxy has too, on a surface where getting it wrong affects one person's own view of their own data.

---

## What it must not become

**The galaxy is a reward for using the app, not a way to use it.**

Everything it shows is already legible elsewhere: goals on `/dashboard`, achievements on `/dashboard/goals/archived`, the day in the streak header. **If checking in is ever only possible by clicking a planet, the product has a WebGL dependency for its core loop** — on a device that may have lost its context, in a canvas no screen reader can enter.

So every galaxy surface is additive, and every route stays fully usable with the canvas absent. That is what makes `ssr: false` and a blank canvas survivable rather than fatal.

`onPlanetSelect` is worth wiring as a *shortcut* to a goal, beside the list that already links there.

---

## Where it goes

Overview is currently two panels and a way out: today's goals with their controls, and the daily digest. The galaxy is a third — and it is **the reason the summary that restated goal titles was deleted rather than restyled.** That space is now free for something that says the same thing in a form worth looking at.

| Decision | Chosen |
|---|---|
| Size | Compact. The module has `isCompactLayout` at ≤420px wide or ≤320px tall, with its own yaw, tilt and star scale for it |
| Camera controls | **Off here.** A pannable canvas inside a scrolling page fights the scroll on touch, which is the entire interaction on this surface |
| Interaction | Tap a planet → the goal. Nothing else |
| Host | `overflow-hidden` and an explicit height, or the canvas bleeds over the panel below |

**The scroll question is real and CSS does not solve it.** Pixi's pointer handling on a full-bleed canvas will swallow vertical drags unless the compact mount leaves them alone. G1 in part 5 is the check, and it must be done with a thumb — a mouse in a desktop browser will never show it.

---

## The one design decision this part needs

**`DEFAULT_BACKGROUND` is a hardcoded near-black, `0x07070e`.** Solarity has real light and dark modes: `globals.css` swaps colour variables under `prefers-color-scheme` and sets `color-scheme: light dark`.

**A black rectangle in an otherwise light app is a decision, not a default to inherit.** `background` is a `MountOptions` field, so either answer is a one-line change — but it has to be answered rather than arrived at:

| Option | Consequence |
|---|---|
| **Always dark**, whatever the app's scheme | A galaxy is a night sky. Consistent between light and dark mode, and the nine category colours were chosen to glow on black — `#FFD500` and `#6EE62E` are near-unreadable on white and unmistakable on black |
| **Follow the scheme**, with a light-mode background | Coherent with the page around it. Needs the whole palette re-checked for contrast against a light sky, and the module has no light theme today |

**The recommendation is always dark**, because the palette already decided it: those hexes were seeded in migration 4 for this renderer, and they are saturated for a reason. Pass the value from a token either way, so it is nameable rather than buried in `MountOptions`.

This is the only decision part 6 needs to make early, which is why part 6 is otherwise deferred.

---

## Two systems that look like one

Written here because the handoff warns about it twice and it is the kind of thing that gets merged during a refactor:

| System | Trigger | Data | Visual |
|---|---|---|---|
| **Stars** | Every achievement | `stars[]` | Permanent background dots |
| **Sky ambience** | Every **5th** achievement | `achievementCount` → tier 0–3 | Shooting stars, asteroids |

**Achieving your 5th goal changes the sky. Achieving your 6th does not.** Forgetting to pass `achievementCount` leaves the tier stalled at 0 forever with no error — the stars still appear, so it looks like it works.

`SKY_AMBIENCE_TIER_LABELS` exists if the app ever wants to name the milestone in words. If it does, that copy belongs in `notification-copy.md` with everything else, not inline in a component.

---

## Accessibility

`GalaxyView` renders `role="img"` with `aria-label="Galaxy"`. **That is a static label on a live visualization**, and it tells a screen-reader user nothing the heading above it did not.

**Decide between two answers rather than shipping both**, because a described image and a hidden one are different answers to "is this content or decoration":

| Answer | When it is right |
|---|---|
| **`aria-hidden`** | Every fact in the canvas is already on the page in text — which on `/dashboard` it is. Hiding decoration and letting the real content speak is more honest than narrating it. **Recommended here** |
| **A state-describing label**, rebuilt as the snapshot changes | "Your galaxy: 4 planets, 2 shining today, 11 stars". Right if the galaxy ever carries a fact the page does not |

`prefers-reduced-motion` is already honoured at thirteen call sites inside the scene. **Verify it rather than re-implement it.**

---

## Steps

| | Step | Done when |
|---|---|---|
| 3a | The light/dark background decision | Written down here with the reason, and passed as a token |
| 3b | The server reader and the client wrapper | A `"use client"` component takes the snapshot as a prop; the page imports that. **`dynamic(ssr: false)` cannot live in a Server Component** in Next 16 |
| 3c | The panel on Overview | `dashboard.spec.ts` passes **untouched**, which is the proof it stayed additive |
| 3d | `onPlanetSelect` → the goal | Beside the list, not instead of it |
| 3e | G1–G8 and G10 on a real iPhone | Part 5 |
