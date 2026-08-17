/**
 * Deletes whatever a crashed run left behind. `npm run test:e2e:clean`.
 *
 * The suite cleans up in `afterAll`, but a run killed mid-test does not get
 * there, and these tests write to a real project rather than a local stack.
 *
 * Matches on the `E2E ` name prefix only, so it cannot touch a Circle you made
 * yourself unless you named it that.
 */
import {
  deleteE2ECircles,
  deleteE2EGoals,
  restoreParkedGoals,
  admin,
  E2E_PREFIX,
} from "./db"

const { data: before } = await admin
  .from("groups")
  .select("id, name")
  .like("name", `${E2E_PREFIX}%`)

if (!before?.length) {
  console.log("No Circles to clean.")
} else {
  console.log(`Deleting ${before.length} Circle(s):`)
  for (const g of before) console.log(`  ${g.name}`)
  await deleteE2ECircles()
}

// Goals too, and this half matters more. A stray Circle is only clutter; a
// stray goal counts against the 10-active cap, and once enough accumulate every
// spec that seeds a goal fails before its first assertion with an error naming
// the cap rather than the leak.
const goals = await deleteE2EGoals()
console.log(goals ? `Deleted ${goals} stray E2E goal(s).` : "No stray goals.")

// And the other direction: goals belonging to the *user* that a killed run
// archived to get them out of a fixture's way. Leaving those archived is the
// worst thing this suite can do to a real account, so it is the last thing
// cleaned and the loudest thing reported.
const parked = await restoreParkedGoals()
console.log(parked ? `Restored ${parked} parked goal(s) of your own.` : "None parked.")
console.log("Done.")
