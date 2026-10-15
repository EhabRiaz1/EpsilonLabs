import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

// admin.* only: the PWA manifest, home-screen icon and status-bar colour (E5). Paths are admin.* public paths; the
// proxy rewrites them to public/admin/* (lib/host.ts isPublicPath lets them through without a session).
export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }], apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Epsilon Admin", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EEECE6" },
    { media: "(prefers-color-scheme: dark)", color: "#08090A" },
  ],
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
