import { describe, expect, it } from "vitest";
import { hm, parseMinutes, TIERS, upsell, usageLine } from "./retainers";

describe("retainers", () => {
  it("has the 10/20/40 h tiers", () => {
    expect(TIERS.filter((t) => t.hours).map((t) => [t.id, t.hours])).toEqual([["r10", 10], ["r20", 20], ["r40", 40]]);
  });

  it("flags an upsell for >85% in 2 of the last 3 periods only", () => {
    expect(upsell([{ pct: 90 }, { pct: 86 }, { pct: 50 }])).toBe(true);
    expect(upsell([{ pct: 90 }, { pct: 85 }, { pct: 50 }])).toBe(false);          // 85 exactly is not above
    expect(upsell([{ pct: 10 }, { pct: 99 }, { pct: 99 }, { pct: 99 }])).toBe(true);
    expect(upsell([{ pct: 99 }, { pct: 10 }, { pct: 10 }, { pct: 99 }])).toBe(false); // only the last three count
    expect(upsell([{ pct: 120 }])).toBe(false);
  });

  it("formats usage, left and over", () => {
    expect(usageLine({ used_minutes: 540, included_minutes: 600 })).toEqual({ pct: 90, left: "1h left", over: false });
    expect(usageLine({ used_minutes: 516, included_minutes: 600 })).toEqual({ pct: 86, left: "1h 24m left", over: false });
    expect(usageLine({ used_minutes: 700, included_minutes: 600 })).toEqual({ pct: 116.7, left: "1h 40m over", over: true });
    expect(usageLine({ used_minutes: 0, included_minutes: 0 }).pct).toBe(0);
    expect(hm(45)).toBe("45m");
    expect(hm(0)).toBe("0h");
    expect(hm(125)).toBe("2h 05m");
  });

  it("parses time entries", () => {
    expect(parseMinutes("1h 30m")).toBe(90);
    expect(parseMinutes("1h30")).toBe(90);
    expect(parseMinutes("2h")).toBe(120);
    expect(parseMinutes("1.5h")).toBe(90);
    expect(parseMinutes("45")).toBe(45);
    expect(parseMinutes("45m")).toBe(45);
    expect(parseMinutes("0")).toBeNull();
    expect(parseMinutes("25h")).toBeNull();
    expect(parseMinutes("abc")).toBeNull();
  });
});
