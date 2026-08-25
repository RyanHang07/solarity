/**
 * Step 15f. Turning a picture someone picked into the one object an avatar is.
 *
 * **Separate from `lib/photo-upload.ts`, and sharing its front half.** `sniff`
 * and `inspect` are format questions and answer the same way for both. What
 * differs is everything after: an avatar is square, small, and lives at a fixed
 * key, and a check-in photo is none of those.
 */

/** Named once, because the action and the client both address it. */
export const AVATAR_BUCKET = "avatars"

/**
 * The one sentinel `prepareAvatar` throws, so the caller can say something
 * about the format rather than about a mystery.
 */
export const AVATAR_PROBLEM_UNREADABLE = "AVATAR_UNREADABLE"

/**
 * How long a signed avatar URL lives. Matches `PHOTO_URL_TTL_SECONDS`.
 *
 * It also bounds the one cost of the fixed key below: after replacing your
 * avatar, a URL minted for the previous image stays valid for this long.
 */
export const AVATAR_URL_TTL_SECONDS = 3600

/**
 * **JPEG, and the bucket was set to WebP until step 15f found it.**
 *
 * `canvas.toBlob(cb, "image/webp")` is unsupported in WebKit and the spec says
 * an unsupported type falls back to `image/png`, silently. `supabase-js`
 * appends the blob to a `FormData` bare, so the part's type comes from
 * `blob.type` and the `contentType` option never reaches the check. An iPhone
 * would have uploaded a PNG to a bucket allowing only WebP and been refused.
 *
 * That is the same three-fact failure migration 82 was written for, sitting
 * armed in a second bucket. One raster format every canvas can encode, one
 * extension, one allowed MIME type, and no per-browser branch.
 */
export const AVATAR_MIME = "image/jpeg"
export const AVATAR_EXT = "jpg"

/** The bucket's own cap, so a 5MB file fails instantly rather than at Storage. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024

/**
 * Side length of the stored square.
 *
 * 256 rather than `MAX_EDGE`'s 1600. An avatar is rendered at 40px on a roster
 * row and maybe 96px on a profile; storing sixteen times the pixels anyone sees
 * costs the viewer's data on every profile they open.
 */
export const AVATAR_EDGE = 256

export const AVATAR_QUALITY = 0.85

/**
 * **One key per person, forever, overwritten in place.**
 *
 * A timestamped or content-hashed name would orphan the previous image on every
 * change and need a sweep job — which is what migration 81 exists for on the
 * other bucket, and is not worth repeating for a file that has exactly one
 * version at a time.
 *
 * The cost is that a signed URL minted for the old image stays valid until it
 * expires. The bucket is private and the TTL is an hour, so the exposure is an
 * hour of a picture that person themselves published.
 *
 * **The folder is load-bearing.** `avatars_insert` requires `foldername[1]` to
 * be the caller's id, and migration 85's CHECK requires `avatar_url` to begin
 * with the same. Two independent rules reading the same first segment.
 */
export function avatarKey(userId: string) {
  return `${userId}/avatar.${AVATAR_EXT}`
}

/**
 * Decode to a bitmap, asking for EXIF rotation and coping if the browser will
 * not take the request.
 *
 * **The options argument is younger than the function.** `createImageBitmap`
 * has been in Safari since 15; `ImageBitmapOptions` was not accepted until
 * later, and a Safari that does not know the second argument can reject the
 * call outright. Without this fallback that reads as "Couldn't process that
 * picture" for a perfectly ordinary JPEG — a silent failure on exactly the
 * platform this pipeline has failed on three times.
 *
 * **The fallback is safe.** `imageOrientation` defaults to `"from-image"` in
 * the current spec, so a browser new enough to have the default and old enough
 * to refuse the argument does the right thing anyway. Older still, and a
 * portrait photo lands sideways — visibly wrong, and better than an upload that
 * refuses valid files.
 *
 * Both attempts failing is a format the browser cannot decode, which is
 * overwhelmingly HEIC on a browser that has no decoder for it. Named as a
 * format problem by the caller rather than surfaced as a mystery.
 */
async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" })
  } catch {
    try {
      return await createImageBitmap(file)
    } catch {
      throw new Error(AVATAR_PROBLEM_UNREADABLE)
    }
  }
}

/**
 * Decode, rotate, centre-crop to a square, downscale, re-encode as JPEG.
 *
 * **`createImageBitmap` with `imageOrientation: "from-image"`**, rather than the
 * compression library `preparePhoto` uses. Two reasons: the library resizes but
 * does not crop, and a square avatar from a rectangular photo is a crop; and
 * doing it here means no worker, so `worker-src blob:` is not involved. That
 * directive had to be added to the CSP for check-in photos and cost a device-only
 * bug to find.
 *
 * **The rotation still has to be asked for.** Re-encoding through a canvas drops
 * EXIF, which is the privacy win — an avatar is a photo of someone's face and
 * must not carry where it was taken. It also drops the *orientation* flag, so
 * without `from-image` every portrait selfie arrives on its side.
 *
 * **The returned type is checked, not assumed**, for the reason at the top of
 * this file: a canvas asked for a format it cannot encode substitutes one and
 * says nothing.
 */
export async function prepareAvatar(file: File): Promise<Blob> {
  const bitmap = await decode(file)

  try {
    // The largest centred square the source contains. Cropping before scaling
    // means the subject keeps its proportions; scaling a rectangle into a square
    // canvas would stretch a face.
    const side = Math.min(bitmap.width, bitmap.height)
    const sx = (bitmap.width - side) / 2
    const sy = (bitmap.height - side) / 2

    const canvas = document.createElement("canvas")
    canvas.width = AVATAR_EDGE
    canvas.height = AVATAR_EDGE

    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error(AVATAR_PROBLEM_UNREADABLE)
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_EDGE, AVATAR_EDGE)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, AVATAR_MIME, AVATAR_QUALITY),
    )
    if (!blob) throw new Error(AVATAR_PROBLEM_UNREADABLE)

    if (blob.type !== AVATAR_MIME) {
      throw new Error(
        `expected ${AVATAR_MIME}, got ${blob.type || "no type"} — the canvas substituted a format`,
      )
    }
    return blob
  } finally {
    // Bitmaps hold decoded pixels outside the JS heap and are not collected on
    // their own. A few megabytes per attempt, on the device with the least
    // memory to spare.
    bitmap.close()
  }
}
