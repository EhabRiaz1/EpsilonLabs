import type { IconName } from "@/app/components/icons";

/** Sidebar order and ⌘K "Go to" entries for admin.*, with the G-then-letter shortcuts. */
export const ADMIN_PAGES: { href: string; label: string; icon: IconName; seq: string }[] = [
  { href: "/", label: "Today", icon: "home", seq: "g h" },
  { href: "/approvals", label: "Approvals", icon: "inbox", seq: "g a" },
  { href: "/intake", label: "Intake", icon: "zap", seq: "g i" },
  { href: "/pipeline", label: "Pipeline", icon: "layers", seq: "g p" },
  { href: "/opportunities", label: "Opportunities", icon: "globe", seq: "g o" },
  { href: "/clients", label: "Clients", icon: "users", seq: "g c" },
  { href: "/tickets", label: "Tickets", icon: "ticket", seq: "g t" },
  { href: "/updates", label: "Updates", icon: "send", seq: "g u" },
  { href: "/proposals", label: "Proposals", icon: "file", seq: "g r" },
  { href: "/invoices", label: "Invoices", icon: "receipt", seq: "g v" },
  { href: "/reports", label: "Reports", icon: "chart", seq: "g e" },
  { href: "/testimonials", label: "Testimonials", icon: "sparkle", seq: "g l" },
  { href: "/analytics", label: "Analytics", icon: "eye", seq: "g w" },
  { href: "/agents", label: "Agents", icon: "cpu", seq: "g n" },
  { href: "/health", label: "Health", icon: "activity", seq: "g y" },
  { href: "/settings", label: "Settings", icon: "settings", seq: "g s" },
  { href: "/terms", label: "Terms", icon: "shield", seq: "g m" },
];
