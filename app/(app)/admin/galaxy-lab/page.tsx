import { GalaxyLab } from "./lab"

export const metadata = { title: "Galaxy lab — Solarity" }

/**
 * Step 26's instrument: a Circle of any size, drawn on the device in your hand.
 *
 * ## Why this exists when the playground already does it
 *
 * `pixijs-galaxy` stages 1–10 members with an fps and worst-frame readout, and
 * has since step 4c. What it cannot do is run **on a phone, in the real shell,
 * with the real page around it** — the header, the roster below, the viewhole,
 * the app's own CSS, and Safari rather than a desktop Chromium. Those are the
 * conditions the number is wanted for. The playground measures the renderer;
 * this measures the renderer *in Solarity*.
 *
 * ## Nothing is written
 *
 * The Circle is fabricated in memory. **No members are created, no goals are
 * inserted, and there is nothing to clean up** — which is the difference
 * between a tool you can open on production and a tool that leaves ten
 * fabricated accounts in `auth.users` that the app has no way to delete.
 *
 * The trade is stated rather than hidden: this measures the **renderer**, not
 * `circle_roster` at ten members. That query's cost is a separate question with
 * a separate answer, and conflating them would have meant writing rows to learn
 * something about a canvas.
 *
 * ## The gate is the admin layout's
 *
 * `(app)/admin/layout.tsx` calls `amIAdmin()` and answers `notFound()` — a 404
 * rather than a 403, because a 403 confirms there is something here worth being
 * refused from. This page adds no check of its own precisely so there is one
 * gate rather than two that could disagree.
 *
 * **It reads nothing and writes nothing**, so unlike every other admin screen
 * there is no second refusal in the database underneath it. That is safe here
 * and is the reason to keep it that way: the day this page needs data, it needs
 * an RPC that refuses on its own.
 */
export default function GalaxyLabPage() {
  return <GalaxyLab />
}
