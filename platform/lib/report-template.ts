// The delivery report document: the R2 layout (~/Desktop/FP&LM/fabricport-delivery-report-r2.html, FabricPort
// Release 2) with its CSS copied verbatim, filled from the report content. One template for the admin preview, the
// client's web view and the stored PDF (F15). Pure; every value is escaped (the content is AI-drafted, founder-edited).
import { esc } from "./html";
import type { ReportContent } from "./report-content";

export type ReportMeta = {
  /** "Prepared for the … team" when the content has none. */
  orgName?: string;
  /** "August 2026": the month the report was approved (or today, for a draft preview). */
  dateLabel: string;
  /** Shows a draft banner (admin preview only; never in a stored PDF). */
  draft?: boolean;
};

// R2's stylesheet, verbatim, except: "Open Sans" appended to the font stacks (the face headless Chromium has on
// Vercel, as in the invoice sheet), and a .draft-banner rule for the admin preview.
export const REPORT_CSS = `
  @page { size: A4; margin: 22mm 20mm; }
  :root { --ink: #111111; --muted: #5a5a5a; --rule: #d8d8d8; --soft: #f4f2ee; --accent: #8a1c1c; }
  * { box-sizing: border-box; }
  body {
    font-family: "Times New Roman", Times, "Open Sans", serif;
    font-size: 12.5pt; line-height: 1.55; color: var(--ink); background: #ffffff;
    margin: 0; padding: 0 28px 64px; max-width: 900px; margin-inline: auto; -webkit-font-smoothing: antialiased;
  }
  .masthead { text-align: center; padding: 56px 0 22px; }
  .logo { display: block; margin: 0 auto 14px; }
  .wordmark { font-size: 12pt; letter-spacing: 0.42em; text-transform: uppercase; color: var(--ink); margin: 0 0 4px; padding-left: 0.42em; text-align: center; }
  .tagline { font-size: 9.5pt; letter-spacing: 0.24em; text-transform: uppercase; color: var(--muted); margin: 0; padding-left: 0.24em; text-align: center; }
  .doc-title { text-align: center; font-size: 25pt; font-weight: normal; margin: 40px 0 6px; letter-spacing: 0.01em; }
  .doc-sub { text-align: center; font-size: 13pt; color: var(--muted); margin: 0 0 6px; font-style: italic; }
  .doc-meta { text-align: center; font-size: 10.5pt; color: var(--muted); margin: 0 0 34px; }
  .divider { border: 0; border-top: 1px solid var(--rule); margin: 30px 0; }
  .divider-thin { border: 0; border-top: 1px solid var(--rule); margin: 18px 0; }
  h1.section { text-align: center; font-size: 17pt; font-weight: bold; margin: 46px 0 6px; letter-spacing: 0.02em; }
  h1.section + .section-rule { width: 68px; border: 0; border-top: 2px solid var(--ink); margin: 0 auto 24px; }
  h2 { text-align: center; font-size: 14.5pt; font-weight: bold; margin: 32px 0 14px; }
  h3 { font-size: 13pt; font-weight: bold; margin: 22px 0 8px; text-align: left; }
  h4 { font-size: 12.5pt; font-weight: bold; margin: 16px 0 6px; font-style: italic; }
  p { margin: 0 0 11px; text-align: justify; }
  ul, ol { margin: 0 0 12px; padding-left: 22px; }
  li { margin-bottom: 5px; }
  code, .mono { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 10pt; background: var(--soft); padding: 1px 5px; border-radius: 3px; }
  table { width: 100%; border-collapse: collapse; margin: 14px 0 20px; font-size: 11.5pt; }
  th { text-align: left; border-bottom: 1.5px solid var(--ink); padding: 7px 9px; font-weight: bold; vertical-align: bottom; }
  td { border-bottom: 1px solid var(--rule); padding: 7px 9px; vertical-align: top; }
  tr:last-child td { border-bottom: 1px solid var(--rule); }
  td.num, th.num { text-align: right; white-space: nowrap; }
  .callout { background: var(--soft); border-left: 3px solid var(--ink); padding: 13px 17px; margin: 18px 0; font-size: 11.5pt; }
  .callout p:last-child { margin-bottom: 0; }
  .callout .label { display: block; font-size: 9.5pt; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); margin-bottom: 5px; }
  .kpi-row { display: flex; gap: 14px; margin: 20px 0 24px; flex-wrap: wrap; }
  .kpi { flex: 1 1 128px; border: 1px solid var(--rule); padding: 13px 12px; text-align: center; }
  .kpi .v { display: block; font-size: 21pt; line-height: 1.1; }
  .kpi .k { display: block; font-size: 9pt; letter-spacing: 0.13em; text-transform: uppercase; color: var(--muted); margin-top: 5px; }
  .toc { margin: 0 auto 10px; max-width: 560px; }
  .toc ol { padding-left: 26px; }
  .toc li { margin-bottom: 6px; }
  .page-break { page-break-before: always; }
  .footer-note { text-align: center; font-size: 10pt; color: var(--muted); border-top: 1px solid var(--rule); padding-top: 16px; margin-top: 50px; }
  .tag { display: inline-block; font-size: 9pt; letter-spacing: 0.1em; text-transform: uppercase; border: 1px solid var(--rule); padding: 1px 6px; color: var(--muted); margin-left: 6px; }
  .tag-new { border-color: var(--ink); color: var(--ink); }
  .draft-banner { margin: 18px 0 0; padding: 8px 12px; border: 1px dashed var(--accent); color: var(--accent); text-align: center; font-size: 10pt; letter-spacing: 0.12em; text-transform: uppercase; }
`;

