import { describe, expect, it } from "vitest";
import { ageText, ageTone, byNeed, daysSince, nextStep, stageFlex, stageGroup } from "./deals";

const fmt = (iso: string) => iso.slice(5, 10);
const touch = (direction: string, type: string, at: string, subject: string | null = null) => ({ direction, type, subject, occurred_at: at });

describe("nextStep", () => {
  it("a human reply with no draft comes first and is yours", () => {
    const n = nextStep({ stage: "conversation" }, touch("inbound", "human_reply", "2026-10-14T09:00:00Z"), false, 1, fmt);
    expect(n).toMatchObject({ lead: "Reply", who: "you", rank: 0 });
  });
  it("a draft waiting in Approvals outranks everything but a fresh reply", () => {
    expect(nextStep({ stage: "conversation" }, touch("inbound", "human_reply", "2026-10-14T09:00:00Z"), true, 1, fmt)).toMatchObject({ lead: "Draft waiting", rank: 1 });
  });
  it("auto replies and bounces are not replies", () => {
    expect(nextStep({ stage: "lead" }, touch("inbound", "auto_reply", "2026-10-14T09:00:00Z"), false, 1, fmt).rank).toBe(3);
    expect(nextStep({ stage: "lead" }, touch("inbound", "bounce", "2026-10-01T09:00:00Z"), false, 14, fmt)).toMatchObject({ lead: "Nudge", rank: 2 });
  });
  it("a quote ageing past 7 days asks for a follow-up", () => {
    expect(nextStep({ stage: "quote_out", quoted_at: "2026-10-12T00:00:00Z" }, null, false, 3, fmt)).toMatchObject({ lead: null, rank: 3, rest: "Quote out · sent 10-12" });
    expect(nextStep({ stage: "quote_out", quoted_at: "2026-10-01T00:00:00Z" }, null, false, 9, fmt)).toMatchObject({ lead: "Follow up quote", rank: 2 });
  });
  it("closed and dormant deals sink to the end", () => {
    expect(nextStep({ stage: "won", closed_at: "2026-10-02T00:00:00Z" }, null, true, 40, fmt)).toMatchObject({ lead: "Won", rank: 4 });
    expect(nextStep({ stage: "lost", lost_reason: "in-house" }, null, false, 40, fmt)).toMatchObject({ rest: "Lost · in-house", rank: 4 });
    expect(nextStep({ stage: "dormant" }, null, false, 40, fmt).rank).toBe(4);
  });
  it("a fresh outbound touch waits on them", () => {
    expect(nextStep({ stage: "lead" }, touch("outbound", "sent", "2026-10-14T00:00:00Z", "Follow-up 1"), false, 1, fmt)).toMatchObject({ rest: "Waiting · Follow-up 1", who: "them", rank: 3 });
  });
});

describe("byNeed", () => {
  it("orders by rank, the longest-waiting first while a touch is owed, then the latest touch", () => {
    const rows = [
      { id: "fresh", rank: 3, touchedAt: "2026-10-14" },
      { id: "older", rank: 3, touchedAt: "2026-10-10" },
      { id: "stale-new", rank: 2, touchedAt: "2026-10-05" },
      { id: "stale-old", rank: 2, touchedAt: "2026-09-20" },
      { id: "reply", rank: 0, touchedAt: "2026-10-14" },
      { id: "won", rank: 4, touchedAt: "2026-10-15" },
    ];
    expect([...rows].sort(byNeed).map((r) => r.id)).toEqual(["reply", "stale-old", "stale-new", "fresh", "older", "won"]);
  });
});

describe("helpers", () => {
  it("stale is the age colour only, and only for open deals", () => {
    expect(ageTone(6, "lead")).toBe("");
    expect(ageTone(7, "lead")).toBe("c-warn");
    expect(ageTone(14, "quote_out")).toBe("c-bad");
    expect(ageTone(30, "won")).toBe("");
  });
  it("formats ages and groups won with lost", () => {
    expect(ageText(0)).toBe("today");
    expect(ageText(9)).toBe("9 d");
    expect(stageGroup("won")).toBe("won_lost");
    expect(stageGroup("lost")).toBe("won_lost");
    expect(stageGroup("lead")).toBe("lead");
    expect(daysSince("2026-10-13T00:00:00Z", new Date("2026-10-15T01:00:00Z"))).toBe(2);
  });
  it("stage-bar widths grow with the count but keep small stages readable", () => {
    expect(stageFlex(108)).toBe(39);
    expect(stageFlex(1)).toBe(11);
    expect(stageFlex(0)).toBe(8);
  });
});
