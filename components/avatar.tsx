/**
 * Somebody's picture, or their initial.
 *
 * **One component for four places** — the roster row, the app header, the
 * profile page and the settings form — because an avatar that renders one way
 * on a roster and another on a profile is two components drifting.
 *
 * **A plain `<img>`, not `next/image`.** The source is a signed URL with an
 * hour's TTL, so the optimiser would cache a URL that outlives it and then
 * serve a 400 from its own cache. `checkin-photo.tsx` made the same call.
 *
 * **The fallback is a letter, not an asset.** Nothing to ship, nothing to load,
 * no second failure mode, and it is legible at 24px where a placeholder image
 * would be a grey smudge. Most accounts have no picture, so the fallback is the
 * common case rather than the edge.
 */
export function Avatar({
  url,
  /** Used for the initial, and for the accessible name when there is an image. */
  name,
  /**
   * Overrides the accessible name. For the one surface where the person *is*
   * the viewer: "Your picture" on your own settings page, where
   * "Ryan Hang's picture" is a stranger's way of saying it. The initial still
   * comes from `name`.
   */
  alt,
  /** Rendered size in pixels. The stored image is 256px square. */
  size = 32,
}: {
  url: string | null
  name: string
  alt?: string
  size?: number
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "?"

  if (!url) {
    return (
      /*
        `aria-hidden`, and this is the one judgement worth explaining. The
        initial is decoration: every place this renders already names the person
        in text beside it, so announcing "R" would be a second, worse label for
        something a screen reader has just read properly.
      */
      <span
        aria-hidden
        style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
        className="flex shrink-0 items-center justify-center rounded-full border font-medium opacity-70"
      >
        {initial}
      </span>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt ?? `${name}'s picture`}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      /*
        `loading="lazy"` matters on the roster: ten members is ten requests, and
        the ones below the fold are not worth a phone's data before they are
        scrolled to.
      */
      loading="lazy"
      className="shrink-0 rounded-full object-cover"
    />
  )
}
