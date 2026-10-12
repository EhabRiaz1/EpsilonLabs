"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import type { FormResult } from "@/app/components/Forms";

// Project agent (migration 015). Every write is a staff RPC (aal2, audited). The Mac worker does the work; admin never
// talks to it. Nothing here merges or pushes by itself: Merge records that Ehab merged, Push queues the worker's plain
// `git push origin ticket/EL-<n>`.

const UUID = /^[0-9a-f-]{36}$/i;

function refresh(ticketId: string) {
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
  revalidatePath("/approvals");
}

function friendly(msg: string, fallback: string): string {
  const known = [
    "approve the brief first", "approve a plan first", "the ticket is closed", "agent mode needs a git folder",
    "the agent is off for this project", "the project has no folder", "an agent run is open", "an agent run is already open",
    "choose agent mode first", "only a finished agent run in review can be pushed", "enter an https:// preview URL",
    "write what to change", "only a brief waiting for approval", "only a plan waiting for approval", "is not waiting for approval",
    "only a run in review", "can no longer be discarded", "a brief needs a problem", "a plan needs a summary", "under 100 KB",
  ];
  const hit = known.find((k) => msg.toLowerCase().includes(k.toLowerCase()));
  if (!hit) return fallback;
  // the rulebook's own words (015 raises plain sentences), shown as one sentence
  const m = msg.split("\n")[0].trim();
  return m.charAt(0).toUpperCase() + m.slice(1) + (m.endsWith(".") ? "" : ".");
}

async function rpc(fn: string, args: Record<string, unknown>, ticketId: string, ok: string, fallback = "That didn't work. Reload and try again."): Promise<FormResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(ticketId)) return { error: "Unknown ticket." };
  const { error } = await supabase.rpc(fn, args);
  if (error) {
    console.error(`${fn} failed:`, error.message);
    return { error: friendly(error.message, fallback) };
  }
  refresh(ticketId);
  return { ok };
}

export async function requestBrief(ticketId: string): Promise<FormResult> {
  return rpc("request_brief", { p_ticket_id: ticketId }, ticketId, "Brief queued. The Mac drafts it without tools in a minute or two.");
}

export async function approveBrief(ticketId: string, runId: string): Promise<FormResult> {
  if (!UUID.test(runId)) return { error: "Unknown brief." };
  return rpc("approve_brief", { p_run_id: runId }, ticketId, "Brief approved. The client sees \"Triaged\".");
}

export async function requestPlan(ticketId: string): Promise<FormResult> {
  return rpc("request_plan", { p_ticket_id: ticketId }, ticketId, "Read-only plan queued on the Mac.");
}

export async function approvePlan(ticketId: string, runId: string): Promise<FormResult> {
  if (!UUID.test(runId)) return { error: "Unknown plan." };
  return rpc("approve_plan", { p_run_id: runId }, ticketId, "Plan approved. The client sees \"Planned\". Pick Agent or Manual.");
}

