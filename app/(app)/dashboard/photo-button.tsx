"use client"

import { useState, useTransition } from "react"
import { createClient } from "@/lib/supabase/client"
import {
  MAX_UPLOAD_BYTES,
  PHOTO_BUCKET,
  inspect,
  photoKey,
  preparePhoto,
  type PhotoProblem,
} from "@/lib/photo-upload"
import { attachCheckinPhoto, removeCheckinPhoto } from "@/app/actions/check-ins"

/**
 * Step 13c. Attach or remove today's photo for one checked-off goal.
 *
 * **Three steps, and only the last one is a server action.** The browser
 * prepares the file, uploads it straight to Storage, and then asks the server to
 * record that it exists. The bytes never pass through our server, which is why
 * `checkin_photos_insert` exists: Storage is the thing enforcing who may write
 * where, not us.
 *
 * **The server derives the key; this component derives the same key locally.**
 * They agree because `photoKey` is the only implementation. If they ever
 * disagreed the upload would land somewhere `attachCheckinPhoto` never names,
 * and 13e's sweep would remove it — a slow failure rather than a wrong one.
 *
 * **The picker is opened by a `<label>`, never by `input.click()`.** iOS Safari
 * is stricter than desktop about programmatic clicks on a file input: with the
 * input `display:none` the sheet can open and then do nothing when a source is
 * chosen. A label is the native mechanism and needs no script at all, so there
 * is no user-activation question to get wrong. Found on a real iPhone during
 * the step 13 manual pass; every headless browser accepted the old version.
 */

/** What each refusal says. Wording is the whole point of this map. */
const SAYS: Record<PhotoProblem, string> = {
  EMPTY: "That file is empty.",
  TOO_LARGE: `Photos are limited to ${MAX_UPLOAD_BYTES / 1024 / 1024}MB.`,
  NOT_AN_IMAGE: "That doesn't look like a photo.",
  UNREADABLE: "Couldn't read that file. Try picking it again.",
}

export function PhotoButton({
  entryId,
  goalId,
  userId,
  title,
  hasPhoto,
}: {
  entryId: string
  goalId: string
  userId: string
  /** For the accessible name. Ten rows of "Add photo" is ten identical buttons. */
  title: string
  hasPhoto: boolean
}) {
  // Unique per row: ten goals means ten inputs, and `htmlFor` has to name one.
  const inputId = `photo-${entryId}`
  const [busy, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  async function upload(file: File) {
    setError(null)

    const problem = await inspect(file)
    if (problem) return setError(SAYS[problem])

    let blob: Blob
    try {
      blob = await preparePhoto(file)
    } catch {
      // Overwhelmingly HEIC on a browser that cannot decode it. Named as a
      // format problem rather than a mystery, because that is what it is and
      // the person can pick a different file.
      return setError("Couldn't process that photo. Try a JPEG or PNG.")
    }

    const supabase = createClient()
    const { error: upErr } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(photoKey(userId, goalId, entryId), blob, {
        contentType: "image/webp",
        // Replacing is the ordinary case: pick again and the new one wins,
        // at the same key, so nothing is orphaned by a second attempt.
        upsert: true,
      })

    if (upErr) return setError("Couldn't upload that photo. Try again.")

    // **Only now does the photo exist as far as anyone else is concerned.** The
    // object has been there since the line above; the column is what
    // `circle_roster` reads.
    start(async () => {
      // **Caught, not just checked.** A server action that *throws* rather than
      // returning a result leaves the transition pending forever and the button
      // disabled with no explanation — the exact bug step 10 shipped and had to
      // fix in the push toggle.
      try {
        const result = await attachCheckinPhoto(entryId)
        if (!result.ok) setError(result.error)
      } catch {
        setError("Couldn't save that photo. Try again.")
      }
    })
  }

  function remove() {
    setError(null)
    start(async () => {
      try {
        const result = await removeCheckinPhoto(entryId)
        if (!result.ok) setError(result.error)
      } catch {
        setError("Couldn't remove that photo. Try again.")
      }
    })
  }

  return (
    <span className="flex items-center gap-2">
      {/*
        A plain file input, with no `capture` attribute. iOS draws its own sheet
        — Take Photo, Photo Library, Choose File — so the camera is one tap away
        and nothing legitimate is blocked. `capture` is ignored on desktop, so
        forcing it would apply the rule to some people and not others.

        **Moved off-screen rather than `display:none`.** A file input that is
        not displayed is one iOS Safari may refuse to hand a file back from,
        which looks exactly like the picker being broken. Off-screen keeps it in
        the layout, where the label can reach it.
      */}
      <input
        id={inputId}
        type="file"
        accept="image/*"
        disabled={busy}
        className="absolute left-[-9999px] size-px opacity-0"
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Reset first, so picking the *same* file again still fires `change`.
          e.target.value = ""
          if (file) void upload(file)
        }}
      />

      {/*
        The label *is* the button. Clicking it opens the picker natively, with
        no `input.click()` and therefore no user-activation rule to satisfy.
        `htmlFor` supplies the accessible name, so the input needs no
        `aria-label` of its own.
      */}
      <label
        htmlFor={inputId}
        className={`cursor-pointer text-xs underline ${busy ? "opacity-40" : "opacity-70"}`}
      >
        {busy ? "…" : hasPhoto ? `Replace photo for ${title}` : `Add photo for ${title}`}
      </label>

      {hasPhoto ? (
        <button
          type="button"
          disabled={busy}
          onClick={remove}
          className="text-xs underline opacity-70 disabled:opacity-40"
        >
          Remove photo
        </button>
      ) : null}

      {error ? (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      ) : null}
    </span>
  )
}
