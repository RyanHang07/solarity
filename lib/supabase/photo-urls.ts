import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"
import { PHOTO_BUCKET } from "@/lib/photo-upload"

/**
 * Step 13d. Turning Storage object keys into URLs a browser can fetch.
 *
 * **One implementation, called by both readers.** `getCircleRoster` signs other
 * people's photos and `getTodayData` signs your own; two copies of this would
 * be two expiry windows and two failure modes to reason about.
 *
 * **Signed with the caller's own client, never the service key.** That is the
 * point: `createSignedUrl` evaluates `checkin_photos_select` for whoever asked,
 * so Storage remains the only place the access rule lives. A key that should
 * not be readable simply fails to sign, and the caller shows no photo. The
 * alternative — a route handler that checks access itself and redirects —
 * would re-implement `can_view_checkin_photo`, which is the mistake migration
 * 71 had to undo.
 */

/**
 * One hour.
 *
 * Long enough that nobody watches a photo expire mid-visit, short enough that a
 * URL copied out of the page is not a lasting handle on a private object. The
 * cost, stated plainly: a tab left open overnight gets 403s on scroll, and a
 * refresh fixes it. At 24 hours that trade would be the wrong way round.
 */
export const PHOTO_URL_TTL_SECONDS = 60 * 60

/**
 * Signs many keys in one request.
 *
 * **Batched deliberately.** A Circle holds ten people with up to ten goals
 * each, and signing per photo would be up to a hundred round trips inside a
 * single server render.
 *
 * Returns a map rather than an array so callers match by key instead of by
 * position. `createSignedUrls` reports per-path errors, and a partial failure
 * that shifted an index would attach one person's photo to another person's
 * row — a bug that looks like a privacy leak and is really an off-by-one.
 *
 * A failure is an absent entry, never a throw. A photo that will not sign is a
 * missing image; it is not a reason for a page not to render.
 */
export async function signPhotos(
  supabase: SupabaseClient<Database>,
  keys: (string | null)[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(keys.filter((k): k is string => Boolean(k)))]
  if (!wanted.length) return new Map()

  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(wanted, PHOTO_URL_TTL_SECONDS)

  if (error) {
    console.error("signing check-in photos failed", error)
    return new Map()
  }

  const signed = new Map<string, string>()
  for (const row of data ?? []) {
    // `path` is typed nullable and `error` is per-path: `createSignedUrls`
    // reports a refusal per entry rather than failing the batch, which is
    // exactly what should happen when one key in ten is no longer readable.
    if (row.error || !row.path || !row.signedUrl) continue
    signed.set(row.path, row.signedUrl)
  }
  return signed
}
