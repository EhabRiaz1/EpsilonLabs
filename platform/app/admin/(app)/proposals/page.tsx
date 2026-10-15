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

export const metadata: Metadata = { title: "Proposals" };

type Row = {
  id: string;
  version: number;
  title: string;
  client_company: string;
  status: string;
  total: number;
  currency: string;
  valid_until: string;
  created_at: string;
  sent_at: string | null;
  viewed_at: string | null;
  acceptances: { accepted_at: string } | { accepted_at: string }[] | null;
};

function acceptedAt(r: Row): string | null {
  const a = Array.isArray(r.acceptances) ? r.acceptances[0] : r.acceptances;
  return a?.accepted_at ?? null;
}

/** sent → viewed → accepted, each with its date once it happened. */
function Trail({ r }: { r: Row }) {
  const steps: [string, string | null][] = [
    ["Sent", r.sent_at],
    ["Viewed", r.viewed_at],
    ["Accepted", acceptedAt(r)],
  ];
  if (!r.sent_at) return <span className="c-3 t-12">Not sent</span>;
  return (
    <span className="trail">
      {steps.map(([label, at], i) => (
        <span key={label} className="row gap-6">
          {i > 0 && <Icon name="chevR" className="i-sm" />}
          <span className={at ? "on" : undefined}>
            {label}
            {at ? ` ${dayMonth(at)}` : ""}
          </span>
        </span>
      ))}
    </span>
  );
}

export default async function ProposalsPage() {
  const { supabase } = await getSession();
  // RLS: staff (aal2) only
  const { data, error } = await supabase
    .from("proposals")
    .select("id, version, title, client_company, status, total, currency, valid_until, created_at, sent_at, viewed_at, acceptances(accepted_at)")
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as Row[];
  return (
    <>
      <PageHeader
        title="Proposals"
        sub={
          <>
            <span>{rows.filter((r) => r.status === "sent" || r.status === "viewed").length} out</span>
            <span aria-hidden="true">·</span>
            <span>{rows.filter((r) => r.status === "accepted").length} accepted</span>
            <span aria-hidden="true">·</span>
            <span>draft, approve and send; follow each link from sent to accepted</span>
          </>
        }
        actions={
          <Link className="btn btn-primary" href="/proposals/new">
            <Icon name="plus" className="i-sm" />
            New proposal
          </Link>
        }
      />
      {error ? (
        <Note retry>Couldn&apos;t load proposals.</Note>
      ) : rows.length === 0 ? (
        <section className="panel">
          <Empty
            icon="file"
            title="No proposals yet"
            action={
              <Link className="btn btn-primary" href="/proposals/new">
                <Icon name="plus" className="i-sm" />
                New proposal
              </Link>
            }
          >
            <p>Start one from a deal. Prices come from the catalogue.</p>
          </Empty>
        </section>
      ) : (
        <section className="panel table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Proposal</th>
                <th>Status</th>
                <th>Trail</th>
                <th className="num-col">Total</th>
                <th>Valid until</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.status === "void" ? "dim" : undefined}>
                  <td>
                    <Link className="rowlink" href={`/proposals/${r.id}`}>
                      <div className="w-500">{r.title}</div>
                      <div className="c-3 t-12">
                        {r.client_company} · v{r.version}
                      </div>
                    </Link>
                  </td>
                  <td>
                    <StatusPill status={r.status} />
                  </td>
                  <td>
                    <Trail r={r} />
                  </td>
                  <td className="num-col nowrap">
                    <Money value={r.total} currency={r.currency} />
                  </td>
                  <td className="c-3 t-12 nowrap">
                    {dayMonth(r.valid_until)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
