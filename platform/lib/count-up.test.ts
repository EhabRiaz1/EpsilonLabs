import { describe, expect, it } from "vitest";
import { countAt, formatCount } from "./count-up";

describe("formatCount", () => {
  it("groups thousands and rounds", () => {
    expect(formatCount(1234.5)).toBe("1,235");
    expect(formatCount(0)).toBe("0");
  });
  it("adds prefix, suffix and decimals", () => {
    expect(formatCount(18400, { prefix: "$" })).toBe("$18,400");
    expect(formatCount(4.4, { decimals: 1, suffix: "%" })).toBe("4.4%");
    expect(formatCount(-12, { prefix: "$" })).toBe("−$12");
  });
});

describe("countAt", () => {
  it("starts at from and ends exactly at to", () => {
    expect(countAt(0, 5, 0, 700)).toBe(0);
    expect(countAt(0, 5, 700, 700)).toBe(5);
    expect(countAt(0, 5, 9999, 700)).toBe(5);
  });
  it("eases out (past half way at half time)", () => {
    expect(countAt(0, 100, 350, 700)).toBeGreaterThan(50);
  });
  it("jumps straight to the value with no duration (reduced motion)", () => {
    expect(countAt(0, 7, 0, 0)).toBe(7);
  });
});
