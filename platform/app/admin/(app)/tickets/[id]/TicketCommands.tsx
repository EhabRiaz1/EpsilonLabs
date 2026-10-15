"use client";

import { useRouter } from "next/navigation";
import { usePageCommands } from "@/app/components/AdminPalette";

const goTo = (id: string, focus?: string) => {
  document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
  if (focus) window.setTimeout(() => document.getElementById(focus)?.focus(), 250);
};

/** The ticket page's ⌘K commands (the review step adds M / P / N and Discard from ReviewActions). Renders nothing. */
export function TicketCommands({ orgId }: { orgId: string }) {
  const router = useRouter();
  usePageCommands(
    "Ticket",
    [
      { label: "Reply to the client", icon: "send", run: () => goTo("reply", "staff-reply") },
      { label: "Go to the current step", icon: "arrowR", run: () => goTo("work") },
      { label: "Set status", icon: "check", run: () => goTo("status") },
      { label: "Log time", icon: "clock", run: () => goTo("time", "tm-time") },
      { label: "Open this client", icon: "users", run: () => router.push(`/clients/${orgId}`) },
      { label: "All tickets", icon: "ticket", run: () => router.push("/tickets") },
    ],
    `ticket-${orgId}`,
  );
  return null;
}
