import type { IconName } from "@/app/components/icons";

export type AdminPage = { href: string; label: string; icon: IconName; seq: string };

/** Sidebar groups for admin.* (design review D2): daily pages on top, then Sales, Clients, and System (collapsed). */
export type AdminNavGroup = { key: string; label?: string; collapsed?: boolean; pages: AdminPage[] };

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    key: "top",
    pages: [
      { href: "/", label: "Today", icon: "activity", seq: "g h" },
      { href: "/approvals", label: "Approvals", icon: "inbox", seq: "g a" },
    ],
  },
  {
    key: "sales",
    label: "Sales",
    pages: [
      { href: "/intake", label: "Intake", icon: "zap", seq: "g i" },
      { href: "/pipeline", label: "Pipeline", icon: "layers", seq: "g p" },
      { href: "/opportunities", label: "Opportunities", icon: "globe", seq: "g o" },
      { href: "/proposals", label: "Proposals", icon: "file", seq: "g r" },
    ],
  },
  {
    key: "clients",
    label: "Clients",
    pages: [
      { href: "/clients", label: "Clients", icon: "users", seq: "g c" },
      { href: "/tickets", label: "Tickets", icon: "ticket", seq: "g t" },
      { href: "/updates", label: "Updates", icon: "send", seq: "g u" },
      { href: "/reports", label: "Reports", icon: "chart", seq: "g e" },
      { href: "/invoices", label: "Invoices", icon: "receipt", seq: "g v" },
      { href: "/testimonials", label: "Testimonials", icon: "sparkle", seq: "g l" },
    ],
  },
  {
    key: "system",
    label: "System",
    collapsed: true,
    pages: [
      { href: "/agents", label: "Agents", icon: "cpu", seq: "g n" },
      { href: "/health", label: "Health", icon: "activity", seq: "g y" },
      { href: "/analytics", label: "Analytics", icon: "eye", seq: "g w" },
      { href: "/settings", label: "Settings", icon: "settings", seq: "g s" },
      { href: "/terms", label: "Terms", icon: "shield", seq: "g m" },
    ],
  },
];

/** Every admin page in sidebar order: the ⌘K "Go to" entries and the G-then-letter shortcuts. */
export const ADMIN_PAGES: AdminPage[] = ADMIN_NAV.flatMap((g) => g.pages);
