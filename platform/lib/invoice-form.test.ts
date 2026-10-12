import { describe, expect, it } from "vitest";
import { linesToText, parseLines, totals } from "./invoice-form";

describe("invoice form", () => {
  it("parses lines with and without a description", () => {
    expect(parseLines("Retainer October | 20 h | 1,000\nHosting | 33.33")).toEqual({
      ok: true,
      lines: [{ title: "Retainer October", desc: "20 h", amount: "1000.00" }, { title: "Hosting", desc: "", amount: "33.33" }],
    });
    expect(parseLines("")).toMatchObject({ ok: false });
    expect(parseLines("Just a title")).toMatchObject({ ok: false, error: expect.stringContaining("Line 1") });
    expect(parseLines("x | 0")).toMatchObject({ ok: false });
    expect(parseLines("x | 1.005")).toMatchObject({ ok: false });
  });

  it("computes totals like the database (tax rounded half away from zero)", () => {
    const p = parseLines("A | 1000\nB | 33.33");
    if (!p.ok) throw new Error(p.error);
    expect(totals(p.lines, 16)).toEqual({ subtotal: 1033.33, tax: 165.33, total: 1198.66 });
    expect(totals(p.lines, 0)).toEqual({ subtotal: 1033.33, tax: 0, total: 1033.33 });
  });

  it("round-trips stored lines to the form", () => {
    const text = linesToText([{ title: "Deposit", desc: "40%", amount: 400 }, { title: "Hosting", amount: "33.3" }]);
    expect(text).toBe("Deposit | 40% | 400.00\nHosting | 33.30");
    expect(parseLines(text)).toMatchObject({ ok: true });
  });
});
