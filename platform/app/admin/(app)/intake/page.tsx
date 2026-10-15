import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/app/components/PageHeader";
import { RouteTabs } from "@/app/components/RouteTabs";
import { Empty } from "@/app/components/Empty";
import { Note } from "@/app/components/Note";
import { getSession } from "@/lib/session";
import { INTAKE_CHIP, INTAKE_STATUSES, type IntakeStatus } from "@/lib/intake";
import { relativeDay } from "@/lib/tickets";

export const metadata: Metadata = { title: "Intake" };

type Row = { id: string; name: string; email: string; company: string | null; kind: string; budget: string | null; status: IntakeStatus; answers: Record<string, string>; created_at: string };
const VIEWS = ["new", "contacted", "converted", "spam", "all"] as const;
type View = (typeof VIEWS)[number];

export default async function IntakePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: raw } = await searchParams;
  const view: View = VIEWS.includes(raw as View) ? (raw as View) : "new";
  const { supabase } = await getSession();
  // RLS: full staff (aal2) only
  let q = supabase.from("intake").select("id, name, email, company, kind, budget, status, answers, created_at").order("created_at", { ascending: false }).limit(200);
  if (view !== "all") q = q.eq("status", view);
  const [{ data, error }, ...counts] = await Promise.all([
    q,
    ...INTAKE_STATUSES.map((s) => supabase.from("intake").select("id", { count: "exact", head: true }).eq("status", s)),
  ]);
  const rows = (data ?? []) as Row[];
  const n = Object.fromEntries(INTAKE_STATUSES.map((s, i) => [s, counts[i].count ?? 0])) as Record<IntakeStatus, number>;
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Intake"
        sub={
          <>
            <span>{n.new} new</span>
            <span aria-hidden="true">·</span>
            <span>enquiries from epsilon-labs.co/start; each one opened or joined an inbound lead in Pipeline</span>
          </>
        }
        refresh={15}
      />
      <section className="panel list-panel">
        <div className="list-tools">
          <RouteTabs
            label="Filter enquiries"
            value={view}
            items={VIEWS.map((v) => ({ key: v, label: v === "all" ? "All" : INTAKE_CHIP[v].label, count: v === "all" ? undefined : n[v], href: v === "new" ? "/intake" : `/intake?status=${v}` }))}
          />
        </div>
        {error ? (
          <Note retry>Couldn&apos;t load enquiries.</Note>
        ) : rows.length === 0 ? (
          view === "new" ? (
            <Empty title="All clear">
              <p>No new enquiries. New ones appear here within 15 seconds, and you get an email.</p>
            </Empty>
          ) : (
            <Empty variant="inline">No enquiries with this status.</Empty>
          )
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">From</th>
                  <th scope="col" className="hide-m">Wants</th>
                  <th scope="col" className="hide-m">Budget</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num-col">Received</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.status === "spam" ? "dim" : undefined}>
                    <td>
                      <Link className="rowlink" href={`/intake/${r.id}`}>
                        <div className="w-600">{r.name}</div>
                        <div className="c-3 t-12 truncate">{r.company ? `${r.company} · ${r.email}` : r.email}</div>
                      </Link>
                    </td>
                    <td className="hide-m">
                      <div className="t-13">{r.answers?.offer_name || r.answers?.need || "–"}</div>
                      <div className="c-3 t-12">{r.kind}</div>
                    </td>
                    <td className="hide-m c-2 t-13">{r.budget || "–"}</td>
                    <td>
                      <span className={`pill ${INTAKE_CHIP[r.status]?.tone ?? ""}`}>
                        <span className="dot" />
                        {INTAKE_CHIP[r.status]?.label ?? r.status}
                      </span>
                    </td>
                    <td className="num-col c-3 t-12 nowrap">{relativeDay(r.created_at, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
