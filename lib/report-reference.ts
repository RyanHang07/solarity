/**
 * Step 15e. What a report points at.
 *
 * `content_reports.content_reference` is `not null` and `text`, and its job is
 * to let a moderator find the exact thing complained about. Each report type
 * uses a different handle, so the formats live here rather than being spelled
 * out at three call sites.
 *
 * | Type | Reference | Resolved by |
 * |---|---|---|
 * | `user_profile` | the reported account's id | `select * from users where id = $1` |
 * | `checkin_photo`, `checkin_note` | `<user_id>/<goal_id>/<check_in_date>` | the query below |
 *
 * ```sql
 * select * from progress_entries
 *  where user_id = $1 and goal_id = $2 and check_in_date = $3;
 * ```
 *
 * **Why a composite and not the entry id.** The roster deliberately returns
 * `entry_id` for your own rows only: a viewer who cannot act on a row has no
 * use for its primary key, and exposing it for everyone would leak the
 * existence of notes people chose to keep private. Reporting does not change
 * that — this reference is built from three things the viewer already
 * legitimately holds, and it identifies exactly one row, because
 * `progress_entries` holds at most one entry per goal per check-in date.
 *
 * **Not a URL, and never the photo's signed URL.** Those expire in an hour, so
 * a stored one is a dead link by the time anybody reads the report.
 */

/** Segments a check-in reference is built from and split back into. */
const SEPARATOR = "/"

export function checkinReference(
  userId: string,
  goalId: string,
  checkinDate: string,
): string {
  return [userId, goalId, checkinDate].join(SEPARATOR)
}

/**
 * The inverse, for whoever reads the reports.
 *
 * Returns null rather than throwing on anything malformed: this parses data
 * that came from a client, and a report nobody can resolve is still a report
 * worth keeping rather than a reason to fail.
 */
export function parseCheckinReference(
  reference: string,
): { userId: string; goalId: string; checkinDate: string } | null {
  const parts = reference.split(SEPARATOR)
  if (parts.length !== 3) return null
  const [userId, goalId, checkinDate] = parts
  if (!userId || !goalId || !/^\d{4}-\d{2}-\d{2}$/.test(checkinDate)) return null
  return { userId, goalId, checkinDate }
}
