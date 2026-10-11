import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./styles/system.css";
import "./platform.css";
import { MotionLoader } from "./components/MotionLoader";

export const metadata: Metadata = {
  title: { default: "Epsilon", template: "%s · Epsilon" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

// Applies the stored theme/accent before first paint (same keys motion.js uses), so dark mode never flashes.
const THEME_BOOT = `try{var d=document.documentElement,t=localStorage.getItem("eps.theme"),a=localStorage.getItem("eps.accent");if(t==="dark"||t==="light")d.setAttribute("data-theme",t);if(a==="coral"||a==="graphite"||a==="copper")d.setAttribute("data-accent",a)}catch(e){}`;

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
