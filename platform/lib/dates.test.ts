import { describe, expect, it } from "vitest";
import { dayMonth, dayMonthYear, daysUntil, stamp } from "./dates";

describe("deal room dates", () => {
  it("formats calendar dates without shifting the day", () => {
    expect(dayMonth("2026-10-25")).toBe("25 Oct");
    expect(dayMonthYear("2026-10-25", "America/Los_Angeles")).toBe("25 Oct 2026");
    expect(stamp("2026-10-11T09:32:00Z")).toBe("11 Oct 2026, 14:32 PKT");
  });

  it("counts days left in Pakistan time", () => {
    expect(daysUntil("2026-10-25", new Date("2026-10-11T09:00:00Z"))).toBe(14);
    expect(daysUntil("2026-10-11", new Date("2026-10-11T20:00:00Z"))).toBe(-1); // already 12 Oct in PKT
  });
});
