// The admin editor's text format for a delivery report: one plain-text document that maps 1:1 to the content schema
// (epsilon-os/skills/delivery-report/SKILL.md "Editing by hand"). Pure; reportToText(textToReport(x)) round-trips.
//
//   # Title                       > Subtitle                    @ Prepared for the … team
//   ## Summary                    paragraphs, separated by a blank line
//   ## KPIs                       value | label
//   ## Measures                   measure | before | after
//   ## Section: <title>           intro lines; "! Label | text" = callout; "item | outcome" rows; "+ item | outcome" = New
//   ## Verification               claim | proof
//   ## Outstanding                item | action
import type { ReportContent, Section } from "./report-content";

const one = (s: string) => s.replace(/\s+/g, " ").trim();

export function reportToText(c: ReportContent): string {
  const out: string[] = [`# ${one(c.title)}`];
  if (c.subtitle) out.push(`> ${one(c.subtitle)}`);
  if (c.prepared_for) out.push(`@ ${one(c.prepared_for)}`);
  out.push("", "## Summary", c.summary.map(one).join("\n\n"));
  if (c.kpis.length) out.push("", "## KPIs", ...c.kpis.map((k) => `${one(k.value)} | ${one(k.label)}`));
  if (c.measures.length) out.push("", "## Measures", ...c.measures.map((m) => `${one(m.measure)} | ${one(m.before)} | ${one(m.after)}`));
  for (const s of c.sections) {
    out.push("", `## Section: ${one(s.title)}`);
    if (s.intro) out.push(one(s.intro));
    if (s.callout) out.push(`! ${one(s.callout.label)} | ${one(s.callout.text)}`);
    out.push(...s.rows.map((r) => `${r.new ? "+ " : ""}${one(r.item)} | ${one(r.outcome)}`));
  }
  if (c.verification.length) out.push("", "## Verification", ...c.verification.map((v) => `${one(v.claim)} | ${one(v.proof)}`));
  if (c.outstanding.length) out.push("", "## Outstanding", ...c.outstanding.map((o) => `${one(o.item)} | ${one(o.action)}`));
  return out.join("\n") + "\n";
}

function split2(line: string): [string, string] {
  const i = line.indexOf("|");
  return i < 0 ? [one(line), ""] : [one(line.slice(0, i)), one(line.slice(i + 1))];
}

/** Parses the editor text. Errors name the line, so the founder can fix it. Validation of lengths is checkReport's job. */
export function textToReport(text: string): { ok: true; content: ReportContent } | { ok: false; error: string } {
  const c: ReportContent = { title: "", subtitle: "", summary: [], kpis: [], measures: [], sections: [], verification: [], outstanding: [] };
  let block: "head" | "summary" | "kpis" | "measures" | "section" | "verification" | "outstanding" = "head";
  let sec: Section | null = null;
  let para: string[] = [];
  const flush = () => {
    if (para.length) c.summary.push(one(para.join(" ")));
    para = [];
  };
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n];
    const line = raw.trim();
    const where = `line ${n + 1}`;
    if (line.startsWith("## ")) {
      flush();
      const h = line.slice(3).trim();
      const m = /^section:\s*(.+)$/i.exec(h);
      if (m) {
        sec = { title: one(m[1]), intro: "", callout: null, rows: [] };
        c.sections.push(sec);
        block = "section";
      } else {
        const key = h.toLowerCase();
        if (key === "summary" || key === "executive summary") block = "summary";
        else if (key === "kpis" || key === "at a glance") block = "kpis";
        else if (key === "measures") block = "measures";
        else if (key === "verification") block = "verification";
        else if (key === "outstanding" || key === "outstanding items") block = "outstanding";
        else return { ok: false, error: `${where}: unknown heading "## ${h}" (use Summary, KPIs, Measures, Section: <title>, Verification or Outstanding)` };
        sec = null;
      }
      continue;
    }
    if (block === "head") {
      if (!line) continue;
      if (line.startsWith("# ")) c.title = one(line.slice(2));
      else if (line.startsWith("> ")) c.subtitle = one(line.slice(2));
      else if (line.startsWith("@ ")) c.prepared_for = one(line.slice(2));
      else return { ok: false, error: `${where}: before the first "##" only "# Title", "> Subtitle" and "@ Prepared for" are allowed` };
      continue;
    }
    if (block === "summary") {
      if (!line) flush();
      else para.push(line);
      continue;
    }
    if (!line) continue;
    if (block === "kpis") {
      const [value, label] = split2(line);
      if (!value || !label) return { ok: false, error: `${where}: a KPI is "value | label"` };
      c.kpis.push({ value, label });
    } else if (block === "measures") {
      const parts = line.split("|").map(one);
      if (parts.length < 3 || !parts[0]) return { ok: false, error: `${where}: a measure is "measure | before | after"` };
      c.measures.push({ measure: parts[0], before: parts[1], after: parts.slice(2).join(" | ") });
    } else if (block === "verification") {
      const [claim, proof] = split2(line);
      if (!claim || !proof) return { ok: false, error: `${where}: a verification row is "claim | how it was proven"` };
      c.verification.push({ claim, proof });
    } else if (block === "outstanding") {
      const [item, action] = split2(line);
      if (!item || !action) return { ok: false, error: `${where}: an outstanding row is "item | action required"` };
      c.outstanding.push({ item, action });
    } else if (block === "section" && sec) {
      if (line.startsWith("! ")) {
        const [label, t] = split2(line.slice(2));
        if (!label || !t) return { ok: false, error: `${where}: a callout is "! Label | text"` };
        sec.callout = { label, text: t };
      } else if (line.startsWith("+ ") || line.includes("|")) {
        const isNew = line.startsWith("+ ");
        const [item, outcome] = split2(isNew ? line.slice(2) : line);
        if (!item) return { ok: false, error: `${where}: a row is "item | outcome"` };
        sec.rows.push({ item, outcome, new: isNew });
      } else {
        sec.intro = one(`${sec.intro} ${line}`);
      }
    }
  }
  flush();
  return { ok: true, content: c };
}
