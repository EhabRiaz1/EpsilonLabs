// The Agents page catalogue and state rules, ported from epsilon-os/dashboard/data.py (AGENT_CATALOG, agents_overview).
// launchd facts come from the Mac worker's heartbeat snapshot (agent 'worker', detail.jobs), since admin.* never
// talks to the laptop.
import { ago, detailIssue, detailSummary } from "./admin-ops";

export type CatalogEntry = { key: string; label: string; what: string; job: string | null; hb: string | null; stale: number };
export const AGENT_CATALOG: [string, CatalogEntry[]][] = [
  ["Sales & outreach", [
    { key: "prospector", label: "Prospector", what: "Finds new companies with the research strategies and drafts first emails for the Deck.", job: "prospector", hb: "prospector", stale: 26 * 3600 },
    { key: "outreach", label: "Outreach sends", what: "Sends approved cold emails inside the warm-up cap, with threading.", job: "outreach", hb: "outreach", stale: 15 * 60 },
    { key: "followups", label: "Follow-ups", what: "Drafts day-4 and day-9 follow-ups and stops a sequence when someone replies.", job: "outreach", hb: "followups", stale: 2 * 3600 },
  ]],
  ["Research", [
    { key: "tenders", label: "Tender scan", what: "Reads government and development-bank tender feeds and scores fit.", job: "tenders", hb: "tenders", stale: 26 * 3600 },
  ]],
  ["Mail", [
    { key: "inbox", label: "Inbox", what: "Reads er@ and the outreach mailbox, classifies replies and drafts answers.", job: "inbox", hb: "inbox", stale: 15 * 60 },
    { key: "outbox", label: "Outbox", what: "Lints drafts edited off the Mac, sends what you approved after the undo window, and verifies delivery.", job: "outbox", hb: "outbox", stale: 5 * 60 },
  ]],
  ["Reporting & safety", [
    { key: "brief", label: "Morning brief", what: "Emails you a summary at 08:30, only on days with news.", job: "brief", hb: "brief", stale: 26 * 3600 },
    { key: "backup", label: "Backup", what: "Weekly export of every table to ~/EpsilonOS-backups.", job: "backup", hb: "backup", stale: 8 * 86400 },
    { key: "scheduler", label: "Scheduler", what: "Every 5 min, starts any daily job whose time has passed but has not run yet.", job: "scheduler", hb: "scheduler", stale: 2 * 3600 },
    { key: "watchdog", label: "Watchdog", what: "Pings healthchecks.io so you are emailed if the system stops.", job: null, hb: "watchdog", stale: 3600 },
  ]],
  ["Always on", [
    { key: "worker", label: "Worker", what: "Every minute: starts Run-now requests from here, sends push notifications, reports this page's launchd state, and drafts weekly updates, delivery reports and referral asks.", job: "worker", hb: "worker", stale: 5 * 60 },
    { key: "project_agent", label: "Project agent", what: "Every minute: tool-less ticket briefs, read-only plans, approved agent runs in a git worktree, preview pushes you ask for, and the 10-minute commit scan for manual tickets.", job: "project_agent", hb: "project_agent", stale: 45 * 60 },
    { key: "dashboard", label: "Local cockpit", what: "The 8787 cockpit on the Mac (127.0.0.1:8787).", job: "dashboard", hb: null, stale: 0 },
    { key: "keepawake", label: "Keep-awake", what: "Stops the Mac from idle-sleeping so jobs keep running.", job: "keepawake", hb: null, stale: 0 },
  ]],
];
/** Agents not built yet. Weekly updates and report drafts run inside the worker (agents/platform_jobs.py) and invoices
 *  are scheduled by the database from the proposal's payment plan, so only the proposal drafter is left. */
export const PLANNED_AGENTS: [string, string][] = [
  ["Proposal drafter", "Drafts deal-room proposals from your packages and call notes."],
];
export const RUNNABLE = new Set(["prospector", "tenders", "brief"]);

export type JobSnap = { loaded?: boolean; running?: boolean; exit?: string | null; next?: string | null; cadence?: string };
export type Beat = { agent: string; last_run: string; status: "ok" | "warn" | "error" | string; detail: Record<string, unknown> | null };
export type AgentState = "ok" | "amber" | "red" | "idle";
export type AgentRow = CatalogEntry & {
  state: AgentState; text: string; running: boolean; cadence: string; last: string; summary: string; issue: string;
  next: string | null; calls: number; runnable: boolean; history: string[]; historyAt: string[]; exit: string | null;
};

/** data.agents_overview for one entry. `snap` is null when the worker has not reported (no launchd facts). */
export function agentRow(a: CatalogEntry, beats: Beat[], snap: JobSnap | null, calls: number, now: Date): AgentRow {
  const last = beats[0] ?? null;
  const t = last ? Date.parse(last.last_run) : NaN;
  const running = Boolean(snap?.running);
  let state: AgentState;
  let text: string;
  if (a.job && a.stale === 0) {
    if (!snap) [state, text] = ["idle", "unknown until the worker reports"];
    else [state, text] = running ? ["ok", "running"] : ["red", snap.loaded ? "stopped" : "not loaded"];
  } else if (!last) {
    [state, text] = !snap || snap.loaded ? ["idle", "not run yet"] : ["red", "not installed"];
  } else {
    const age = Number.isNaN(t) ? 1e12 : (now.getTime() - t) / 1000;
    state = last.status === "error" ? "red" : last.status === "warn" || age > a.stale ? "amber" : "ok";
    text = { ok: "healthy", amber: "needs a look", red: "failing", idle: "" }[state];
    if (age > a.stale && last.status === "ok") text = "overdue";
  }
  if (a.job && snap && snap.loaded === false && a.stale) [state, text] = ["red", "not installed"];
  let cadence = a.key === "watchdog" ? "every 30 min" : "";
  let next: string | null = null;
  if (a.job && a.stale) {
    next = snap?.next ?? null;
    cadence = a.key === "followups" ? "hourly, inside outreach" : (snap?.cadence ?? "");
  }
  if (running && a.stale) text = "running now";
  return {
    ...a, state, text, running, cadence, next, calls,
    last: last ? ago(last.last_run, now) : "never",
    summary: last ? detailSummary(last.detail) : "",
    issue: last ? detailIssue(last.detail) : "",
    runnable: RUNNABLE.has(a.job ?? "") && !running,
    history: beats.map((b) => b.status).reverse(),
    historyAt: beats.map((b) => b.last_run).reverse(),
    exit: snap?.exit ?? null,
  };
}

export const STATE_PILL: Record<AgentState, string> = { ok: "pill-good", amber: "pill-warn", red: "pill-bad", idle: "" };
