// Pure helpers for the admin pages ported from the 8787 cockpit (epsilon-os/dashboard/data.py). Same rules, same words.

export const PKT_OFFSET = "+05:00"; // Asia/Karachi has no DST

/** "now" / "45s" / "12m" / "3h 05m" / "2d" (data.ago) */
export function ago(iso: string | null | undefined, now: Date): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "never";
  const s = Math.max(Math.floor((now.getTime() - t) / 1000), 0);
  if (s < 60) return s < 10 ? "now" : `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 24) return mm ? `${h}h ${String(mm).padStart(2, "0")}m` : `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** yyyy-mm-dd in PKT */
export function pktDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Karachi" }).format(d);
}

/** Midnight today in PKT, as an ISO timestamp (data.pkt_midnight) */
export function pktMidnight(now: Date, daysBack = 0): string {
  const day = new Date(Date.parse(`${pktDate(now)}T00:00:00${PKT_OFFSET}`) - daysBack * 86_400_000);
  return day.toISOString();
}

/** "$7,200" or "$18.0k" (data.money) */
export function money(v: number): string {
  return v >= 10000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v).toLocaleString("en-US")}`;
}

/** data.fmt_amount */
export function fmtAmount(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`.replace(".0M", "M");
  if (v >= 1000) return `${Math.round(v / 1000)}k`;
  return `${Math.round(v)}`;
}

/** data.opp_value */
export function oppValue(r: { value_min?: number | string | null; value_max?: number | string | null; currency?: string | null }): string {
  let lo = r.value_min == null ? null : Number(r.value_min);
  let hi = r.value_max == null ? null : Number(r.value_max);
  if (!lo && !hi) return "Not stated";
  lo = lo || hi;
  hi = hi || lo;
  const amt = lo === hi ? fmtAmount(lo as number) : `${fmtAmount(lo as number)}-${fmtAmount(hi as number)}`;
  return `${r.currency ?? ""} ${amt}`.trim();
}

/** data.countdown: [text, tone] where tone is "" | "amber" | "red" */
export function countdown(deadline: string | null | undefined, now: Date): [string, "" | "amber" | "red"] {
  const t = deadline ? Date.parse(deadline) : NaN;
  if (Number.isNaN(t)) return ["No deadline stated", ""];
  const days = (t - now.getTime()) / 86_400_000;
  if (days < 0) return ["Closed", "red"];
  if (days < 1) return ["Closes today", "red"];
  const n = Math.floor(days);
  return [`${n}d left`, n < 5 ? "red" : n < 10 ? "amber" : ""];
}

/** Only http(s) links, never javascript: or relative (data.safe_url) */
export function safeUrl(u: unknown): string {
  const s = String(u ?? "");
  return /^https?:\/\//.test(s) && !/\s/.test(s) ? s : "";
}

// ---- free-plan caps (F16) ----
export function usagePct(used: number, cap: number): number {
  if (!(cap > 0) || !(used >= 0)) return 0;
  return Math.round((used / cap) * 1000) / 10;
}
/** good below 70%, warn from 70%, bad from 90% */
export function usageTone(pct: number): "good" | "warn" | "bad" {
  return pct >= 90 ? "bad" : pct >= 70 ? "warn" : "good";
}
export function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} kB`;
  return `${n} B`;
}

// ---- heartbeat detail (data.fmt_detail / _summary / _issue) ----
type Detail = Record<string, unknown> | null | undefined;
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v !== 0;

export function fmtDetail(detail: Detail): [string, string] {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return ["", ""];
  const err = detail.error ? String(detail.error) : "";
  const parts = (typeof detail.state === "string" ? [detail.state] : []).concat(
    Object.entries(detail)
      .filter(([k, v]) => isCount(v) && k !== "errors")
      .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`),
  );
  if (detail.errors) parts.push(`errors ${String(detail.errors)}`);
  return [parts.join(" · "), err];
}

const SKIP = new Set(["run_id", "message_id", "mode", "state", "for", "ok"]);
export function detailSummary(detail: Detail): string {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(detail)) {
    if (SKIP.has(k) || typeof v === "boolean") continue;
    if (typeof v === "number" && v) parts.push(`${k.replace(/_/g, " ")} ${v}`);
    if (parts.length >= 4) break;
  }
  if (detail.state) parts.unshift(String(detail.state));
  return parts.join(" · ");
}
export function detailIssue(detail: Detail): string {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return "";
  if (detail.error) return String(detail.error).slice(0, 160);
  const feeds = detail.feeds;
  if (feeds && typeof feeds === "object") {
    for (const [k, v] of Object.entries(feeds as Record<string, unknown>)) {
      if (typeof v === "string" && v.startsWith("failed")) return `${k}: ${v}`.slice(0, 160);
    }
  }
  return "";
}

// ---- approval queue ----
export type DeckKind = "outbound" | "reply" | "ack" | "quote" | "optout_confirm" | string;

/** Cold email = first touch, Follow-up = sequence step 2/3, then the inbox kinds */
export function kindLabel(kind: DeckKind | null | undefined, step: number | null | undefined): string {
  if (kind === "outbound") return (step ?? 0) >= 2 ? `Follow-up ${step}` : "Cold email";
  return { ack: "Acknowledgement", quote: "Quote", optout_confirm: "Opt-out confirmation", reply: "Reply" }[kind ?? "reply"] ?? "Reply";
}

/** Deck order (data.pending_cards): not-later first by created_at, then 'later' items in the order they were deferred */
export function deckOrder<T extends { id: string; created_at: string }>(rows: T[], later: Map<string, string>): T[] {
  return [...rows].sort((a, b) => {
    const la = later.get(a.id);
    const lb = later.get(b.id);
    if (!!la !== !!lb) return la ? 1 : -1;
    if (la && lb && la !== lb) return la < lb ? -1 : 1;
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
  });
}

/** data.is_verify: the outbox is not sure whether a row went out */
export function isVerify(r: { status: string; claimed_at?: string | null; send_error?: string | null }, now: Date): boolean {
  if (r.status === "sending") {
    const t = r.claimed_at ? Date.parse(r.claimed_at) : NaN;
    return !Number.isNaN(t) && now.getTime() - t > 10 * 60_000;
  }
  return r.status === "failed" && String(r.send_error ?? "").startsWith("unverified");
}

/** Worker heartbeat: online when the last beat is younger than 2 minutes (Reliability baseline). */
export function workerOnline(lastRun: string | null | undefined, now: Date): boolean {
  if (!lastRun) return false;
  const t = Date.parse(lastRun);
  return !Number.isNaN(t) && now.getTime() - t < 2 * 60_000;
}

/** "14:32" in PKT */
export function hhmm(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Karachi" }).format(new Date(iso));
}

/** "in 3h 12m" / "due now" (dashboard/schedule.until) */
export function until(iso: string | null | undefined, now: Date): string {
  if (!iso) return "";
  const s = Math.floor((Date.parse(iso) - now.getTime()) / 1000);
  if (Number.isNaN(s)) return "";
  if (s <= 60) return "due now";
  let h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 48) {
    const d = Math.floor(h / 24);
    h %= 24;
    return `in ${d}d ${h}h`;
  }
  return h ? `in ${h}h ${m}m` : `in ${m}m`;
}
