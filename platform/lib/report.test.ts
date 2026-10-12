import { describe, expect, it } from "vitest";
import { checkReport, normalise, type ReportContent } from "./report-content";
import { reportToText, textToReport } from "./report-text";
import { monthYear, outline, reportDocument } from "./report-template";

const R2: ReportContent = {
  title: "FabricPort",
  subtitle: "Release 2 — Data Integrity, Imagery & Marketplace Experience",
  prepared_for: "Prepared for the FabricPort team",
  summary: ["Release 1 delivered the platform. This release corrects what the legacy migration got wrong.", "All three are resolved."],
  kpis: [{ value: "0", label: "Ownership errors" }, { value: "80%", label: "Lighter first load" }],
  measures: [{ measure: "Initial download (compressed)", before: "992 KB", after: "192 KB" }],
  sections: [
    { title: "Product Photography", intro: "", callout: { label: "Root cause", text: "The migration read /thumbs/ instead of /originals/." },
      rows: [{ item: "Images restored", outcome: "749 of 1,190 replaced at full resolution", new: false }, { item: "Zoom", outcome: "Hover magnifier | tap to open", new: true }] },
    { title: "Performance", intro: "Every visitor downloaded the whole app.", callout: null, rows: [] },
  ],
  verification: [{ claim: "Image restoration", proof: "Stored dimensions measured before and after" }],
  outstanding: [{ item: "Two fabrics without specifications", action: "The supplier can add them" }],
};

describe("report content", () => {
  it("accepts the R2 report and rejects off-schema content with a path", () => {
    expect(checkReport(R2)).toEqual({ ok: true, content: R2 });
    expect(checkReport({ ...R2, sections: [] })).toEqual({ ok: false, error: "report.sections: needs at least 1" });
    expect(checkReport({ ...R2, notes: "x" })).toMatchObject({ ok: false });
    expect(checkReport({ ...R2, kpis: [{ value: "12345678901234567", label: "x" }] })).toEqual({ ok: false, error: "report.kpis[1].value: is longer than 16 characters" });
    expect(checkReport({ ...R2, extra: 1 })).toEqual({ ok: false, error: "report.extra: is not part of a report" });
    expect(checkReport({ ...R2, sections: [{ ...R2.sections[0], callout: { label: "x" } }] })).toMatchObject({ ok: false });
    expect(normalise(null).sections).toEqual([]);
  });

  it("round-trips through the editor text format", () => {
    const text = reportToText(R2);
    expect(text).toContain("## Section: Product Photography\n! Root cause | The migration read /thumbs/ instead of /originals/.");
    expect(text).toContain("+ Zoom | Hover magnifier | tap to open");
    const back = textToReport(text);
    expect(back).toEqual({ ok: true, content: R2 });
  });

  it("names the line of a mistake", () => {
    expect(textToReport("# T\n\n## Summary\nx\n\n## KPIs\njust a value\n")).toEqual({ ok: false, error: 'line 7: a KPI is "value | label"' });
    expect(textToReport("# T\n## Nonsense\n")).toMatchObject({ ok: false, error: expect.stringContaining("line 2: unknown heading") });
    expect(textToReport("hello\n")).toMatchObject({ ok: false, error: expect.stringContaining("line 1") });
  });
});

describe("report template (R2)", () => {
  it("keeps the R2 skeleton: masthead, contents, numbered sections, verification, outstanding", () => {
    expect(outline(R2)).toEqual(["Executive Summary", "Release at a Glance", "Product Photography", "Performance", "Verification", "Outstanding Items"]);
    const html = reportDocument(R2, { dateLabel: "August 2026" });
    expect(html).toContain('<p class="wordmark">Epsilon Labs</p>');
    expect(html).toContain("<h1 class=\"doc-title\">FabricPort</h1>");
    expect(html).toContain("Prepared for the FabricPort team · August 2026");
    expect(html).toContain('<h1 class="section">1. Executive Summary</h1>');
    expect(html).toContain('<h1 class="section">2. Release at a Glance</h1>');
    expect(html).toContain('<h1 class="section">5. Verification</h1>');
    expect(html).toContain('<h1 class="section">6. Outstanding Items</h1>');
    expect(html).toContain('<div class="kpi"><span class="v">80%</span><span class="k">Lighter first load</span></div>');
    expect(html).toContain('<td class="num">992 KB</td><td class="num">192 KB</td>');
    expect(html).toContain('<span class="label">Root cause</span>');
    expect(html).toContain('Zoom <span class="tag tag-new">New</span>');
    expect(html).toContain('<tr><th>Claim</th><th>How it was proven</th></tr>');
    expect(html).toContain("Epsilon Labs · FabricPort Release 2 · August 2026");
    expect(html).toContain("@page { size: A4; margin: 22mm 20mm; }");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("draft-banner\">");
  });

  it("escapes everything and skips empty parts", () => {
    const html = reportDocument(
      { ...R2, title: "<img src=x onerror=alert(1)>", kpis: [], measures: [], verification: [], outstanding: [], prepared_for: undefined },
      { dateLabel: "Oct 2026", orgName: "A & B", draft: true },
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("Prepared for the A &amp; B team");
    expect(html).not.toContain("at a Glance");
    expect(html).not.toContain("Verification</h1>");
    expect(html).toContain("Draft · not yet published");
    expect(monthYear("2026-08-21T10:00:00Z")).toBe("August 2026");
  });
});
