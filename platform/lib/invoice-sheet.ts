// The invoice paper: a port of epsilon-invoice (lib/types.ts Invoice, components/InvoiceSheet.tsx, app/sheet.css).
// Rendered to one self-contained HTML document, used both for the admin/client HTML view (in an iframe, so the
// app's design system can't bleed in) and for the stored PDF (F15). Pure; every value is escaped.
import { esc } from "./html";
import { plainAmount, toCents } from "./money";

export type Item = { id: string; title: string; desc: string; amount: string };
export type PayRow = { id: string; label: string; value: string };

export type Invoice = {
  kind: "invoice" | "credit_note";
  number: string;
  issueDate: string; // ISO yyyy-mm-dd
  dueDate: string;
  terms: string;
  currency: string;
  mark: string;
  company: string;
  companySuffix: string;
  address: string; // newline separated
  email: string;
  regLine: string;
  billCompany: string;
  billContact: string;
  showProject: boolean;
  projectLabel: string;
  items: Item[];
  showSubtotal: boolean;
  taxLabel: string;
  taxRate: string;
  showNote: boolean;
  note: string;
  showPayment: boolean;
  payHint: string;
  payRows: PayRow[];
  bankName: string;
  bankAddress: string;
  showFooter: boolean;
  footerText: string;
};

/** Issuer and payment details (server env INVOICE_DETAILS_JSON). */
export type IssuerDetails = {
  address: string;
  email: string;
  regLine: string;
  payHint: string;
  payRows: { label: string; value: string }[];
  bankName: string;
  bankAddress: string;
  footerText: string;
};

/** An invoices row as selected from the database. */
export type InvoiceRow = {
  id: string;
  number: string | null;
  kind: "invoice" | "credit_note";
  bill_company: string;
  bill_contact: string;
  project_label: string;
  lines: { title: string; desc?: string; amount: number | string }[];
  tax_label: string | null;
  tax_rate: number | string;
  currency: string;
  total: number | string;
  due_date: string | null;
  issued_at: string | null;
  status: string;
};

const TZ = "Asia/Karachi";

export function isoDate(at: string | Date, timeZone = TZ): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(new Date(at));
}

/** ISO yyyy-mm-dd -> dd/mm/yyyy, matching the printed invoice. */
export function formatDate(iso: string): string {
  const [y, m, d] = (iso ?? "").split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso ?? "";
}

