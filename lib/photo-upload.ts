/**
 * Step 13b. Turning a file a person picked into the one thing Storage accepts.
 *
 * **Two halves, split by what can be tested where.** `inspect`, `sniff` and
 * `photoKey` are pure and unit-tested in `lib/photo-upload.test.ts`.
 * `preparePhoto` needs a canvas and is covered by Playwright, because a canvas
 * is a browser and jsdom does not have one.
 *
 * **`browser-image-compression` is imported dynamically**, for two reasons that
 * happen to agree: it touches `document` at module scope in some builds, which
 * would make this file un-importable in a node test runner, and it is ~40KB
 * that only matters to someone who actually picks a file.
 */

/** Named once, because the server actions and the client both address it. */
export const PHOTO_BUCKET = "checkin-photos"

/**
 * **JPEG, and this is the one decision in the file with a real cost.**
 *
 * The design said WebP, and WebP is roughly a quarter smaller for photographs.
 * **Safari cannot encode it.** `canvas.toBlob(cb, "image/webp")` is unsupported
 * in WebKit, and the spec says an unsupported type falls back to `image/png` —
 * silently, with no error and no warning. So an iPhone produced a PNG while a
 * desktop produced a real WebP, and the bucket, restricted to `image/webp`,
 * refused the iPhone's upload with a message the UI then threw away.
 *
 * JPEG is the only raster format every canvas can encode. One format means one
 * extension, one allowed MIME type, and no per-browser branch in the part of
 * this system that is hardest to test — three device-only bugs came out of this
 * pipeline before this line was written.
 *
 * **Changing these two constants is a migration**, not an edit: migration 80's
 * CHECK pins the extension, the bucket pins the MIME type, and existing objects
 * would need renaming.
 */
export const PHOTO_MIME = "image/jpeg"
export const PHOTO_EXT = "jpg"

/** The bucket's own cap. Checked here so a 12MB file fails instantly. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/** Longest edge after resize. `security.md` section 9. */
export const MAX_EDGE = 1600

export const QUALITY = 0.8

/** Enough bytes for every signature in `sniff`. */
const HEAD_BYTES = 16

export type ImageKind = "jpeg" | "png" | "webp" | "gif" | "heic"

export type PhotoProblem = "EMPTY" | "TOO_LARGE" | "NOT_AN_IMAGE" | "UNREADABLE"

const ascii = (b: Uint8Array, at: number, s: string) =>
  s.split("").every((c, i) => b[at + i] === c.charCodeAt(0))

const starts = (b: Uint8Array, ...bytes: number[]) =>
  bytes.every((v, i) => b[i] === v)

/**
 * What the bytes actually are, ignoring the name and the declared MIME type.
 *
 * **This stops mistakes, not attackers, and the difference matters.** The
 * upload goes straight to Storage, so nothing of ours ever sees these bytes;
 * the bucket's `image/webp` restriction checks the *declared* content type. The
 * real containment is that the object is private, reached only through a signed
 * URL, and rendered in an `<img>`. What this buys is a clear refusal for a
 * renamed `.jpg` instead of a canvas that silently decodes to nothing.
 */
export function sniff(head: Uint8Array): ImageKind | null {
  if (starts(head, 0xff, 0xd8, 0xff)) return "jpeg"
  if (starts(head, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png"
  if (ascii(head, 0, "GIF87a") || ascii(head, 0, "GIF89a")) return "gif"
  if (ascii(head, 0, "RIFF") && ascii(head, 8, "WEBP")) return "webp"
  // ISO-BMFF: a size prefix, then `ftyp`, then the brand. HEIC and its
  // relatives all land here.
  if (ascii(head, 4, "ftyp")) {
    const brand = String.fromCharCode(...head.slice(8, 12))
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) {
      return "heic"
    }
  }
  return null
}

/**
 * Pre-flight. Returns the problem to say out loud, or null to proceed.
 *
 * Ordered cheapest first, so a 40MB video is refused on `size` without reading
 * a byte of it.
 */
export async function inspect(file: File): Promise<PhotoProblem | null> {
  if (file.size === 0) return "EMPTY"
  if (file.size > MAX_UPLOAD_BYTES) return "TOO_LARGE"

  let head: Uint8Array
  try {
    head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer())
  } catch {
    return "UNREADABLE"
  }
  return sniff(head) ? null : "NOT_AN_IMAGE"
}

/**
 * The Storage object key. **Fixed since migration 45; changing it means
 * migrating objects.**
 *
 * Both storage policies read it positionally: `checkin_photos_insert` requires
 * folder 1 to be the caller and folder 2 to be a goal they can still check in
 * on, and `checkin_photos_select` evaluates the shared-Circle and not-hidden
 * rules from the same two segments without joining anything.
 */
export function photoKey(userId: string, goalId: string, entryId: string) {
  return `${userId}/${goalId}/${entryId}.${PHOTO_EXT}`
}

/**
 * Decode, rotate, resize, re-encode as WebP.
 *
 * **Orientation and metadata are two separate concerns that look like one.**
 * Re-encoding through a canvas drops EXIF for free, which is the privacy
 * requirement: a check-in photo must not carry the poster's GPS to their
 * Circle. It also drops the *orientation* flag, so unless that is applied
 * before the re-encode, every photo taken in portrait on a phone arrives
 * sideways. `exifOrientation: -1` is what tells the library to read the flag
 * and bake the rotation into the pixels.
 *
 * **HEIC decoding belongs to the browser, not to us.** Safari decodes it to a
 * canvas; Chrome on Android does not. So "converted client-side" means
 * "converted by a browser that can", and a failure here is reported rather than
 * hidden behind a claim of support that depends on the reader.
 *
 * **The returned type is checked, not assumed.** A canvas asked for a format it
 * cannot encode returns PNG instead and says nothing — which is exactly how the
 * WebP attempt failed, as a Storage rejection on a phone and nowhere else. If
 * the encoder ever substitutes a format again, this throws where the cause is
 * visible rather than three layers away.
 */
export async function preparePhoto(file: File): Promise<Blob> {
  const { default: compress } = await import("browser-image-compression")

  const blob = await compress(file, {
    maxWidthOrHeight: MAX_EDGE,
    maxSizeMB: MAX_UPLOAD_BYTES / (1024 * 1024),
    initialQuality: QUALITY,
    fileType: PHOTO_MIME,
    // Read the EXIF flag and rotate the pixels. Without this the re-encode
    // discards the flag and the image is left lying on its side.
    exifOrientation: -1,
    useWebWorker: true,
  })

  if (blob.type !== PHOTO_MIME) {
    throw new Error(
      `expected ${PHOTO_MIME}, got ${blob.type || "no type"} — the canvas substituted a format`,
    )
  }
  return blob
}
