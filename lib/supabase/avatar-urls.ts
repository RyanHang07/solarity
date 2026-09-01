import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"
import { AVATAR_BUCKET, AVATAR_URL_TTL_SECONDS } from "@/lib/avatar"

/**
 * Step 15f. Avatar keys into URLs a browser can fetch.
 *
 * **Separate from `signPhotos` because the buckets are separate**, and a single
 * `createSignedUrls` call addresses exactly one bucket. Same shape, same
 * reasoning, deliberately not generalised into one function taking a bucket
 * name — the two have different access rules and different failure meanings,
 * and a shared helper would invite passing the wrong bucket for a set of keys.
 *
 * **Signed as the caller, never with the service key.** `avatars_select` is
 * `bucket_id = 'avatars'` for any authenticated reader, which is broader than
 * the check-in photo rule and correct: profiles are open to every signed-in
 * user, so avatars have to be too. Signing as the caller keeps Storage the
 * place that decides, even where the decision is currently permissive.
 */

/**
 * Signs many keys in one request.
 *
 * A Circle holds ten people, and a roster that signed per member would be ten
 * round trips inside one server render — on top of the photo batch it already
 * does.
 *
 * Returns a map keyed by path, never an array. `createSignedUrls` reports
 * failures **per path**, so a partial failure that shifted an index would put
 * one person's face on another person's row.
 *
 * A failure is an absent entry, never a throw. An avatar that will not sign is
 * a set of initials; it is not a reason for a roster not to render.
 */
export async function signAvatars(
  supabase: SupabaseClient<Database>,
  keys: (string | null)[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(keys.filter((k): k is string => Boolean(k)))]
  if (!wanted.length) return new Map()

  const { data, error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .createSignedUrls(wanted, AVATAR_URL_TTL_SECONDS)

  if (error) {
    console.error("signing avatars failed", error)
    return new Map()
  }

  const signed = new Map<string, string>()
  for (const row of data ?? []) {
    if (row.error || !row.path || !row.signedUrl) continue
    signed.set(row.path, row.signedUrl)
  }
  return signed
}
