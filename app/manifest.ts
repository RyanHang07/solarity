import type { MetadataRoute } from "next"

/**
 * Served at /manifest.webmanifest. Generated natively by Next.js.
 *
 * Installability is not cosmetic: iOS delivers push only to an installed PWA,
 * and `display: standalone` is the part it checks. See architecture.md
 * section 7b.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Solarity",
    short_name: "Solarity",
    description:
      "Friends who see each other's progress toward their goals motivate each other to keep going.",
    start_url: "/",
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
