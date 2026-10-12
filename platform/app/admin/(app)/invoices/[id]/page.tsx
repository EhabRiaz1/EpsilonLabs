import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoiceView } from "@/app/components/InvoiceView";
import { ActionButton, ActionForm } from "@/app/components/Forms";
import { Money } from "@/app/components/Money";
import { INVOICE_COLUMNS, type StoredInvoice } from "@/lib/invoice-view";
import { linesToText } from "@/lib/invoice-form";
import { getSession } from "@/lib/session";
import { dayMonthYear, isoDaysFromNow } from "@/lib/dates";
import { approveInvoice, createCreditNote, issueInvoice, markInvoicePaid, saveInvoiceDraft, voidInvoice } from "../actions";
import { InvoiceFields } from "../InvoiceFields";

export const metadata: Metadata = { title: "Invoice" };
// "Issue" stores the PDF in this page's server action (headless Chromium, F15)
export const maxDuration = 60;

type Extra = { ref_invoice_id: string | null; credit_reason: string | null; paid_at: string | null; schedule_stage: number | null; proposal_id: string | null };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await getSession();
  // RLS: staff with aal2
  const { data } = await supabase.from("invoices").select(`${INVOICE_COLUMNS}, ref_invoice_id, credit_reason, paid_at, schedule_stage, proposal_id`).eq("id", id).maybeSingle();
  if (!data) notFound();
  const inv = data as unknown as StoredInvoice & Extra;
  const [{ data: credits }, { data: ref }] = await Promise.all([
    supabase.from("invoices").select("id, number, total, currency, status").eq("ref_invoice_id", id).neq("status", "void"),
    inv.ref_invoice_id ? supabase.from("invoices").select("id, number").eq("id", inv.ref_invoice_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const cn = (credits ?? []) as { id: string; number: string | null; total: number; currency: string; status: string }[];
  const editable = inv.status === "draft" || inv.status === "approved";
  const issued = ["sent", "overdue", "paid"].includes(inv.status);
  const isInvoice = inv.kind === "invoice";

  return (
    <InvoiceView inv={inv} back={{ href: "/invoices", label: "Invoices" }} admin={true}>
      <section className="panel panel-pad" style={{ marginBottom: 14 }}>
        <div className="row wrap" style={{ gap: 10, alignItems: "flex-start" }}>
          {inv.status === "draft" && <ActionButton className="btn btn-primary" label="Approve" action={approveInvoice.bind(null, id)} />}
          {inv.status === "approved" && (
            <ActionButton className="btn btn-primary" label={isInvoice ? "Issue and notify the client" : "Issue the credit note"} confirmText="Issue it? It gets its EL number, the client is notified and it can never change." action={issueInvoice.bind(null, id)} />
          )}
          {editable && <ActionButton className="btn btn-ghost" label="Void draft" confirmText="Void this draft? No number is used." action={voidInvoice.bind(null, id)} />}
          {ref && <Link className="btn btn-ghost" href={`/invoices/${(ref as { id: string }).id}`}>Credits {(ref as { number: string | null }).number}</Link>}
          <span className="c-3 t-13" style={{ marginLeft: "auto" }}>
            {inv.kind === "credit_note" && inv.credit_reason ? `Reason: ${inv.credit_reason}` : ""}
            {inv.paid_at ? `Paid ${dayMonthYear(inv.paid_at)}` : ""}
            {inv.proposal_id && inv.schedule_stage !== null ? ` · schedule stage ${inv.schedule_stage + 1}` : ""}
          </span>
        </div>
        {editable && (
          <details style={{ marginTop: 14 }} open={inv.status === "draft"}>
            <summary className="w-600" style={{ cursor: "pointer" }}>Edit the draft</summary>
            <ActionForm action={saveInvoiceDraft.bind(null, id)} submit="Save draft" secondary>
              <div className="stack" style={{ gap: 10, marginTop: 10 }}>
                <InvoiceFields
                  idp="edit"
                  v={{
                    bill_company: inv.bill_company, bill_contact: inv.bill_contact, project_label: inv.project_label, lines: linesToText(inv.lines ?? []),
                    tax_label: inv.tax_label ?? "", tax_rate: String(inv.tax_rate ?? 0), currency: inv.currency, due_date: inv.due_date ?? "",
                  }}
                />
              </div>
            </ActionForm>
          </details>
        )}
        {issued && isInvoice && inv.status !== "paid" && (
          <div style={{ marginTop: 14 }}>
            <ActionForm action={markInvoicePaid.bind(null, id)} submit="Mark paid" icon="check">
              <div className="field" style={{ maxWidth: 220 }}>
                <label className="label" htmlFor="paid-on">Payment received on</label>
                <input className="input" type="date" id="paid-on" name="paid_on" required defaultValue={isoDaysFromNow(0)} max={isoDaysFromNow(0)} />
              </div>
            </ActionForm>
          </div>
        )}
        {issued && isInvoice && (
          <details style={{ marginTop: 14 }}>
            <summary className="w-600" style={{ cursor: "pointer" }}>Issue a credit note against {inv.number}</summary>
            {cn.length > 0 && (
              <p className="c-3 t-13" style={{ marginTop: 8 }}>
                Existing: {cn.map((c, i) => (
                  <span key={c.id}>{i ? ", " : ""}<Link href={`/invoices/${c.id}`}>{c.number ?? "draft"}</Link> (<Money value={c.total} currency={c.currency} />)</span>
                ))}
              </p>
            )}
            <ActionForm action={createCreditNote.bind(null, id)} submit="Create credit note draft" secondary>
              <div className="stack" style={{ gap: 10, marginTop: 10 }}>
                <div className="field">
                  <label className="label" htmlFor="cn-lines">Lines (Title | description | amount; the invoice&apos;s tax rate applies)</label>
                  <textarea className="textarea mono-ish" id="cn-lines" name="lines" rows={3} required placeholder="Hosting credit | October not delivered | 33.33" />
                </div>
                <div className="field">
                  <label className="label" htmlFor="cn-reason">Reason</label>
                  <input className="input" id="cn-reason" name="reason" required minLength={3} maxLength={500} />
                </div>
              </div>
            </ActionForm>
          </details>
        )}
      </section>
    </InvoiceView>
  );
}
