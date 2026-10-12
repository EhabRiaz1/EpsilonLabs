import { describe, expect, it } from "vitest";
import { agentAvailability, approvedRun, fmtTokens, latestRun, pipelineStage, pipelineSteps, type ProjectAgent, type Run } from "./pipeline";

const GIT: ProjectAgent = { repo_path: "~/dev/hmi", is_git: true, agent_enabled: true, test_command: "npm test" };
let n = 0;
const run = (stage: Run["stage"], status: string, extra: Partial<Run> = {}): Run => ({
  id: `r${++n}`, stage, status, created_at: `2026-10-1${Math.min(9, n)}T0${n % 10}:00:00Z`, ...extra,
});
const t = (status = "new", mode: string | null = null) => ({ status, mode });
const states = (steps: ReturnType<typeof pipelineSteps>) => steps.map((s) => `${s.key}:${s.state}`).join(" ");

describe("pipeline stage", () => {
  it("walks brief → plan → mode → execute → review → done", () => {
    expect(pipelineStage(t(), [run("brief", "queued")], GIT)).toBe("brief");
    expect(pipelineStage(t(), [run("brief", "ready")], GIT)).toBe("brief");
    const b = run("brief", "approved");
    expect(pipelineStage(t("briefed"), [b, run("plan", "queued")], GIT)).toBe("plan");
    const p = run("plan", "approved");
    expect(pipelineStage(t("planned"), [b, p], GIT)).toBe("mode");
    expect(pipelineStage(t("in_progress", "agent"), [b, p, run("execute", "queued")], GIT)).toBe("execute");
    expect(pipelineStage(t("in_progress", "agent"), [b, p, run("execute", "ready")], GIT)).toBe("review");
    expect(pipelineStage(t("done", "agent"), [b, p, run("execute", "merged")], GIT)).toBe("done");
    expect(pipelineStage(t("declined"), [], GIT)).toBe("closed");
  });
  it("skips the plan when there is no folder or the agent is off", () => {
    const b = run("brief", "approved");
    expect(pipelineStage(t("briefed"), [b], { ...GIT, repo_path: null })).toBe("mode");
    expect(pipelineStage(t("briefed"), [b], { ...GIT, agent_enabled: false })).toBe("mode");
    expect(pipelineStage(t("in_progress", "manual"), [b], null)).toBe("manual");
  });
  it("after a discard or send-back the agent stage offers a new run", () => {
    const b = run("brief", "approved"), p = run("plan", "approved");
    expect(pipelineStage(t("in_progress", "agent"), [b, p, run("execute", "discarded")], GIT)).toBe("execute");
    expect(pipelineStage(t("in_progress", "agent"), [b, p, run("execute", "sent_back"), run("execute", "queued")], GIT)).toBe("execute");
  });
  it("latest ignores superseded runs unless nothing else exists", () => {
    const old = run("brief", "superseded"), cur = run("brief", "ready"), newest = run("brief", "superseded");
    expect(latestRun([old, cur, newest], "brief")?.id).toBe(cur.id);
    expect(latestRun([old], "brief")?.id).toBe(old.id);
    expect(latestRun([], "plan")).toBeNull();
    expect(approvedRun([cur], "brief")).toBeNull();
  });
});

describe("pipeline steps", () => {
  it("marks done / current / todo and failures", () => {
    expect(states(pipelineSteps(t(), [run("brief", "ready")], GIT))).toBe(
      "request:done brief:current plan:todo mode:todo work:todo review:todo done:todo");
    expect(states(pipelineSteps(t(), [run("brief", "failed")], GIT))).toContain("brief:failed");
    const b = run("brief", "approved"), p = run("plan", "approved");
    const review = pipelineSteps(t("in_progress", "agent"), [b, p, run("execute", "ready", { tokens: 2_300_000 })], GIT);
    expect(states(review)).toBe("request:done brief:done plan:done mode:done work:done review:current done:todo");
    expect(review.find((s) => s.key === "work")?.meta).toBe("2.3M tokens");
    expect(review.find((s) => s.key === "mode")?.meta).toBe("Agent");
    expect(states(pipelineSteps(t("done", "manual"), [b], GIT))).toBe(
      "request:done brief:done plan:done mode:done work:done review:done done:done");
    const manual = pipelineSteps(t("in_progress", "manual"), [b], { ...GIT, repo_path: null });
    expect(manual.find((s) => s.key === "work")?.label).toBe("Work");
    expect(manual.find((s) => s.key === "plan")?.meta).toBe("no folder");
  });
});

describe("agent availability", () => {
  it("explains why agent mode is not offered", () => {
    expect(agentAvailability(null, true).ok).toBe(false);
    expect(agentAvailability({ ...GIT, is_git: false }, true).reason).toMatch(/not a git repo: Manual only/);
    expect(agentAvailability({ ...GIT, is_git: null }, true).reason).toMatch(/not checked/);
    expect(agentAvailability({ ...GIT, agent_enabled: false }, true).reason).toMatch(/agent is off/);
    expect(agentAvailability(GIT, false).reason).toBe("Approve a plan first.");
    expect(agentAvailability(GIT, true)).toEqual({ ok: true, reason: "Runs only: npm test" });
    expect(agentAvailability({ ...GIT, test_command: null }, true).reason).toMatch(/can't run tests/);
  });
  it("formats tokens", () => {
    expect([fmtTokens(950), fmtTokens(1500), fmtTokens(23_000), fmtTokens(2_000_000), fmtTokens(12_400_000)]).toEqual(["950", "1.5k", "23k", "2M", "12M"]);
  });
});
