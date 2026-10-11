import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/app/components/Icon";
import { Money } from "@/app/components/Money";
import { StatusPill } from "@/app/components/StatusPill";
import { MenuButton } from "@/app/components/ShellControls";
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
  return (
    <>
      <header className="page-head">
        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
          <MenuButton />
          <div>
            <h1 className="display">Invoices</h1>
            <div className="sub">Numbered EL-YYYY-NNN when issued. Issued invoices never change; corrections are credit notes.</div>
          </div>
        </div>
      </header>
      {error ? (
        <section className="panel panel-pad">
          <p className="c-bad t-13">Couldn&apos;t load invoices. Reload to retry.</p>
        </section>
      ) : rows.length === 0 ? (
        <section className="panel">
          <div className="empty">
            <div className="orb">
              <span className="wave" />
              <span className="wave" />
              <span className="core">
                <Icon name="receipt" className="i-lg" />
              </span>
            </div>
            <h2 className="display">No invoices yet</h2>
            <p className="c-2" style={{ maxWidth: "40ch" }}>
              The deposit invoice is issued automatically when a client accepts a proposal.
            </p>
          </div>
        </section>
      ) : (
        <section className="panel table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Client</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Total</th>
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
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
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