/** Section headings in document order, as the Contents list shows them. */
export function outline(c: ReportContent): string[] {
  const out = ["Executive Summary"];
  if (c.kpis.length || c.measures.length) out.push(/^release\b/i.test(c.subtitle) ? "Release at a Glance" : "At a Glance");
  out.push(...c.sections.map((s) => s.title));
  if (c.verification.length) out.push("Verification");
  if (c.outstanding.length) out.push("Outstanding Items");
  return out;
}

function heading(n: number, title: string): string {
  return `<h1 class="section">${n}. ${esc(title)}</h1>\n<hr class="section-rule">\n`;
}

function twoCol(head: [string, string], rows: [string, string, boolean?][]): string {
  return (
    `<table>\n  <tr><th>${esc(head[0])}</th><th>${esc(head[1])}</th></tr>\n` +
    rows.map(([a, b, isNew]) => `  <tr><td>${esc(a)}${isNew ? ' <span class="tag tag-new">New</span>' : ""}</td><td>${esc(b)}</td></tr>`).join("\n") +
    `\n</table>\n`
  );
}

export function reportBody(c: ReportContent, meta: ReportMeta): string {
  const titles = outline(c);
  const prepared = c.prepared_for || (meta.orgName ? `Prepared for the ${meta.orgName} team` : "");
  let n = 0;
  let html =
    `<div class="masthead">\n  <svg class="logo" width="46" height="52" viewBox="0 0 46 52" aria-label="Epsilon Labs">\n` +
    `    <text x="23" y="40" text-anchor="middle" font-family="Times New Roman, Times, serif" font-size="46" fill="#111111">&#949;</text>\n  </svg>\n` +
    `  <p class="wordmark">Epsilon Labs</p>\n  <p class="tagline">AI Solutions</p>\n</div>\n` +
    (meta.draft ? `<div class="draft-banner">Draft · not yet published</div>\n` : "") +
    `<hr class="divider">\n` +
    `<h1 class="doc-title">${esc(c.title)}</h1>\n` +
    (c.subtitle ? `<p class="doc-sub">${esc(c.subtitle)}</p>\n` : "") +
    `<p class="doc-meta">${esc([prepared, meta.dateLabel].filter(Boolean).join(" · "))}</p>\n` +
    `<div class="toc">\n  <h2>Contents</h2>\n  <ol>\n${titles.map((t) => `    <li>${esc(t)}</li>`).join("\n")}\n  </ol>\n</div>\n` +
    `<hr class="divider">\n`;

  html += heading(++n, titles[0]) + c.summary.map((p) => `<p>${esc(p)}</p>`).join("\n") + "\n";

  if (c.kpis.length || c.measures.length) {
    html += heading(++n, titles[1]);
    if (c.kpis.length)
      html += `<div class="kpi-row">\n${c.kpis.map((k) => `  <div class="kpi"><span class="v">${esc(k.value)}</span><span class="k">${esc(k.label)}</span></div>`).join("\n")}\n</div>\n`;
    if (c.measures.length)
      html +=
        `<table>\n  <tr><th>Measure</th><th class="num">Before</th><th class="num">After</th></tr>\n` +
        c.measures.map((m) => `  <tr><td>${esc(m.measure)}</td><td class="num">${esc(m.before)}</td><td class="num">${esc(m.after)}</td></tr>`).join("\n") +
        `\n</table>\n`;
  }

  for (const s of c.sections) {
    html += heading(++n, s.title);
    if (s.callout) html += `<div class="callout">\n  <span class="label">${esc(s.callout.label)}</span>\n  <p>${esc(s.callout.text)}</p>\n</div>\n`;
    if (s.intro) html += `<p>${esc(s.intro)}</p>\n`;
    if (s.rows.length) html += twoCol(["Item", "Outcome"], s.rows.map((r) => [r.item, r.outcome, r.new]));
  }
  if (c.verification.length) html += heading(++n, "Verification") + twoCol(["Claim", "How it was proven"], c.verification.map((v) => [v.claim, v.proof]));
  if (c.outstanding.length) html += heading(++n, "Outstanding Items") + twoCol(["Item", "Action required"], c.outstanding.map((o) => [o.item, o.action]));

  html += `<p class="footer-note">${esc(["Epsilon Labs", [c.title, c.subtitle.split(/\s+[—–-]\s+/)[0]].filter(Boolean).join(" "), meta.dateLabel].filter(Boolean).join(" · "))}</p>\n`;
  return html;
}

/** A complete, self-contained HTML document (no scripts, no external requests): the PDF is printed from it. */
export function reportDocument(c: ReportContent, meta: ReportMeta): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${esc(c.title)} — Delivery Report</title><style>${REPORT_CSS}</style></head><body>\n${reportBody(c, meta)}</body></html>`;
}

/** "August 2026" in PKT. */
export function monthYear(at: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "Asia/Karachi" }).format(new Date(at));
}
