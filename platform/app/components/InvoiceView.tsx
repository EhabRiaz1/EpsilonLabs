import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { Money } from "./Money";
import { StatusPill } from "./StatusPill";
import { invoicePreviewHtml, type StoredInvoice } from "@/lib/invoice-view";
import { dayMonthYear } from "@/lib/dates";

/**
 * One invoice: the ported epsilon-invoice sheet in an isolated iframe (the same HTML the PDF is printed from)
 * plus status and the download. Used by admin.* and client.*.
 */
export function InvoiceView({ inv, back, admin, children }: { inv: StoredInvoice; back: { href: string; label: string }; admin: boolean; children?: ReactNode }) {
  const { html, configured } = invoicePreviewHtml(inv);
  const issued = Boolean(inv.number);
  return (
    <>
      <header className="page-head">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <h1 className="display">{inv.number ?? "Draft invoice"}</h1>
            <StatusPill status={inv.status} />
          </div>
          <div className="sub">
            {inv.bill_company} · <Money value={inv.total} currency={inv.currency} />
            {inv.due_date ? ` · due ${dayMonthYear(inv.due_date)}` : ""}
          </div>
        </div>
        <div className="actions-bar">
          <Link className="btn btn-ghost" href={back.href}>
            <Icon name="arrowL" className="i-sm" />
            {back.label}
          </Link>
          {issued && (
            <a className="btn btn-primary" href={`/invoices/${inv.id}/pdf`}>
              <Icon name="download" className="i-sm" />
              Download PDF
            </a>
          )}
        </div>
      </header>
      {admin && issued && !inv.pdf_path && (
        <p className="auth-error" role="status" style={{ marginBottom: 14 }}>
          <Icon name="clock" className="i-sm" />
          PDF pending: it is rendered on the first download.{inv.pdf_error ? ` Last attempt: ${inv.pdf_error}` : ""}
        </p>
      )}
      {admin && !configured && (
        <p className="auth-error" role="status" style={{ marginBottom: 14 }}>
          <Icon name="alert" className="i-sm" />
          INVOICE_DETAILS_JSON isn&apos;t set, so the issuer address and payment details are missing below and no PDF can be stored.
        </p>
      )}
      {children}
      <iframe className="sheet-frame" title={`Invoice ${inv.number ?? ""}`} srcDoc={html} sandbox="" />
    </>
  );
}
