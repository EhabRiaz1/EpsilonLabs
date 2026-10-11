import { describe, expect, it } from "vitest";
import { computeTotals, formatDate, invoiceDocument, isoDate, parseIssuerDetails, toInvoice, type InvoiceRow } from "./invoice-sheet";

const ISSUER = {
  address: "Lahore, Pakistan",
  email: "er@epsilon-labs.co",
  regLine: "CUIN 0290150",
  payHint: "Bank transfer",
  payRows: [{ label: "IBAN", value: "PK00TEST0000000000000000" }],
  bankName: "Test Bank",
  bankAddress: "Line 1\nLine 2",
  footerText: "Epsilon Labs",
};

const ROW: InvoiceRow = {
  id: "i1",
  number: "EL-2026-004",
  kind: "invoice",
  bill_company: "Northwind <Industrial> GmbH",
  bill_contact: "Jonas Weber",
  project_label: "Plant Visibility Pilot",
  lines: [{ title: "Deposit · 40% on signature", desc: "Proposal v2 & terms", amount: 7200 }],
  tax_label: null,
  tax_rate: 0,
  currency: "USD",
  total: 7200,
  due_date: "2026-10-25",
  issued_at: "2026-10-11T09:32:00Z",
  status: "sent",
};

describe("invoice sheet", () => {
  it("maps a row to the ported Invoice shape", () => {
    const inv = toInvoice(ROW, ISSUER);
    expect(inv).toMatchObject({ number: "EL-2026-004", issueDate: "2026-10-11", dueDate: "2026-10-25", terms: "Net 14", showSubtotal: false });
    expect(computeTotals(inv)).toEqual({ subtotal: 7200, tax: 0, rate: 0, total: 7200 });
  });

  it("adds a single tax line like epsilon-invoice", () => {
    const inv = toInvoice({ ...ROW, tax_label: "GST", tax_rate: "16" }, ISSUER);
    expect(computeTotals(inv)).toEqual({ subtotal: 7200, tax: 1152, rate: 16, total: 8352 });
    expect(invoiceDocument(inv)).toContain("GST (16%)");
  });

  it("escapes every value and renders amounts with two decimals", () => {
    const html = invoiceDocument(toInvoice(ROW, ISSUER));
    expect(html).toContain("Northwind &lt;Industrial&gt; GmbH");
    expect(html).not.toContain("<Industrial>");
    expect(html).toContain("Proposal v2 &amp; terms");
    expect(html).toContain("USD&nbsp;7,200.00");
    expect(html).toContain("11/10/2026");
    expect(html).toContain("@page{size:A4");
  });

  it("uses Pakistan dates and the printed dd/mm/yyyy format", () => {
    expect(isoDate("2026-12-31T19:30:00Z")).toBe("2027-01-01");
    expect(formatDate("2026-10-25")).toBe("25/10/2026");
  });

  it("refuses issuer details without payment rows", () => {
    expect(parseIssuerDetails(undefined)).toBeNull();
    expect(parseIssuerDetails("{not json")).toBeNull();
    expect(parseIssuerDetails(JSON.stringify({ address: "x", payRows: [] }))).toBeNull();
    expect(parseIssuerDetails(JSON.stringify(ISSUER))).toEqual(ISSUER);
  });
});
