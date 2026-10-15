"use client";

import { useRouter } from "next/navigation";
import { usePageCommands } from "@/app/components/AdminPalette";

/** Today's ⌘K commands; A opens Approvals (the mockup's key hint). Renders nothing. */
export function TodayCommands() {
  const router = useRouter();
  usePageCommands(
    "Today",
    [
      { label: "Open approvals", icon: "inbox", keys: "A", bind: "a", run: () => router.push("/approvals") },
      { label: "Open held drafts", icon: "alert", run: () => router.push("/approvals?view=held") },
      { label: "Open new enquiries", icon: "zap", run: () => router.push("/intake") },
      { label: "Open tickets", icon: "ticket", run: () => router.push("/tickets") },
    ],
    "today",
  );
  return null;
}
