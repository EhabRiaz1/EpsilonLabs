import { describe, expect, it } from "vitest";
import { dayLabels, hasSignal, lastDays, perDay, weekDelta } from "./series";

const now = new Date("2026-10-15T10:00:00+05:00");

describe("lastDays", () => {
  it("ends today in PKT, oldest first", () => {
    const d = lastDays(now, 14);
    expect(d).toHaveLength(14);
    expect(d[13]).toBe("2026-10-15");
    expect(d[0]).toBe("2026-10-02");
  });
  it("uses the PKT day, not UTC (20:30 UTC is already the next day in Lahore)", () => {
    expect(lastDays(new Date("2026-10-14T20:30:00Z"), 1)).toEqual(["2026-10-15"]);
  });
});

describe("perDay", () => {
  const days = lastDays(now, 3); // 13, 14, 15 Oct
  it("counts stamps per PKT day and ignores nulls, bad dates and days outside", () => {
    expect(
      perDay(
        ["2026-10-13T08:00:00+05:00", "2026-10-15T01:00:00+05:00", "2026-10-14T19:30:00Z", null, undefined, "nope", "2026-09-01T00:00:00Z"],
        days,
      ),
    ).toEqual([1, 0, 2]);
  });
  it("is all zeros for no data", () => {
    expect(perDay([], days)).toEqual([0, 0, 0]);
  });
});

describe("hasSignal (D10)", () => {
  it("needs three non-zero points", () => {
    expect(hasSignal([0, 0, 0, 5, 0, 1])).toBe(false);
    expect(hasSignal([0, 2, 0, 5, 0, 1])).toBe(true);
    expect(hasSignal(null)).toBe(false);
  });
});

describe("dayLabels", () => {
  it("labels the first day, the middle one and Today", () => {
    const l = dayLabels(lastDays(now, 14));
    expect(l[0]).toBe("2 Oct");
    expect(l[7]).toBe("9 Oct");
    expect(l[13]).toBe("Today");
    expect(l.filter(Boolean)).toHaveLength(3);
  });
});

describe("weekDelta", () => {
  it("compares the last 7 days with the 7 before", () => {
    expect(weekDelta([1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2])).toEqual({ text: "+7 vs last week", dir: "up" });
    expect(weekDelta([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toEqual({ text: "−1 vs last week", dir: "down" });
    expect(weekDelta([0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1])).toEqual({ text: "same as last week", dir: "flat" });
  });
  it("says nothing for an empty or short series", () => {
    expect(weekDelta(Array(14).fill(0))).toBeNull();
    expect(weekDelta([1, 2])).toBeNull();
  });
});
