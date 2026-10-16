import { describe, expect, it } from "vitest";
import { inline, parseBlocks, scopeView, timelineView, weeklyView } from "./markdown";

describe("weeklyView", () => {
  it("splits the admin editor's three sections into columns", () => {
    const md = "## Done this week\n- Export on **staging**.\n- BOM fix\n\n## Next\n- Ship the fix\n\n## Needs your input\n- Nothing this week.";
    expect(weeklyView(md)).toEqual({ done: ["Export on **staging**.", "BOM fix"], next: ["Ship the fix"], needs: ["Nothing this week."] });
  });
  it("keeps paragraphs and ignores unknown sections", () => {
    expect(weeklyView("## Shipped\nOne line.\n\n## Notes\n- skipped\n\n## What's next\n- a")).toEqual({ done: ["One line."], next: ["a"], needs: [] });
  });
  it("is null for a free-form update", () => {
    expect(weeklyView("Short note.\n\n- a bullet")).toBeNull();
    expect(weeklyView("")).toBeNull();
  });
});

describe("parseBlocks", () => {
  it("parses the subset into data, never HTML", () => {
    expect(parseBlocks("Intro line one\nline two\n\n## Sensor plan\nA survey.\n- a\n- b\n> **Not included.** ERP")).toEqual([
      { type: "p", text: "Intro line one line two" },
      { type: "h", text: "Sensor plan" },
      { type: "p", text: "A survey." },
      { type: "ul", items: ["a", "b"] },
      { type: "quote", text: "**Not included.** ERP" },
    ]);
    expect(parseBlocks("<script>alert(1)</script>")).toEqual([{ type: "p", text: "<script>alert(1)</script>" }]);
    expect(parseBlocks("")).toEqual([]);
  });

  it("splits bold runs", () => {
    expect(inline("a **b** c")).toEqual([{ text: "a ", bold: false }, { text: "b", bold: true }, { text: " c", bold: false }]);
    expect(inline("no bold")).toEqual([{ text: "no bold", bold: false }]);
  });
});

describe("views", () => {
  it("maps a scope to intro, cards, notes and the from-you checklist", () => {
    const v = scopeView("Why twelve.\n\n## Sensor plan\nOne page per machine.\n\n## Alerts\nUnder a minute.\n\n> Not included: ERP.\n\n- Machine list\n- Site access");
    expect(v.intro).toEqual(["Why twelve."]);
    expect(v.items).toEqual([{ title: "Sensor plan", body: ["One page per machine."] }, { title: "Alerts", body: ["Under a minute."] }]);
    expect(v.notes).toEqual(["Not included: ERP."]);
    expect(v.checklist).toEqual(["Machine list", "Site access"]);
  });

  it("maps a timeline to weeks, titles and milestones", () => {
    const t = timelineView("Six weeks.\n\n## Week 1 · Survey and sensor plan\nOne day on site.\n> Milestone 1 · Plan approved\n\n## Weeks 4–5 — Dashboard\nTuning.\n\n## Handover");
    expect(t.intro).toEqual(["Six weeks."]);
    expect(t.steps).toEqual([
      { week: "Week 1", title: "Survey and sensor plan", meta: ["One day on site."], milestone: "Milestone 1 · Plan approved" },
      { week: "Weeks 4–5", title: "Dashboard", meta: ["Tuning."], milestone: null },
      { week: "", title: "Handover", meta: [], milestone: null },
    ]);
  });
});
