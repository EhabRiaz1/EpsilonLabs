import { describe, expect, it } from "vitest";
import { auditSince, consoleUrl, healthProblems } from "./health";

const NOW = new Date("2026-10-15T06:00:00Z");
const base = { failedBeats: [], labels: new Map([["prospector", "Prospector"]]), sends: [], meters: [], usageError: false, agentPaused: false, consoleUrl: "https://supabase.com/dashboard", now: NOW };

describe("healthProblems", () => {
  it("is empty when all is well (caps under 80%)", () => {
    expect(healthProblems({ ...base, meters: [{ label: "Database", used: 79, cap: 100 }] })).toEqual([]);
  });

  it("groups failed runs of the last 24 h per agent and ignores older ones", () => {
    const p = healthProblems({
      ...base,
      failedBeats: [
        { agent: "prospector", last_run: "2026-10-15T03:00:00Z", detail: { error: "timeout" } },
        { agent: "prospector", last_run: "2026-10-15T05:00:00Z", detail: { error: "rate limited" } },
        { agent: "tenders", last_run: "2026-10-13T05:00:00Z", detail: null },
      ],
    });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ key: "run-prospector", tone: "bad", title: "Prospector failed 2× in the last 24 h", href: "/agents" });
    expect(p[0].detail).toBe("last 1h ago · rate limited");
  });

  it("splits failed from unverified sends (stuck 'sending' counts as unverified)", () => {
    const p = healthProblems({
      ...base,
      sends: [
        { status: "failed", send_error: "smtp 550" },
        { status: "failed", send_error: "unverified: check Sent folder" },
        { status: "sending", claimed_at: "2026-10-15T05:30:00Z" },
        { status: "sending", claimed_at: "2026-10-15T05:58:00Z" },
      ],
    });
    expect(p.map((x) => [x.key, x.title])).toEqual([
      ["sends-failed", "1 send failed"],
      ["sends-unverified", "2 sends not verified"],
    ]);
  });

  it("flags caps over 80% and orders bad before warn", () => {
    const p = healthProblems({ ...base, agentPaused: true, meters: [{ label: "Storage", used: 85, cap: 100 }, { label: "Database", used: 95, cap: 100 }] });
    expect(p.map((x) => x.key)).toEqual(["cap-database", "cap-storage", "budget"]);
    expect(p[0].external).toBe(true);
  });
});

describe("helpers", () => {
  it("consoleUrl reads the project ref", () => {
    expect(consoleUrl("https://abcdef123.supabase.co")).toBe("https://supabase.com/dashboard/project/abcdef123");
    expect(consoleUrl(undefined)).toBe("https://supabase.com/dashboard");
  });
  it("auditSince", () => {
    expect(auditSince("24h", NOW)).toBe("2026-10-14T06:00:00.000Z");
    expect(auditSince("7d", NOW)).toBe("2026-10-08T06:00:00.000Z");
  });
});
