import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./styles/system.css";
import "./platform.css";
import "./styles/admin-theme.css";
import "./styles/admin-pages.css";
import "./styles/admin-pages-3.css";
import { MotionLoader } from "./components/MotionLoader";

export const metadata: Metadata = {
  title: { default: "Epsilon", template: "%s · Epsilon" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

// Before first paint: marks admin.* pages (`data-site="admin"` scopes styles/admin-theme.css) and applies the theme.
// Admin follows the OS light/dark setting until the founder picks one with the sun/moon pill ("eps.theme.chosen");
// motion.js re-reads "eps.theme" after hydration, so the OS choice is written there too. The client portal keeps
// its stored theme / light default.
const THEME_BOOT = `try{var d=document.documentElement,h=location.hostname,admin=/^admin\\./.test(h)||/(^|; )eps-dev-site=admin/.test(document.cookie),t=localStorage.getItem("eps.theme"),a=localStorage.getItem("eps.accent");if(admin){d.setAttribute("data-site","admin");if(!localStorage.getItem("eps.theme.chosen")){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";localStorage.setItem("eps.theme",t)}}if(t==="dark"||t==="light")d.setAttribute("data-theme",t);if(!admin&&(a==="coral"||a==="graphite"||a==="copper"))d.setAttribute("data-accent",a)}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" data-accent="coral" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        {children}
        <MotionLoader />
      </body>
    </html>
  );
}
