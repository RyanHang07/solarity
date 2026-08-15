/**
 * Deletes whatever a crashed run left behind. `npm run test:e2e:clean`.
 *
 * The suite cleans up in `afterAll`, but a run killed mid-test does not get
 * there, and these tests write to a real project rather than a local stack.
 *
 * Matches on the `E2E ` name prefix only, so it cannot touch a Circle you made
 * yourself unless you named it that.
 */
import { deleteE2ECircles, admin, E2E_PREFIX } from "./db"

const { data: before } = await admin
  .from("groups")
  .select("id, name")
  .like("name", `${E2E_PREFIX}%`)

if (!before?.length) {
  console.log("Nothing to clean.")
} else {
  console.log(`Deleting ${before.length}:`)
  for (const g of before) console.log(`  ${g.name}`)
  await deleteE2ECircles()
  console.log("Done.")
}
