"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";

const HINT_KEY = "eps.iosInstallHint";

function readHint(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "dismissed";
  } catch {
    return false;
  }
}

/**
 * admin.* PWA boot (E5): registers /sw.js (offline shell only, never API data) and, on iPhone/iPad Safari outside the
 * installed app, shows a small dismissible "Add to Home Screen" hint: iOS delivers push only to installed web apps.
 */
export function PwaBoot() {
  const [hint, setHint] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
        // no SW (private mode, old browser): the app still works online, just without the offline page and push
      });
    }
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const installed = matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (ios && !installed && !readHint()) {
      const t = setTimeout(() => setHint(true), 1200);
      return () => clearTimeout(t);
    }
  }, []);

  if (!hint) return null;
  function dismiss() {
    setHint(false);
    try {
      localStorage.setItem(HINT_KEY, "dismissed");
    } catch {
      // storage blocked: the hint comes back next visit, which is harmless
    }
  }
  return (
    <div
      className="panel"
      role="note"
      style={{
        position: "fixed", left: 10, right: 10, top: "calc(env(safe-area-inset-top, 0px) + 10px)", zIndex: 60,
        display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 12px 12px 16px", borderRadius: 20,
        boxShadow: "var(--shadow-lg)", maxWidth: 460, margin: "0 auto",
      }}
    >
      <span className="mark" aria-hidden="true" style={{ marginTop: 2 }}>
        ε
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong className="t-13" style={{ display: "block" }}>
          Install Epsilon Admin
        </strong>
        <span className="t-12 c-2" style={{ display: "block", marginTop: 2, lineHeight: 1.5 }}>
          Tap Share, then <strong>Add to Home Screen</strong>. Notifications on iPhone work only from the installed app.
        </span>
      </div>
      <button className="btn btn-ghost btn-icon" type="button" aria-label="Dismiss" onClick={dismiss} style={{ flex: "none" }}>
        <Icon name="x" className="i-sm" />
      </button>
    </div>
  );
}
