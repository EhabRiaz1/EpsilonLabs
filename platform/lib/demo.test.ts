import { describe, expect, it } from "vitest";
import { demoPdfResponse, isDemoOnly } from "./demo";

describe("demo portal", () => {
  it("treats a user as the demo login only when every org is a demo org", () => {
    expect(isDemoOnly([{ isDemo: true }])).toBe(true);
    expect(isDemoOnly([{ isDemo: true }, { isDemo: false }])).toBe(false);
    expect(isDemoOnly([])).toBe(false);
  });

  it("answers PDF downloads with a labelled page and a safe link back", async () => {
    const r = demoPdfResponse('/invoices/abc"><script>');
    expect(r.status).toBe(403);
    const html = await r.text();
    expect(html).toContain("DEMO · SAMPLE DATA");
    expect(html).toContain('href="/invoices/abcscript"');
    expect(html).not.toContain("<script>");
  });
});
