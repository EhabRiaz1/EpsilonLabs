// The project-agent pipeline of one ticket (migration 015): Request → Brief → Plan → Mode → Agent / Work → Review → Done.
// Pure (unit-tested in pipeline.test.ts). The database rulebook decides what is allowed; this only decides what the admin
// ticket page shows and which buttons it offers, from the ticket, its ticket_runs and the project's agent settings.

export type RunStage = "brief" | "plan" | "execute";
export type RunStatus = "queued" | "ready" | "approved" | "failed" | "superseded" | "merged" | "discarded" | "sent_back";
export type Run = {
  id: string; stage: RunStage; status: RunStatus | string; created_at: string; finished_at?: string | null; approved_at?: string | null;
  edited_at?: string | null; error?: string | null; tokens?: number | null;
};
export type ProjectAgent = { repo_path: string | null; is_git: boolean | null; agent_enabled: boolean; test_command: string | null };
export type Stage = "brief" | "plan" | "mode" | "execute" | "review" | "manual" | "done" | "closed";
export type StepState = "done" | "current" | "todo" | "failed";
export type Step = { key: "request" | "brief" | "plan" | "mode" | "work" | "review" | "done"; label: string; state: StepState; meta: string };

const byNewest = (a: Run, b: Run) => b.created_at.localeCompare(a.created_at);

/** The newest run of a stage that still matters (superseded runs only when nothing else exists). */
export function latestRun<R extends Run>(runs: R[], stage: RunStage): R | null {
  const list = runs.filter((r) => r.stage === stage).sort(byNewest);
  return list.find((r) => r.status !== "superseded") ?? list[0] ?? null;
}

export function approvedRun<R extends Run>(runs: R[], stage: RunStage): R | null {
  return runs.filter((r) => r.stage === stage && r.status === "approved").sort(byNewest)[0] ?? null;
}

/** Can this ticket go to the agent? The same checks as choose_mode('agent') in 015, with a reason to show. */
export function agentAvailability(project: ProjectAgent | null, planApproved: boolean): { ok: boolean; reason: string } {
  if (!project?.repo_path) return { ok: false, reason: "No project folder set: Manual only." };
  if (project.is_git === false) return { ok: false, reason: "The folder is not a git repo: Manual only." };
  if (project.is_git !== true) return { ok: false, reason: "The Mac has not checked the folder yet (every 10 min)." };
  if (!project.agent_enabled) return { ok: false, reason: "The agent is off for this project (Clients → project settings)." };
  if (!planApproved) return { ok: false, reason: "Approve a plan first." };
  return { ok: true, reason: project.test_command ? `Runs only: ${project.test_command}` : "No test command set: the agent can't run tests." };
}

export function canPlan(project: ProjectAgent | null): boolean {
  return Boolean(project?.repo_path && project.agent_enabled);
}

export function pipelineStage(ticket: { status: string; mode: string | null }, runs: Run[], project: ProjectAgent | null): Stage {
  if (ticket.status === "declined") return "closed";
  if (ticket.status === "done") return "done";
  if (ticket.mode === "manual") return "manual";
  const exec = latestRun(runs, "execute");
  if (ticket.mode === "agent") {
    if (exec?.status === "ready") return "review";
    return "execute";
  }
  if (!approvedRun(runs, "brief")) return "brief";
  if (approvedRun(runs, "plan") || !canPlan(project)) return "mode";
  return "plan";
}

function runMeta(r: Run | null, what: string): string {
  if (!r) return "";
  if (r.status === "queued") return `${what} · on the Mac`;
  if (r.status === "ready") return "waiting for you";
  if (r.status === "failed") return "failed";
  if (r.status === "approved") return r.edited_at ? "approved · edited" : "approved";
  return "";
}

export function pipelineSteps(ticket: { status: string; mode: string | null }, runs: Run[], project: ProjectAgent | null): Step[] {
  const stage = pipelineStage(ticket, runs, project);
  const order: Step["key"][] = ["request", "brief", "plan", "mode", "work", "review", "done"];
  const at: Record<Stage, Step["key"]> = {
    brief: "brief", plan: "plan", mode: "mode", execute: "work", review: "review", manual: "work", done: "done", closed: "done",
  };
  const cur = order.indexOf(at[stage]);
  const brief = latestRun(runs, "brief");
  const plan = latestRun(runs, "plan");
  const exec = latestRun(runs, "execute");
  const tokens = runs.filter((r) => r.stage === "execute").reduce((s, r) => s + Number(r.tokens ?? 0), 0);
  const meta: Record<Step["key"], string> = {
    request: "client",
    brief: runMeta(brief, "tool-less") || (approvedRun(runs, "brief") ? "approved" : "tool-less"),
    plan: approvedRun(runs, "plan") ? "approved" : canPlan(project) ? runMeta(plan, "read-only") || "read-only" : "no folder",
    mode: ticket.mode === "agent" ? "Agent" : ticket.mode === "manual" ? "Manual" : "you pick",
    work: ticket.mode === "manual" ? "you, commits tracked" : exec ? (exec.status === "queued" ? "agent working" : tokens ? `${fmtTokens(tokens)} tokens` : "agent") : "",
    review: stage === "review" ? "you decide" : "",
    done: stage === "closed" ? "declined" : stage === "done" ? "done" : "merge → Done",
  };
  const failed: Partial<Record<Step["key"], boolean>> = {
    brief: brief?.status === "failed" && stage === "brief",
    plan: plan?.status === "failed" && stage === "plan",
    work: exec?.status === "failed" && stage === "execute",
  };
  const labels: Record<Step["key"], string> = {
    request: "Request", brief: "Brief", plan: "Plan", mode: "Mode", work: ticket.mode === "manual" ? "Work" : "Agent", review: "Review", done: "Done",
  };
  return order.map((key, i) => ({
    key,
    label: labels[key],
    state: (stage === "done" || stage === "closed") ? "done" : failed[key] ? "failed" : i < cur ? "done" : i === cur ? "current" : "todo",
    meta: meta[key],
  }));
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(n);
}
