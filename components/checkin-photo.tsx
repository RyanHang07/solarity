"use client"

import { useState } from "react"

/**
 * Step 13d. A check-in photo: a thumbnail, and the full image on tap.
 *
 * **One stored size, drawn small.** There is no thumbnail pipeline, because a
 * second object would double the paths, the policies and the purge logic for a
 * product with ten people per Circle. `loading="lazy"` is what keeps the cost
 * bounded to the photos actually on screen, so it is load-bearing rather than
 * decorative — a roster of ten members would otherwise pull every image at once
 * on a phone.
 *
 * **A plain `<img>`, not `next/image`.** The source is a signed URL that
 * expires within the hour and differs per request, so it is exactly the input
 * an image optimiser cannot cache. Routing it through one would spend our
 * runtime re-fetching a private object to produce a variant nobody reuses.
 *
 * **The expanded view is `<details>`, not a modal.** Same reasoning as the
 * digest roll call: the markup is in the document either way, it works before
 * hydration, and Escape and back already do the right thing without a focus
 * trap to maintain.
 */
export function CheckinPhoto({
  url,
  alt,
}: {
  url: string
  /** What the photo is of. Never the goal title on someone else's hidden goal. */
  alt: string
}) {
  // A signed URL that has expired renders as a broken image with no explanation.
  // One hour is longer than any realistic visit, so this is the overnight-tab
  // case: say what happened and what fixes it.
  const [broken, setBroken] = useState(false)

  if (broken) {
    return (
      <span className="text-xs opacity-60">Photo link expired. Reload to see it.</span>
    )
  }

  return (
    <details className="group">
      {/*
        **One `<img>`, resized by the open state — not a thumbnail plus a full
        copy.** Two elements with the same `alt` is the same picture described
        twice: a strict-mode violation for any test that looks it up by alt
        text, and a screen reader announcing it twice at whichever moment both
        are in the tree. Swapping classes says "this got bigger", which is what
        actually happened.

        It also means the browser fetches the image once. Two elements at the
        same `src` usually share a cache entry, but "usually" is doing real work
        in that sentence.
      */}
      <summary className="cursor-pointer list-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          className="size-14 rounded object-cover group-open:h-auto group-open:max-h-96 group-open:w-full group-open:object-contain"
        />
      </summary>
    </details>
  )
}