const lines = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split("\n")
    .map((s) => s.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((s) => s.slice(0, 400));
const text = (v: FormDataEntryValue | null, n: number) => String(v ?? "").trim().slice(0, n);

export async function editBrief(ticketId: string, runId: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  if (!UUID.test(runId)) return { error: "Unknown brief." };
  const out = {
    title: text(fd.get("title"), 120),
    problem: text(fd.get("problem"), 1200),
    change: lines(fd.get("change")),
    not_in_scope: lines(fd.get("not_in_scope")),
    acceptance: lines(fd.get("acceptance")),
    questions_for_client: lines(fd.get("questions_for_client")),
    notes: text(fd.get("notes"), 400),
  };
  if (!out.problem || !out.change.length) return { error: "A brief needs a problem and at least one change line." };
  return rpc("edit_brief", { p_run_id: runId, p_output: out }, ticketId, "Brief saved. Approve it when it reads right.");
}

export async function editPlan(ticketId: string, runId: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  if (!UUID.test(runId)) return { error: "Unknown plan." };
  const files = lines(fd.get("files")).map((l) => {
    const i = l.indexOf(":");
    return i > 0 ? { path: l.slice(0, i).trim().slice(0, 300), change: l.slice(i + 1).trim().slice(0, 300) || "change" } : { path: l.slice(0, 300), change: "change" };
  });
  const low = Number(fd.get("low"));
  const high = Number(fd.get("high"));
  const out = {
    summary: text(fd.get("summary"), 1200),
    files,
    steps: lines(fd.get("steps")),
    risks: lines(fd.get("risks")),
    tests_to_add: lines(fd.get("tests_to_add")),
    estimate_hours: { low: Number.isFinite(low) ? Math.max(0, low) : 0, high: Number.isFinite(high) ? Math.max(0, high) : 0 },
    questions_for_client: lines(fd.get("questions_for_client")),
    notes: text(fd.get("notes"), 600),
  };
  if (!out.summary || !out.steps.length) return { error: "A plan needs a summary and at least one step." };
  return rpc("edit_plan", { p_run_id: runId, p_output: out }, ticketId, "Plan saved. The agent works from this version once you approve it.");
}

export async function chooseMode(ticketId: string, mode: "agent" | "manual"): Promise<FormResult> {
  if (mode !== "agent" && mode !== "manual") return { error: "Unknown mode." };
  return rpc("choose_mode", { p_ticket_id: ticketId, p_mode: mode }, ticketId,
    mode === "agent" ? "Agent mode. Start the run when you're ready." : "Manual mode. The Mac picks up commits that mention the ticket every 10 min.");
}

export async function requestExecute(ticketId: string, notes: string): Promise<FormResult> {
  return rpc("request_execute", { p_ticket_id: ticketId, p_notes: String(notes ?? "").trim().slice(0, 4000) || null }, ticketId,
    "Agent run queued. It works in a separate worktree; your working copy is never touched.");
}

export async function sendBack(ticketId: string, runId: string, notes: string): Promise<FormResult> {
  if (!UUID.test(runId)) return { error: "Unknown run." };
  const n = String(notes ?? "").trim();
  if (!n) return { error: "Write what should change." };
  return rpc("send_back_run", { p_run_id: runId, p_notes: n.slice(0, 4000) }, ticketId, "Sent back. A new run continues on the same branch.");
}

export async function markMerged(ticketId: string, runId: string): Promise<FormResult> {
  if (!UUID.test(runId)) return { error: "Unknown run." };
  return rpc("mark_merged", { p_run_id: runId }, ticketId, "Marked merged. The client sees \"Done\"; the Mac removes the worktree.");
}

export async function discardRun(ticketId: string, runId: string): Promise<FormResult> {
  if (!UUID.test(runId)) return { error: "Unknown run." };
  return rpc("discard_run", { p_run_id: runId }, ticketId, "Discarded. The Mac removes the worktree and the branch.");
}

export async function pushPreview(ticketId: string, runId: string): Promise<FormResult> {
  if (!UUID.test(runId)) return { error: "Unknown run." };
  return rpc("push_preview_request", { p_run_id: runId }, ticketId, "Push queued. The Mac runs git push origin for this branch only.");
}

export async function attachPreview(ticketId: string, runId: string, url: string, toClient: boolean): Promise<FormResult> {
  if (!UUID.test(runId)) return { error: "Unknown run." };
  const u = String(url ?? "").trim();
  if (!/^https:\/\/[A-Za-z0-9.-]+(:[0-9]+)?(\/[^\s<>"]*)?$/.test(u)) return { error: "Paste an https:// preview URL." };
  return rpc("attach_preview", { p_run_id: runId, p_url: u, p_to_client: Boolean(toClient) }, ticketId,
    toClient ? "Preview link sent to the client." : "Preview link saved (internal).");
}

export async function scanCommitsNow(ticketId: string, projectId: string): Promise<FormResult> {
  if (!UUID.test(projectId)) return { error: "Unknown project." };
  return rpc("request_commit_scan", { p_project_id: projectId }, ticketId, "Commit scan queued on the Mac.");
}
