// Parsing for the admin invoice and credit-note forms (012). Pure (unit-tested). The database checks everything again
// (invoice_lines_subtotal, invoice_total); this gives the founder a clear message before the round trip.
import { toCents } from "./money";

export type Line = { title: string; desc: string; amount: string };

/** One line per row: "Title | description | 1200.00" (description optional: "Title | 1200"). */
export function parseLines(text: string): { ok: true; lines: Line[] } | { ok: false; error: string } {
  const rows = String(text ?? "").split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  if (!rows.length) return { ok: false, error: "Add at least one line: Title | description | amount." };
  if (rows.length > 30) return { ok: false, error: "At most 30 lines." };
  const lines: Line[] = [];
  for (let i = 0; i < rows.length; i++) {
    const parts = rows[i].split("|").map((p) => p.trim());
    const raw = parts[parts.length - 1].replace(/[,\s]/g, "");
    if (parts.length < 2 || !/^\d{1,10}(\.\d{1,2})?$/.test(raw) || Number(raw) <= 0) {
      return { ok: false, error: `Line ${i + 1}: end it with an amount above zero, e.g. "Milestone 2 | 4000.00".` };
    }
    const title = parts[0];
    if (!title || title.length > 200) return { ok: false, error: `Line ${i + 1}: the title is 1-200 characters.` };
    const desc = parts.slice(1, -1).join(" | ");
    if (desc.length > 1000) return { ok: false, error: `Line ${i + 1}: the description is at most 1000 characters.` };
    lines.push({ title, desc, amount: (toCents(raw) / 100).toFixed(2) });
  }
  return { ok: true, lines };
}

export function linesToText(lines: { title: string; desc?: string; amount: number | string }[]): string {
  return lines.map((l) => [l.title, l.desc ?? "", Number(l.amount).toFixed(2)].filter((x, i) => i !== 1 || x).join(" | ")).join("\n");
}

/** Subtotal, tax and total in cents (round half away from zero, as invoice_total() in 012). */
export function totals(lines: Line[], taxRate: number): { subtotal: number; tax: number; total: number } {
  const sub = lines.reduce((s, l) => s + toCents(l.amount), 0);
  const tax = taxRate > 0 ? Math.round((sub * taxRate) / 100) : 0;
  return { subtotal: sub / 100, tax: tax / 100, total: (sub + tax) / 100 };
}
