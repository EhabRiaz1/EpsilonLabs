// Pure helpers for admin /health (design review, Phase 3): the "Problems" list that leads the page, and the audit-log
// filters. No I/O (unit-tested).
import { ago, isVerify, usagePct } from "./admin-ops";

/** A free-plan cap is a problem from this share (the meters themselves turn amber at 70%). */
export const CAP_PROBLEM_PCT = 80;
/** Audit log rows per page in the Health sheet. */
export const AUDIT_PAGE = 30;

export type Problem = {
  key: string;
  tone: "bad" | "warn";
  title: string;
  detail: string;
  /** where to act; external links open in a new tab */
  href: string;
  external?: boolean;
  action: string;
};

type FailedBeat = { agent: string; last_run: string; detail: Record<string, unknown> | null };
type Send = { status: string; claimed_at?: string | null; send_error?: string | null };
type Meter = { label: string; used: number; cap: number };

/** Problems, worst first: failed agent runs in the last 24 h (one row per agent), failed and unverified sends, a
 *  free-plan cap over 80%, an unreadable usage RPC, and the project agent paused at its token budget. */
export function healthProblems(i: {
  failedBeats: FailedBeat[];
  labels: Map<string, string>;
  sends: Send[];
  meters: Meter[];
  usageError: boolean;
  agentPaused: boolean;
  consoleUrl: string;
  now: Date;
}): Problem[] {
  const out: Problem[] = [];
  const cut = i.now.getTime() - 86_400_000;
  const byAgent = new Map<string, FailedBeat[]>();
  for (const b of i.failedBeats) {
    const t = Date.parse(b.last_run);
    if (Number.isNaN(t) || t < cut) continue;
    byAgent.set(b.agent, [...(byAgent.get(b.agent) ?? []), b]);
  }
  for (const [agent, beats] of byAgent) {
    const last = [...beats].sort((a, b) => b.last_run.localeCompare(a.last_run))[0];
    const err = last.detail?.error ? String(last.detail.error).slice(0, 140) : "";
    out.push({
      key: `run-${agent}`,
      tone: "bad",
      title: `${i.labels.get(agent) ?? agent} failed${beats.length > 1 ? ` ${beats.length}×` : ""} in the last 24 h`,
      detail: `last ${ago(last.last_run, i.now)} ago${err ? ` · ${err}` : ""}`,
      href: "/agents",
      action: "Agents",
    });
  }
  const unverified = i.sends.filter((s) => isVerify(s, i.now)).length;
  const failed = i.sends.filter((s) => s.status === "failed" && !isVerify(s, i.now)).length;
  if (failed > 0)
    out.push({
      key: "sends-failed",
      tone: "bad",
      title: `${failed} send${failed === 1 ? "" : "s"} failed`,
      detail: "the outbox gave up on these; fix or resend from the Mac cockpit",
      href: "/approvals",
      action: "Approvals",
    });
  if (unverified > 0)
    out.push({
      key: "sends-unverified",
      tone: "warn",
      title: `${unverified} send${unverified === 1 ? "" : "s"} not verified`,
      detail: "the outbox can't tell whether these went out; check the Sent folder",
      href: "/approvals",
      action: "Approvals",
    });
  for (const m of i.meters) {
    const pct = usagePct(m.used, m.cap);
    if (pct > CAP_PROBLEM_PCT)
      out.push({
        key: `cap-${m.label.toLowerCase()}`,
        tone: pct >= 90 ? "bad" : "warn",
        title: `${m.label} at ${pct}% of the free plan`,
        detail: "time to clean up or upgrade to Pro",
        href: i.consoleUrl,
        external: true,
        action: "Supabase",
      });
  }
  if (i.usageError)
    out.push({ key: "usage", tone: "warn", title: "Couldn't read database and storage size", detail: "the platform_usage check failed; the caps are unknown", href: i.consoleUrl, external: true, action: "Supabase" });
  if (i.agentPaused)
    out.push({ key: "budget", tone: "warn", title: "Project agent paused at its token budget", detail: "briefs, plans and agent runs wait until tomorrow", href: "#budget", action: "Budget" });
  return out.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "bad" ? -1 : 1));
}

/** The Supabase dashboard of the project behind a supabase.co URL, or the dashboard home. */
export function consoleUrl(supabaseUrl: string | undefined): string {
  const ref = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(supabaseUrl ?? "")?.[1];
  return ref ? `https://supabase.com/dashboard/project/${ref}` : "https://supabase.com/dashboard";
}

/** Audit-log window: the start ISO timestamp for "24h" or "7d". */
export function auditSince(window: string, now: Date): string {
  return new Date(now.getTime() - (window === "7d" ? 7 : 1) * 86_400_000).toISOString();
}
