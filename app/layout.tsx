import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { INSTALL_PROMPT_SCRIPT } from "@/lib/install-prompt";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Solarity",
  description:
    "Friends who see each other's progress toward their goals motivate each other to keep going.",
  // iOS ignores the manifest for standalone display and reads these instead.
  // Without them "Add to Home Screen" yields a browser-chrome window, and push
  // fires only for the installed case.
  appleWebApp: {
    capable: true,
    title: "Solarity",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0b12",
  // Stops iOS zooming on input focus, which makes an installed PWA feel like a
  // web page.
  maximumScale: 1,
  viewportFit: "cover",
};

/**
 * **`async` and reading `headers()` since step 12**, which makes every route
 * dynamic. That costs nothing here and would elsewhere: every page in this app
 * already calls `createClient()` and reads cookies, so nothing was statically
 * rendered to begin with. Worth re-checking if a genuinely static page is ever
 * added — the answer would then be to hash the inline script instead.
 *
 * `?? undefined` rather than `?? ""`: an empty string is a *valid* nonce
 * attribute and would be silently rejected, which looks identical to the script
 * simply not running. Omitting the attribute at least fails loudly in the
 * console. The value is absent only on paths the proxy does not match, and none
 * of those render this layout.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Before hydration on purpose: `beforeinstallprompt` fires early, once,
            and the event object is the only route to the install dialog. A
            listener added from an effect would miss it on a slow connection.
            See lib/install-prompt.ts. */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: INSTALL_PROMPT_SCRIPT }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
