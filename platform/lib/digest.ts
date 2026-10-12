// Pure helpers for portal notification emails (012 mailer): grouping, subjects, safe links. Unit-tested.
import { safePath } from "./push-payload";

/** One notification as claim_email_batch returns it. */
export type MailItem = {
  id: string;
  kind: string;
  title: string;
  link: string | null;
  urgent: boolean;
  created_at: string;
  org_id?: string | null;
  org_name?: string | null;
};

/** One email to send, as claim_email_batch returns it. */
export type MailJob = {
  user_id: string;
  to: string;
  name: string;
  timezone: string;
  mode: "immediate" | "digest";
  local_date: string;
  items: MailItem[];
};

const KIND_LABEL: Record<string, string> = {
  ticket_status: "Ticket status",
  reply: "Reply",
  invoice: "Invoice",
  file: "File",
  update: "Project update",
  report: "Report",
  testimonial: "Testimonial",
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? "Update";
}

/** Items grouped by organisation (for people in more than one), urgent first, then oldest first. */
export function groupByOrg(items: MailItem[]): { org: string; items: MailItem[] }[] {
  const order: string[] = [];
  const map = new Map<string, MailItem[]>();
  for (const it of items) {
    const key = (it.org_name ?? "").trim() || "Epsilon Labs";
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(it);
  }
  return order.map((org) => ({
    org,
    items: [...map.get(org)!].sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.created_at.localeCompare(b.created_at)),
  }));
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export function subjectFor(mode: "immediate" | "digest", items: MailItem[]): string {
  const n = items.length;
  if (mode === "digest") return `Your Epsilon digest · ${n} update${n === 1 ? "" : "s"}`;
  if (n === 1) return clip(items[0].title, 120);
  const urgent = items.filter((i) => i.urgent).length;
  return urgent ? `${urgent} item${urgent === 1 ? "" : "s"} need${urgent === 1 ? "s" : ""} your attention · Epsilon` : `${n} updates from Epsilon`;
}

/** An absolute portal link; anything that isn't a same-origin path becomes the portal home. */
export function itemUrl(origin: string, link: string | null): string {
  return `${origin}${safePath(link)}`;
}

/** Counts for the cron route's JSON (numbers only: no addresses or titles in logs). */
export function summarise(jobs: MailJob[]): { emails: number; items: number; digests: number } {
  return { emails: jobs.length, items: jobs.reduce((s, j) => s + j.items.length, 0), digests: jobs.filter((j) => j.mode === "digest").length };
}
