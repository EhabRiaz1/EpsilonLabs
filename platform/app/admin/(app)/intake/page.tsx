import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/app/components/Icon";
import { MenuButton } from "@/app/components/ShellControls";
import { AutoRefresh } from "@/app/components/AutoRefresh";
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
      <header className="page-head">
        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
          <MenuButton />
          <div>
            <h1 className="display">Intake</h1>
            <div className="sub">Enquiries from epsilon-labs.co/start. Each one opened or joined an inbound lead in Pipeline.</div>
          </div>
        </div>
        <AutoRefresh seconds={15} />
      </header>
      <section className="panel" style={{ overflow: "hidden" }}>
        <div className="q-head">
          <nav className="tabs" aria-label="Filter enquiries">
            {VIEWS.map((v) => (
              <Link key={v} className="tab" href={v === "new" ? "/intake" : `/intake?status=${v}`} aria-current={view === v ? "page" : undefined}>
                {v === "all" ? "All" : INTAKE_CHIP[v].label} {v !== "all" && <span className="c-3">{n[v]}</span>}
              </Link>
            ))}
          </nav>
        </div>
        {error ? (
          <p className="c-bad t-13 panel-pad">Couldn&apos;t load enquiries. Reload to retry.</p>
        ) : rows.length === 0 ? (
          <div className="empty">
            <div className="orb">
              <span className="wave" />
              <span className="wave" />
              <span className="core">
                <Icon name={view === "new" ? "check" : "inbox"} className="i-lg" />
              </span>
            </div>
            <h2 className="display">{view === "new" ? "All clear" : "Nothing here"}</h2>
            <p className="c-2" style={{ maxWidth: "36ch" }}>
              {view === "new" ? "No new enquiries. New ones appear here within 15 seconds, and you get an email." : "No enquiries with this status."}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>From</th>
                  <th className="hide-m">Wants</th>
                  <th className="hide-m">Budget</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Received</th>
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
                    <td className="c-3 t-12" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {relativeDay(r.created_at, now)}
                    </td>
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
