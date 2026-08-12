import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";

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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
