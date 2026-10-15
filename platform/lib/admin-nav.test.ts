import { describe, expect, it } from "vitest";
import { ADMIN_NAV, ADMIN_PAGES } from "./admin-nav";

const BEFORE = ["/", "/approvals", "/intake", "/pipeline", "/opportunities", "/clients", "/tickets", "/updates", "/proposals",
  "/invoices", "/reports", "/testimonials", "/analytics", "/agents", "/health", "/settings", "/terms"];

describe("admin nav groups", () => {
  it("keeps every page from the flat sidebar, once", () => {
    const hrefs = ADMIN_PAGES.map((p) => p.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect([...hrefs].sort()).toEqual([...BEFORE].sort());
  });
  it("keeps the G-then-letter shortcuts unique", () => {
    const seqs = ADMIN_PAGES.map((p) => p.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs.every((s) => /^g [a-z]$/.test(s))).toBe(true);
  });
  it("puts Today and Approvals on top and starts System collapsed", () => {
    expect(ADMIN_NAV[0].pages.map((p) => p.href)).toEqual(["/", "/approvals"]);
    expect(ADMIN_NAV.find((g) => g.key === "system")?.collapsed).toBe(true);
  });
});
