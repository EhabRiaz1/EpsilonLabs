"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Re-renders the page from the server every `seconds` while the tab is visible (admin lists, Phase 1 "live"). */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  const [at, setAt] = useState<string>("");
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      setAt(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date()));
    };
    const id = window.setInterval(tick, seconds * 1000);
    const onVis = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [router, seconds]);
  return (
    <span className="pill pill-white" title={`Refreshes every ${seconds} s while this tab is open`}>
      <span className="dot live c-good" />
      Live{at ? ` · ${at}` : ""}
    </span>
  );
}
