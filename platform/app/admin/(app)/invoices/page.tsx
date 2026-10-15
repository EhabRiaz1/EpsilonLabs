import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/app/components/Icon";
import { Money } from "@/app/components/Money";
import { StatusPill } from "@/app/components/StatusPill";
import { PageHeader } from "@/app/components/PageHeader";
import { Empty } from "@/app/components/Empty";
import { Note } from "@/app/components/Note";
import { getSession } from "@/lib/session";
import { dayMonth } from "@/lib/dates";

export const metadata: Metadata = { title: "Invoices" };

type Row = {
  id: string;
  number: string | null;
  kind: string;
  bill_company: string;
  status: string;
  total: number;
  currency: string;
  issued_at: string | null;
  due_date: string | null;
  pdf_path: string | null;
  created_at: string;
};

export default async function InvoicesPage() {
  const { supabase } = await getSession();
  const { data, error } = await supabase
    .from("invoices")
    .select("id, number, kind, bill_company, status, total, currency, issued_at, due_date, pdf_path, created_at")
    .order("created_at", { ascending: false })
    .limit(300);
  const rows = (data ?? []) as Row[];
  const due = rows.filter((r) => r.kind === "invoice" && (r.status === "sent" || r.status === "overdue"));
  const dueCur = due[0]?.currency ?? "USD";
  const dueSum = due.filter((r) => r.currency === dueCur).reduce((t, r) => t + Number(r.total), 0);
  return (
    <>
      <PageHeader
        title="Invoices"
        sub={
          <>
            <span>{due.length} outstanding</span>
            {due.length > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <Money value={dueSum} currency={dueCur} />
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>numbered EL-YYYY-NNN when issued; corrections are credit notes</span>
          </>
        }
        actions={
          <Link className="btn btn-primary" href="/invoices/new">
            <Icon name="plus" className="i-sm" />
            New invoice
          </Link>
        }
      />
      {error ? (
        <Note retry>Couldn&apos;t load invoices.</Note>
      ) : rows.length === 0 ? (
        <section className="panel">
          <Empty
            icon="receipt"
            title="No invoices yet"
            action={
              <Link className="btn btn-primary" href="/invoices/new">
                <Icon name="plus" className="i-sm" />
                New invoice
              </Link>
            }
          >
            <p>The deposit invoice is issued automatically when a client accepts a proposal. Milestone, final and ad-hoc invoices start from New invoice.</p>
          </Empty>
        </section>
      ) : (
        <section className="panel table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Client</th>
                <th>Status</th>
                <th className="num-col">Total</th>
                <th>Issued</th>
                <th>Due</th>
                <th>PDF</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.status === "void" ? "dim" : undefined}>
                  <td className="id">
                    <Link className="rowlink" href={`/invoices/${r.id}`}>
                      {r.number ?? "Draft"}
                      {r.kind === "credit_note" ? " · credit note" : ""}
                    </Link>
                  </td>
                  <td>{r.bill_company}</td>
                  <td>
                    <StatusPill status={r.status} />
                  </td>
                  <td className="num-col nowrap">
                    <Money value={r.total} currency={r.currency} />
                  </td>
                  <td className="c-3 t-12">{r.issued_at ? dayMonth(r.issued_at) : "–"}</td>
                  <td className="c-3 t-12">{r.due_date ? dayMonth(r.due_date) : "–"}</td>
                  <td className="c-3 t-12">{r.number ? (r.pdf_path ? "Stored" : "Pending") : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
