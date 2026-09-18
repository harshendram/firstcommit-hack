import type { Metadata, Viewport } from "next";
import {
  cinzel,
  ebGaramond,
  instrumentSans,
  jetbrainsMono,
  notoDevanagari,
  syne,
} from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Suraksha — Care without watching",
  description:
    "An agent that helps families care for an aging parent without making the parent feel monitored. Most days, Suraksha says nothing at all.",
  applicationName: "Suraksha",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Suraksha",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#f7f3ea",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Without this, env(safe-area-inset-*) is always 0 and bottom actions sit under the home bar.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${instrumentSans.variable} ${syne.variable} ${cinzel.variable} ${ebGaramond.variable} ${jetbrainsMono.variable} ${notoDevanagari.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
