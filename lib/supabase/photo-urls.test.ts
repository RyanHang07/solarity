import { describe, expect, it, vi } from "vitest"
import { PHOTO_URL_TTL_SECONDS, signPhotos } from "./photo-urls"

/**
 * Step 13d. Exchanging Storage keys for signed URLs.
 *
 * **The fake returns what the real API returns**, including its most awkward
 * habit: `createSignedUrls` reports a *per-path* error rather than failing the
 * batch, and its `path` is nullable. Both are why this maps by key instead of
 * by position.
 */

type Row = { path: string | null; signedUrl: string; error: string | null }

function fakeClient(rows: Row[] | null, error: unknown = null) {
  const createSignedUrls = vi.fn(async () => ({ data: rows, error }))
  return {
    client: { storage: { from: () => ({ createSignedUrls }) } } as never,
    createSignedUrls,
  }
}

const ok = (path: string): Row => ({ path, signedUrl: `https://x/${path}?t=1`, error: null })

describe("signPhotos", () => {
  it("signs in one request, whatever the number of photos", async () => {
    const { client, createSignedUrls } = fakeClient([ok("a"), ok("b"), ok("c")])
    const urls = await signPhotos(client, ["a", "b", "c"])

    expect(urls.size).toBe(3)
    // A Circle of ten with ten goals each is a hundred photos on one render.
    // Signing per photo would be a hundred round trips inside one page.
    expect(createSignedUrls).toHaveBeenCalledTimes(1)
    expect(createSignedUrls).toHaveBeenCalledWith(["a", "b", "c"], PHOTO_URL_TTL_SECONDS)
  })

  it("asks for each key once, and drops the nulls", async () => {
    const { client, createSignedUrls } = fakeClient([ok("a")])
    await signPhotos(client, [null, "a", null, "a"])
    expect(createSignedUrls).toHaveBeenCalledWith(["a"], PHOTO_URL_TTL_SECONDS)
  })

  it("never calls out when there is nothing to sign", async () => {
    const { client, createSignedUrls } = fakeClient([])
    expect((await signPhotos(client, [null, null])).size).toBe(0)
    expect(createSignedUrls).not.toHaveBeenCalled()
  })

  it("keeps the good rows when one path is refused", async () => {
    // The case this shape exists for: a key the roster offered but Storage
    // will not serve, because the two answer slightly different questions.
    const { client } = fakeClient([
      ok("a"),
      { path: "b", signedUrl: "", error: "Object not found" },
      ok("c"),
    ])
    const urls = await signPhotos(client, ["a", "b", "c"])

    expect(urls.get("a")).toContain("a")
    expect(urls.has("b"), "a refused path produced a URL").toBe(false)
    // **The assertion that matters.** Matching by position would have shifted
    // `c`'s URL onto `b` — one person's photo on another person's row, which
    // reads as a privacy leak and is really an off-by-one.
    expect(urls.get("c")).toContain("c")
  })

  it("returns nothing rather than throwing when the batch fails", async () => {
    const { client } = fakeClient(null, { message: "network" })
    // A photo that will not sign is a missing image. It is not a reason for a
    // whole roster to fail to render.
    await expect(signPhotos(client, ["a"])).resolves.toEqual(new Map())
  })

  it("expires within the hour", () => {
    // Long enough to outlive any real visit, short enough that a URL copied out
    // of the page is not a lasting handle on a private object.
    expect(PHOTO_URL_TTL_SECONDS).toBe(3600)
  })
})
