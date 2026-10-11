import "server-only";
import { invoiceDocument, parseIssuerDetails, toInvoice, type InvoiceRow } from "./invoice-sheet";

export const INVOICE_COLUMNS =
  "id, org_id, number, kind, bill_company, bill_contact, project_label, lines, tax_label, tax_rate, currency, total, due_date, issued_at, status, pdf_path, pdf_error";

export type StoredInvoice = InvoiceRow & { org_id: string; pdf_path: string | null; pdf_error: string | null };

export function issuerDetails() {
  return parseIssuerDetails(process.env.INVOICE_DETAILS_JSON);
}

/** The invoice as a full HTML document, or null when the issuer/payment details aren't configured. */
export function invoiceHtml(row: InvoiceRow): string | null {
  const issuer = issuerDetails();
  return issuer ? invoiceDocument(toInvoice(row, issuer)) : null;
}

/** For the on-screen view only: renders even without issuer details, and says so on the sheet. Never stored. */
export function invoicePreviewHtml(row: InvoiceRow): { html: string; configured: boolean } {
  const issuer = issuerDetails();
  if (issuer) return { html: invoiceDocument(toInvoice(row, issuer)), configured: true };
  const placeholder = { address: "Issuer address not configured (INVOICE_DETAILS_JSON)", email: "er@epsilon-labs.co", regLine: "", payHint: "", payRows: [], bankName: "", bankAddress: "", footerText: "Epsilon Labs AI Solutions (SMC-PVT) Ltd." };
  return { html: invoiceDocument(toInvoice(row, placeholder)), configured: false };
}
