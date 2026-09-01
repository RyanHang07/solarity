"use client"

import { startTransition, useActionState, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import {
  AVATAR_BUCKET,
  AVATAR_MIME,
  AVATAR_PROBLEM_UNREADABLE,
  MAX_AVATAR_BYTES,
  avatarKey,
  prepareAvatar,
} from "@/lib/avatar"
import { inspect, type PhotoProblem } from "@/lib/photo-upload"
import { setAvatar } from "@/app/actions/settings"
import { Avatar } from "@/components/avatar"
import type { ActionResult } from "@/lib/errors"

/**
 * Step 15f. Your picture: upload, replace, remove.
 *
 * **Three steps, and only the last is a server action** — the same shape as
 * `PhotoButton`. The browser crops and re-encodes, uploads straight to Storage
 * under `avatars_insert`, then asks the server to record that the object
 * exists. The bytes never pass through our server.
 *
 * **The picker is opened by a `<label>`, never `input.click()`.** iOS Safari
 * will open its sheet for a programmatic click on a hidden file input and then
 * do nothing when a source is chosen. That cost a device-only bug in step 13;
 * the fix is the native mechanism, which needs no script and therefore has no
 * user-activation rule to get wrong.
 */

const SAYS: Record<PhotoProblem, string> = {
  EMPTY: "That file is empty.",
  TOO_LARGE: `Pictures are limited to ${MAX_AVATAR_BYTES / 1024 / 1024}MB.`,
  NOT_AN_IMAGE: "That doesn't look like a picture.",
  UNREADABLE: "Couldn't read that file. Try picking it again.",
}

export function AvatarForm({
  userId,
  /** A signed URL, or null. Signed on the server; the key is never rendered. */
  currentUrl,
  displayName,
}: {
  userId: string
  currentUrl: string | null
  displayName: string
}) {
  /**
   * **`isPending` from `useActionState`, not a `useTransition` around it.**
   *
   * Wrapping the dispatch in `startTransition` looks equivalent and is not: the
   * transition ends when the synchronous callback returns, so the label would
   * flick back from "Saving…" the instant the request left, while the action
   * was still running. `useActionState` tracks the action itself.
   */
  const [state, action, saving] = useActionState<ActionResult | null, FormData>(
    setAvatar,
    null,
  )

  /**
   * The other half of "busy", and it is a separate flag on purpose.
   *
   * Cropping and uploading happen **before** any action is dispatched, and on a
   * phone they are the slow part: decoding a 12-megapixel photo and pushing a
   * few hundred kilobytes over mobile data. Without this the control looks
   * completely idle for the whole of it, and a second tap starts a second
   * upload.
   */
  const [uploading, setUploading] = useState(false)
  const busy = uploading || saving
  const [error, setError] = useState<string | null>(null)

  async function upload(file: File) {
    setError(null)
    setUploading(true)

    // `finally`, so every early return below clears the flag. A refusal that
    // left the control disabled would be a worse bug than the refusal.
    try {
      // **The avatars bucket caps at 2MB, not 10.** Passing the cap explicitly
      // is what keeps this refusal local instead of arriving as a Storage error
      // after the upload has already been paid for.
      const problem = await inspect(file, MAX_AVATAR_BYTES)
      if (problem) return setError(SAYS[problem])

      let blob: Blob
      try {
        blob = await prepareAvatar(file)
      } catch (e) {
        return setError(
          e instanceof Error && e.message === AVATAR_PROBLEM_UNREADABLE
            ? "Couldn't process that picture. Try a JPEG or PNG."
            : "Couldn't process that picture.",
        )
      }

      const supabase = createClient()
      const { error: upErr } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(avatarKey(userId), blob, {
          contentType: AVATAR_MIME,
          // One key per person, overwritten in place. Replacing is the ordinary
          // case and nothing is orphaned by it.
          upsert: true,
        })

      if (upErr) {
        // **Storage's own words, not a fixed sentence.** "Couldn't upload that
        // photo. Try again." is how a perfectly clear
        // `mime type image/png is not supported` became an afternoon of
        // guessing in step 13.
        console.error("avatar upload failed", upErr)
        return setError(`Couldn't upload that picture. ${upErr.message}`)
      }

      // Only now does it exist as far as any reader is concerned. The object
      // has been there since the line above; the column is what profiles read.
      //
      // No `clear` field, so `setAvatar` writes the key rather than a null.
      //
      // **Wrapped, and the earlier note here had the reason backwards.** A
      // `useActionState` dispatch called imperatively — rather than through a
      // form's `action` prop — must be inside a transition, or React warns and
      // `isPending` stops updating correctly. The bug it was avoiding was never
      // the wrapping: it was reading `isPending` from `useTransition`, which
      // ends when the synchronous callback returns rather than when the action
      // does. `startTransition` from `react` wraps the dispatch; `saving` above
      // still comes from `useActionState` and still tracks the action itself.
      startTransition(() => action(new FormData()))
    } finally {
      setUploading(false)
    }
  }

  return (
    <section aria-labelledby="avatar" className="flex flex-col gap-3">
      <h2 id="avatar" className="text-lg font-semibold">
        Picture
      </h2>

      <div className="flex items-center gap-4">
        {/* The same component every other surface uses, so what you see here
            is exactly what a Circle-mate sees on a roster row. */}
        <Avatar url={currentUrl} name={displayName} alt="Your picture" size={64} />

        <div className="flex flex-col gap-1">
          <input
            id="avatar-file"
            type="file"
            accept="image/*"
            disabled={busy}
            // Off-screen rather than `display:none`: an input that is not
            // displayed is one iOS Safari may refuse to hand a file back from.
            className="absolute left-[-9999px] size-px opacity-0"
            onChange={(e) => {
              const file = e.target.files?.[0]
              // Reset first, so picking the same file again still fires.
              e.target.value = ""
              if (file) void upload(file)
            }}
          />
          <label
            htmlFor="avatar-file"
            className={`cursor-pointer text-sm underline ${busy ? "opacity-40" : "opacity-70"}`}
          >
            {busy ? "Saving…" : currentUrl ? "Replace picture" : "Add a picture"}
          </label>

          {currentUrl ? (
            <form action={action}>
              <input type="hidden" name="clear" value="on" />
              <button type="submit" className="text-sm underline opacity-70">
                Remove picture
              </button>
            </form>
          ) : null}

          <p className="text-xs opacity-60">
            Square, up to {MAX_AVATAR_BYTES / 1024 / 1024}MB. Anyone signed in can
            see it on your profile.
          </p>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      {state && !state.ok ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
    </section>
  )
}
