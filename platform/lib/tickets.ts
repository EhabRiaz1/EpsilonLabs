// Ticket vocabulary shared by the portal and admin. Pure (unit-tested). The client labels match
// ticket_status_label() in migration 010, which writes the notification titles.

export type TicketStatus = "new" | "triaged" | "briefed" | "planned" | "approved" | "in_progress" | "review" | "done" | "declined";
export type TicketType = "bug" | "change" | "question" | "new";
export type Priority = "low" | "normal" | "urgent";

export const STATUSES: readonly TicketStatus[] = ["new", "triaged", "briefed", "planned", "approved", "in_progress", "review", "done", "declined"];
export const CLOSED: ReadonlySet<string> = new Set(["done", "declined"]);
/** Statuses where Ehab is waiting on the client ("Needs your input"). */
export const NEEDS_CLIENT: ReadonlySet<string> = new Set(["review"]);

type Chip = { label: string; tone: string };

const CLIENT: Record<TicketStatus, Chip> = {
  new: { label: "Received", tone: "pill-accent" },
  triaged: { label: "Triaged", tone: "" },
  briefed: { label: "Triaged", tone: "" },
  planned: { label: "Planned", tone: "" },
  approved: { label: "Planned", tone: "" },
  in_progress: { label: "In progress", tone: "pill-good" },
  review: { label: "Needs your review", tone: "pill-warn" },
  done: { label: "Done", tone: "pill-good" },
  declined: { label: "Declined", tone: "pill-bad" },
};

const STAFF: Record<TicketStatus, Chip> = {
  new: { label: "New", tone: "pill-accent" },
  triaged: { label: "Triaged", tone: "" },
  briefed: { label: "Briefed", tone: "" },
  planned: { label: "Planned", tone: "" },
  approved: { label: "Approved", tone: "" },
  in_progress: { label: "In progress", tone: "pill-good" },
  review: { label: "With client", tone: "pill-warn" },
  done: { label: "Done", tone: "pill-good" },
  declined: { label: "Declined", tone: "pill-bad" },
};

export function clientStatus(s: string): Chip {
  return CLIENT[s as TicketStatus] ?? { label: s, tone: "" };
}

export function staffStatus(s: string): Chip {
  return STAFF[s as TicketStatus] ?? { label: s, tone: "" };
}

export function isOpen(s: string): boolean {
  return !CLOSED.has(s);
}

export const TYPE_LABEL: Readonly<Record<string, string>> = { bug: "Bug", change: "Change", question: "Question", new: "Idea" };
export const PRIORITY_LABEL: Readonly<Record<string, string>> = { low: "Can wait", normal: "This week", urgent: "Urgent" };
export const PRIORITY_HINT: Readonly<Record<Priority, string>> = {
  low: "Picked up in the next weekly plan.",
  normal: "Ehab looks at it within two working days.",
  urgent: "For stopped production or people locked out. Ehab sees it first.",
};

/** The ticket body from the New request sheet: the description, then where it happens. */
export function composeBody(description: string, where: string): string {
  const d = description.trim();
  const w = where.trim().replace(/\s+/g, " ");
  return w ? `${d}${d ? "\n\n" : ""}Where: ${w}` : d;
}

const PKT = "Asia/Karachi";

function ymd(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(d);
}

/** "14:32" today, "Yesterday", "Thu" this week, else "8 Oct" (table "Updated" column). */
export function relativeDay(iso: string, now: Date, timeZone = PKT): string {
  const d = new Date(iso);
  const days = Math.round((Date.parse(ymd(now, timeZone)) - Date.parse(ymd(d, timeZone))) / 86_400_000);
  if (days <= 0) return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(d);
  if (days === 1) return "Yesterday";
  if (days < 7) return new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone }).format(d);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone }).format(d);
}
