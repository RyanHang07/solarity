import { describe, expect, it } from "vitest"
import {
  AVATAR_BUCKET,
  AVATAR_EDGE,
  AVATAR_EXT,
  AVATAR_MIME,
  MAX_AVATAR_BYTES,
  avatarKey,
} from "./avatar"
import { MAX_EDGE, MAX_UPLOAD_BYTES } from "./photo-upload"

/**
 * Step 15f, the half that can be tested without a browser.
 *
 * `prepareAvatar` is not here: it needs a canvas and `createImageBitmap`, and
 * a canvas is a browser. Playwright covers it.
 *
 * **Everything below is a cross-check rather than a calculation.** None of
 * these constants can be wrong on their own; they are wrong by *disagreeing*
 * with a storage policy, a CHECK constraint or a bucket setting that lives
 * somewhere this file cannot import. Each test names the thing on the other
 * side of the agreement.
 */

describe("avatarKey", () => {
  const id = "11111111-2222-3333-4444-555555555555"
  const key = avatarKey(id)

  it("puts the object in a folder named for its owner", () => {
    /**
     * **Two independent rules read this first segment**, and neither can see
     * the other:
     *
     * - `avatars_insert` requires `storage.foldername(name)[1]` to equal
     *   `auth.uid()`, so a wrong folder is a Storage refusal.
     * - Migration 85's `users_avatar_url_is_own_key` requires `avatar_url` to
     *   begin with the caller's id, so a wrong folder is a check violation.
     *
     * Reordering or flattening this key breaks both at once, and the failures
     * name neither the key nor each other.
     */
    expect(key).toBe(`${id}/avatar.jpg`)
    expect(key.split("/")).toHaveLength(2)
    expect(key.split("/")[0]).toBe(id)
  })

  it("is the same key every time, because there is only ever one", () => {
    // The whole reason there is no sweep job for this bucket. A timestamp or a
    // content hash here would orphan the previous object on every change, which
    // is what migration 81 exists to clean up on the other bucket.
    expect(avatarKey(id)).toBe(avatarKey(id))
  })

  it("ends in the one extension the bucket allows", () => {
    /**
     * **JPEG, and the bucket was `image/webp` until step 15f found it.** Safari
     * cannot encode WebP: `toBlob` falls back to PNG silently, and supabase-js
     * sends `blob.type` rather than the `contentType` option, so an iPhone
     * would have been refused by Storage. That is the same failure migration 82
     * fixed for check-in photos, sitting armed in a second bucket.
     */
    expect(key.endsWith(`.${AVATAR_EXT}`)).toBe(true)
    expect(AVATAR_MIME).toBe("image/jpeg")
    expect(AVATAR_EXT).toBe("jpg")
  })
})

describe("the constants agree with the bucket", () => {
  it("names the bucket the storage policies name", () => {
    // All four policies are written against this literal.
    expect(AVATAR_BUCKET).toBe("avatars")
  })

  it("caps at the bucket's own limit, not the check-in photo one", () => {
    // The avatars bucket allows 2MB where checkin-photos allows 10. Checking
    // against the wrong cap would let a 5MB file through to a Storage refusal
    // after the upload had already been paid for on someone's mobile data.
    expect(MAX_AVATAR_BYTES).toBe(2 * 1024 * 1024)
    expect(MAX_AVATAR_BYTES).toBeLessThan(MAX_UPLOAD_BYTES)
  })

  it("stores far fewer pixels than a check-in photo", () => {
    // An avatar renders at 40px on a roster row. `MAX_EDGE` is sized for a
    // photograph someone opens; using it here would cost every viewer of every
    // profile sixteen times the bytes they can see.
    expect(AVATAR_EDGE).toBeLessThan(MAX_EDGE)
    expect(AVATAR_EDGE).toBe(256)
  })
})