function parseAmount(raw: string): number {
  const n = parseFloat(String(raw).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function computeTotals(inv: Pick<Invoice, "items" | "taxRate">) {
  const subtotalC = inv.items.reduce((sum, i) => sum + toCents(parseAmount(i.amount)), 0);
  const rate = parseAmount(inv.taxRate);
  const taxC = rate > 0 ? Math.round((subtotalC * rate) / 100) : 0;
  return { subtotal: subtotalC / 100, tax: taxC / 100, rate, total: (subtotalC + taxC) / 100 };
}

export function toInvoice(row: InvoiceRow, issuer: IssuerDetails): Invoice {
  const issueDate = row.issued_at ? isoDate(row.issued_at) : isoDate(new Date());
  const days = row.due_date ? Math.round((Date.parse(row.due_date) - Date.parse(issueDate)) / 86400000) : 0;
  const rate = Number(row.tax_rate) || 0;
  return {
    kind: row.kind,
    number: row.number ?? "Draft",
    issueDate,
    dueDate: row.due_date ?? "",
    terms: days > 0 ? `Net ${days}` : "Due on receipt",
    currency: row.currency,
    mark: "ε",
    company: "Epsilon Labs AI Solutions",
    companySuffix: "(SMC-PVT) Ltd.",
    address: issuer.address,
    email: issuer.email,
    regLine: issuer.regLine,
    billCompany: row.bill_company,
    billContact: row.bill_contact,
    showProject: Boolean(row.project_label),
    projectLabel: row.project_label,
    items: (row.lines ?? []).map((l, i) => ({ id: String(i), title: l.title, desc: l.desc ?? "", amount: String(l.amount) })),
    showSubtotal: rate > 0,
    taxLabel: row.tax_label ?? "",
    taxRate: rate > 0 ? String(rate) : "",
    showNote: true,
    note: "Thank you for your business. We look forward to working with you.",
    showPayment: issuer.payRows.length > 0 || Boolean(issuer.bankName),
    payHint: issuer.payHint,
    payRows: issuer.payRows.map((r, i) => ({ id: String(i), label: r.label, value: r.value })),
    bankName: issuer.bankName,
    bankAddress: issuer.bankAddress,
    showFooter: true,
    footerText: issuer.footerText,
  };
}

function lines(text: string): string[] {
  return (text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
}

export function invoiceSheetHtml(inv: Invoice): string {
  const { subtotal, tax, rate, total } = computeTotals(inv);
  const div = (cls: string, body: string) => `<div class="${cls}">${body}</div>`;
  const addr = [...lines(inv.address), inv.email, inv.regLine].filter(Boolean).map((l) => `<div>${esc(l)}</div>`).join("");
  const kv = (k: string, v: string) => (v ? `<div class="kv"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>` : "");
  const rows = inv.items
    .map(
      (it) =>
        `<tr><td><div class="item">${esc(it.title)}</div>${it.desc ? `<div class="desc">${esc(it.desc)}</div>` : ""}</td>` +
        `<td class="r"><span class="amt">${esc(plainAmount(parseAmount(it.amount)))}</span></td></tr>`,
    )
    .join("");
  const pay = inv.showPayment
    ? `<div class="pay"><div class="rule" style="background:#e8e8ed;margin-bottom:14px"></div>` +
      `<div class="hd"><div class="lbl">Payment details</div>${inv.payHint ? `<div class="hint">${esc(inv.payHint)}</div>` : ""}</div>` +
      `<div class="paygrid"><div class="paycol">${inv.payRows
        .map((r) => `<div class="prow"><span class="k">${esc(r.label)}</span><span class="v">${esc(r.value)}</span></div>`)
        .join("")}</div>` +
      `<div class="paycol bank">${inv.bankName ? `<strong>${esc(inv.bankName)}</strong>` : ""}${lines(inv.bankAddress)
        .map((l) => `<div>${esc(l)}</div>`)
        .join("")}</div></div></div>`
    : "";
  return (
    `<div class="sheet">` +
    `<div class="head"><div class="brand"><span class="mark">${esc(inv.mark)}</span>` +
    `<div class="co">${esc(inv.company)} ${inv.companySuffix ? `<span>${esc(inv.companySuffix)}</span>` : ""}</div>` +
    `<div class="addr">${addr}</div></div>` +
    `<div class="doc"><div class="kicker">${inv.kind === "credit_note" ? "Credit note" : "Invoice"}</div><div class="num">${esc(inv.number)}</div></div></div>` +
    `<div class="rule" style="margin-top:16px"></div>` +
    `<div class="meta"><div class="col"><div class="lbl">Billed to</div><div class="name">${esc(inv.billCompany)}</div>` +
    (inv.billContact ? `<div class="sub">${esc(inv.billContact)}</div>` : "") +
    (inv.showProject && inv.projectLabel
      ? `<div class="lbl" style="margin-top:22px">Project</div><div class="name">${esc(inv.projectLabel)}</div>`
      : "") +
    `</div><div class="col right"><dl>${kv("Date of issue", formatDate(inv.issueDate))}${kv("Due date", formatDate(inv.dueDate))}${kv("Terms", inv.terms)}</dl></div></div>` +
    `<table><thead><tr><th style="width:78%">Activity &amp; description</th><th class="r" style="width:22%">Amount</th></tr></thead><tbody>${rows}</tbody></table>` +
    div(
      "totals",
      div(
        "box",
        (inv.showSubtotal ? `<div class="trow"><span class="k">Subtotal</span><span class="v">${plainAmount(subtotal)}</span></div>` : "") +
          (rate > 0
            ? `<div class="trow"><span class="k">${esc(inv.taxLabel || "Tax")} (${esc(rate)}%)</span><span class="v">${plainAmount(tax)}</span></div>`
            : "") +
          `<div class="trow balance"><span class="k">Balance due</span><span class="v">${esc(inv.currency)}&nbsp;${plainAmount(total)}</span></div>`,
      ),
    ) +
    (inv.showNote && inv.note ? div("note", esc(inv.note)) : "") +
    pay +
    (inv.showFooter
      ? `<div class="foot"${inv.showPayment ? "" : ' style="margin-top:auto"'}><span>${esc(inv.footerText)}</span><span class="e">${esc(inv.mark)}</span></div>`
      : "") +
    `</div>`
  );
}

/** A complete A4 document: what the PDF is printed from and what the HTML view shows in an iframe. */
export function invoiceDocument(inv: Invoice): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(inv.number)}</title>` +
    `<style>@page{size:A4;margin:0}html,body{margin:0;padding:0;background:#fff}${SHEET_CSS}</style></head>` +
    `<body>${invoiceSheetHtml(inv)}</body></html>`
  );
}

// epsilon-invoice app/sheet.css, verbatim except: Open Sans added to the font stacks (the only face headless
// Chromium has on Vercel, F15), and box-sizing on .sheet itself (epsilon-invoice set it globally), so the padded
// 210mm × 296mm sheet fits one A4 page.
export const SHEET_CSS = `
.sheet{--ink:#1d1d1f;--sub:#6e6e73;--faint:#86868b;--line:#d2d2d7;--hair:#e8e8ed;width:210mm;height:296mm;padding:12mm 16mm 10mm 16mm;display:flex;flex-direction:column;position:relative;background:#fff;color:var(--ink);font-family:-apple-system,"SF Pro Text","SF Pro Display","Helvetica Neue",Helvetica,Arial,"Open Sans",sans-serif;font-size:11.8px;line-height:1.55;letter-spacing:-0.005em;-webkit-font-smoothing:antialiased;print-color-adjust:exact;-webkit-print-color-adjust:exact;box-sizing:border-box}
.sheet *{margin:0;padding:0;box-sizing:border-box}
.sheet .head{display:flex;align-items:flex-start;justify-content:space-between}
.sheet .brand .mark{font-family:"Times New Roman",Georgia,"Open Sans",serif;font-size:49.3px;line-height:1;font-weight:400;letter-spacing:-0.02em;display:block}
.sheet .brand .co{margin-top:9px;font-size:12.9px;font-weight:600;letter-spacing:-0.01em}
.sheet .brand .co span{font-weight:400;color:var(--sub)}
.sheet .brand .addr{margin-top:5px;color:var(--sub);font-size:10.6px;line-height:1.65}
.sheet .doc{text-align:right}
.sheet .doc .kicker{font-size:10.1px;font-weight:600;letter-spacing:0.18em;color:var(--faint);text-transform:uppercase}
.sheet .doc .num{font-family:-apple-system,"SF Pro Display","Helvetica Neue",Helvetica,"Open Sans",sans-serif;font-size:33.6px;font-weight:200;letter-spacing:-0.03em;line-height:1;margin-top:3px;color:var(--ink)}
.sheet .rule{height:1px;background:var(--line)}
.sheet .meta{display:flex;gap:0;margin:56px 0 0}
.sheet .meta .col{flex:1;padding-right:16px}
.sheet .meta .col.right{flex:0 0 34%;padding-right:0}
.sheet .lbl{font-size:9.5px;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:var(--faint);margin-bottom:6px}
.sheet .name{font-size:13.4px;font-weight:600;letter-spacing:-0.012em}
.sheet .sub{color:var(--sub);font-size:10.6px;line-height:1.65}
.sheet .kv{display:flex;justify-content:space-between;padding:4.5px 0;border-bottom:1px solid var(--hair)}
.sheet .kv:last-child{border-bottom:0}
.sheet .kv dt{color:var(--sub);font-size:10.6px}
.sheet .kv dd{font-size:10.6px;font-weight:600;letter-spacing:-0.01em}
.sheet table{width:100%;border-collapse:collapse;margin-top:88px}
.sheet thead th{font-size:9.5px;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:var(--faint);text-align:left;padding-bottom:8px;border-bottom:1px solid var(--ink)}
.sheet thead th.r{text-align:right}
.sheet tbody td{padding:15px 0 34px;border-bottom:1px solid var(--hair);vertical-align:top}
.sheet tbody td.r{text-align:right;font-variant-numeric:tabular-nums}
.sheet .item{font-size:12.3px;font-weight:600;letter-spacing:-0.012em}
.sheet .desc{color:var(--faint);font-size:10.6px;margin-top:3px;max-width:118mm}
.sheet .amt{font-size:12.3px;font-weight:500;letter-spacing:-0.01em;white-space:nowrap}
.sheet .totals{margin-top:20px;display:flex;justify-content:flex-end}
.sheet .totals .box{width:100%}
.sheet .trow{display:flex;justify-content:space-between;padding:6px 0;font-size:11.2px}
.sheet .trow .k{color:var(--sub)}
.sheet .trow .v{font-variant-numeric:tabular-nums;font-weight:500}
.sheet .balance{border-top:1px solid var(--ink);margin-top:4px;padding-top:9px;align-items:baseline}
.sheet .balance .k{color:var(--ink);font-weight:600;font-size:11.2px}
.sheet .balance .v{font-size:14.6px;font-weight:600;letter-spacing:-0.02em}
.sheet .note{margin-top:66px;color:var(--sub);font-size:10.6px;max-width:120mm;line-height:1.7}
.sheet .pay{margin-top:auto;padding-top:14px}
.sheet .pay .hd{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px}
.sheet .pay .hd .lbl{margin:0}
.sheet .pay .hd .hint{font-size:10.1px;color:var(--faint)}
.sheet .paygrid{display:flex;gap:9mm}
.sheet .paycol{flex:1}
.sheet .prow{display:flex;justify-content:space-between;gap:8px;padding:3.5px 0;border-bottom:1px solid var(--hair);font-size:10.6px}
.sheet .prow:last-child{border-bottom:0}
.sheet .prow .k{color:var(--faint);white-space:nowrap}
.sheet .prow .v{font-weight:600;letter-spacing:-0.008em;font-variant-numeric:tabular-nums;text-align:right}
.sheet .bank{font-size:10.6px;color:var(--sub);line-height:1.7}
.sheet .bank strong{color:var(--ink);font-weight:600;display:block;margin-bottom:2px}
.sheet .foot{margin-top:16px;padding-top:8px;border-top:1px solid var(--hair);display:flex;justify-content:space-between;align-items:center;font-size:9.5px;color:var(--faint);letter-spacing:0.01em}
.sheet .foot .e{font-family:"Times New Roman",Georgia,"Open Sans",serif;font-size:14.6px;color:var(--sub)}
`;

/** Parses INVOICE_DETAILS_JSON. Returns null (PDF stays pending) rather than printing an invoice without payment details. */
export function parseIssuerDetails(raw: string | undefined): IssuerDetails | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  const o = v as Partial<IssuerDetails>;
  const str = (x: unknown) => (typeof x === "string" ? x : "");
  const payRows = Array.isArray(o.payRows)
    ? o.payRows.filter((r) => r && typeof r.label === "string" && typeof r.value === "string").map((r) => ({ label: r.label, value: r.value }))
    : [];
  if (!str(o.address) || payRows.length === 0) return null;
  return {
    address: str(o.address),
    email: str(o.email) || "er@epsilon-labs.co",
    regLine: str(o.regLine),
    payHint: str(o.payHint),
    payRows,
    bankName: str(o.bankName),
    bankAddress: str(o.bankAddress),
    footerText: str(o.footerText) || "Epsilon Labs AI Solutions (SMC-PVT) Ltd.",
  };
}
