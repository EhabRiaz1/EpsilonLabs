import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./styles/system.css";
import "./platform.css";
import "./styles/admin-theme.css";
import "./styles/admin-pages.css";
import "./styles/admin-pages-2.css";
import "./styles/admin-pages-3.css";
import "./styles/client-theme.css";
import "./styles/client-pages.css";
import { MotionLoader } from "./components/MotionLoader";

export const metadata: Metadata = {
  title: { default: "Epsilon", template: "%s · Epsilon" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

// Before first paint: marks the portal (`data-site="admin|client"` scopes styles/admin-theme.css and
// styles/client-theme.css) and applies the theme. admin.* and client.* (client.localhost / admin.localhost in dev, or the
// eps-dev-site / ?host= dev override) follow the OS light/dark setting until the user picks one with the sun/moon pill
// ("eps.theme.chosen"); motion.js re-reads "eps.theme" after hydration, so the OS choice is written there too. The
// stored coral/graphite/copper accent is only applied when neither theme is on: both brand themes set their own accent.
const THEME_BOOT = `try{var d=document.documentElement,h=location.hostname,c=document.cookie,q=location.search,s=/^admin\\./.test(h)||/(^|; )eps-dev-site=admin/.test(c)||/[?&]host=admin(&|$)/.test(q)?"admin":/^client\\./.test(h)||/(^|; )eps-dev-site=client/.test(c)||/[?&]host=client(&|$)/.test(q)?"client":"",t=localStorage.getItem("eps.theme"),a=localStorage.getItem("eps.accent");if(s){d.setAttribute("data-site",s);if(!localStorage.getItem("eps.theme.chosen")){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";localStorage.setItem("eps.theme",t)}}if(t==="dark"||t==="light")d.setAttribute("data-theme",t);if(!s&&(a==="coral"||a==="graphite"||a==="copper"))d.setAttribute("data-accent",a)}catch(e){}`;

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
