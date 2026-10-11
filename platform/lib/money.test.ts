import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULE, formatMoney, plainAmount, scheduleAmounts, scheduleError, splitMoney, toCents } from "./money";

describe("splitMoney", () => {
  it("splits whole and greyed decimals with the currency symbol", () => {
    expect(splitMoney(7200)).toEqual({ whole: "$7,200", dec: ".00" });
    expect(splitMoney("18000.5")).toEqual({ whole: "$18,000", dec: ".50" });
    expect(splitMoney(0.07, "EUR")).toEqual({ whole: "€0", dec: ".07" });
    expect(splitMoney(1234567.891, "PKR")).toEqual({ whole: "PKR 1,234,567", dec: ".89" });
    expect(splitMoney(-12.3, "GBP")).toEqual({ whole: "-£12", dec: ".30" });
  });

  it("formats without float noise", () => {
    expect(formatMoney(0.1 + 0.2)).toBe("$0.30");
    expect(plainAmount(200000)).toBe("200,000.00");
    expect(toCents("19.999")).toBe(2000);
    expect(() => toCents("abc")).toThrow();
  });
});

describe("schedule", () => {
  it("accepts the default 40/40/20 and explains bad ones", () => {
    expect(scheduleError(DEFAULT_SCHEDULE)).toBeNull();
    expect(scheduleError([{ label: "a", pct: 50 }, { label: "b", pct: 40 }])).toMatch(/90, not 100/);
    expect(scheduleError([{ label: " ", pct: 100 }])).toMatch(/label/);
    expect(scheduleError([{ label: "a", pct: 99.5 }, { label: "b", pct: 0.5 }])).toMatch(/whole numbers/);
    expect(scheduleError([])).toMatch(/1 to 6/);
  });

  it("splits a total into stages that always add back up", () => {
    expect(scheduleAmounts(18000, DEFAULT_SCHEDULE)).toEqual([7200, 7200, 3600]);
    const odd = scheduleAmounts(1000.01, DEFAULT_SCHEDULE);
    expect(odd).toEqual([400, 400, 200.01]);
    const thirds = scheduleAmounts(100, [{ label: "a", pct: 33 }, { label: "b", pct: 33 }, { label: "c", pct: 34 }]);
    expect(thirds.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10);
    // first stage matches the database's round(total * pct / 100, 2), half away from zero
    expect(scheduleAmounts(0.05, [{ label: "a", pct: 50 }, { label: "b", pct: 50 }])).toEqual([0.03, 0.02]);
    expect(() => scheduleAmounts(10, [{ label: "a", pct: 10 }])).toThrow();
  });
});
