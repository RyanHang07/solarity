import type { MetadataRoute } from "next"

/**
 * Served at /manifest.webmanifest. Generated natively by Next.js.
 *
 * Installability is not cosmetic: iOS delivers push only to an installed PWA,
 * and `display: standalone` is the part it checks. See architecture/
 * section 7b.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Solarity",
    short_name: "Solarity",
    description:
      "Friends who see each other's progress toward their goals motivate each other to keep going.",
    /**
     * Step 20i. **The installed app opens the app, not the marketing page.**
     *
     * This was `/` while `/` was a placeholder that bounced signed-in visitors
     * onward — harmless. With a real landing page there, every cold launch from
     * the home screen would flash the hero and then redirect, on the screen
     * somebody opens every morning.
     *
     * Signed out, `/dashboard` already redirects to `/auth/sign-in`, so the
     * signed-out case needs no second rule.
     */
    start_url: "/dashboard",

    /**
     * **Unchanged, and this is the trap in the other direction.**
     *
     * Narrowing scope to `/dashboard` would put `/privacy`, `/terms`,
     * `/support` and — worst — `/join/<token>` *outside* the installed window.
     * On iOS a URL outside scope opens in Safari, so an invite tapped inside
     * the app would land in a browser where that person is not signed in.
     *
     * Scope stays `/` precisely so the public pages remain part of the app.
     */
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0b12",
    theme_color: "#0b0b12",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        // Artwork sits inside the centre 80% so Android can crop to any shape.
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  }
}
