import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/app/components/Icon";
import { MenuButton } from "@/app/components/ShellControls";
import { ActionForm } from "@/app/components/Forms";
import { getSession } from "@/lib/session";
import { dayMonth, isoDaysFromNow, stamp } from "@/lib/dates";
import { createBlankReport, queueReport } from "./actions";

export const metadata: Metadata = { title: "Reports" };

type Row = { id: string; title: string; period_label: string; status: string; created_at: string; published_at: string | null; pdf_error: string | null; projects: { name: string } | { name: string }[] | null; organizations: { name: string } | { name: string }[] | null };
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const TONE: Record<string, string> = { draft: "", approved: "pill-warn", published: "pill-good", void: "" };

export default async function ReportsPage() {
  const { supabase } = await getSession();
  const [reports, projects, jobs] = await Promise.all([
    supabase.from("reports").select("id, title, period_label, status, created_at, published_at, pdf_error, projects(name), organizations(name)").order("created_at", { ascending: false }).limit(200),
    supabase.from("projects").select("id, name, organizations(name)").neq("status", "archived").order("name"),
    supabase.from("jobs").select("id, status, error, params, created_at").eq("type", "report_draft").order("created_at", { ascending: false }).limit(10),
  ]);
  const rs = (reports.data ?? []) as unknown as Row[];
  const ps = ((projects.data ?? []) as unknown as { id: string; name: string; organizations: { name: string } | null }[]).map((p) => ({ id: p.id, label: `${one(p.organizations)?.name ?? ""} · ${p.name}` }));
  const js = (jobs.data ?? []) as { id: string; status: string; error: string | null; created_at: string }[];
  const select = (idp: string) => (
    <div className="field">
      <label className="label" htmlFor={idp}>Project</label>
      <select className="select" id={idp} name="project_id" required defaultValue="">
        <option value="" disabled>Pick a project</option>
        {ps.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
    </div>
  );
  return (
    <>
      <header className="page-head">
        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
          <MenuButton />
          <div>
            <h1 className="display">Reports</h1>
            <div className="sub">Delivery reports in the R2 layout. Drafted on the Mac, edited and published here; the PDF is stored once, on publish.</div>
          </div>
        </div>
      </header>
      <div className="grid-main" style={{ marginTop: 0 }}>
        <div className="col">
          <section className="panel table-wrap">
            {reports.error ? (
              <p className="c-bad t-13 panel-pad">Couldn&apos;t load reports. Reload to retry.</p>
            ) : rs.length === 0 ? (
              <div className="empty">
                <div className="orb"><span className="wave" /><span className="wave" /><span className="core"><Icon name="chart" className="i-lg" /></span></div>
                <h2 className="display">No reports yet</h2>
                <p className="c-2" style={{ maxWidth: "40ch" }}>Queue a draft for a project and period; it appears here when the Mac has written it.</p>
              </div>
            ) : (
              <table className="table">
                <thead><tr><th>Report</th><th>Client</th><th>Status</th><th>Created</th></tr></thead>
                <tbody>
                  {rs.map((r) => (
                    <tr key={r.id} className={r.status === "void" ? "dim" : undefined}>
                      <td>
                        <Link className="rowlink" href={`/reports/${r.id}`}>{r.title}</Link>
                        <div className="c-3 t-12">{[one(r.projects)?.name, r.period_label].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td>{one(r.organizations)?.name}</td>
                      <td>
                        <span className={`pill ${TONE[r.status] ?? ""}`}><span className="dot" />{r.status === "approved" && r.pdf_error ? "PDF failed" : r.status}</span>
                      </td>
                      <td className="c-3 t-12">{r.published_at ? `published ${dayMonth(r.published_at)}` : dayMonth(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
        <div className="col">
          <section className="panel panel-pad">
            <h2 className="t-16 w-600" style={{ marginBottom: 6 }}>Draft a delivery report</h2>
            <p className="hint" style={{ marginBottom: 12 }}>The Mac reads the period&apos;s finished tickets, updates and EL-n commits. Add measurements and sign-offs as notes: the drafter never invents numbers.</p>
            <ActionForm action={queueReport} submit="Queue the draft" icon="send" secondary>
              <div className="stack" style={{ gap: 10 }}>
                {select("rep-project")}
                <div className="row wrap" style={{ gap: 10 }}>
                  <div className="field grow"><label className="label" htmlFor="rep-from">From</label><input className="input" type="date" id="rep-from" name="period_start" required defaultValue={isoDaysFromNow(-30)} /></div>
                  <div className="field grow"><label className="label" htmlFor="rep-to">To</label><input className="input" type="date" id="rep-to" name="period_end" required defaultValue={isoDaysFromNow(0)} /></div>
                </div>
                <div className="field">
                  <label className="label" htmlFor="rep-notes">Notes for the drafter <span className="c-3">(optional)</span></label>
                  <textarea className="textarea" id="rep-notes" name="notes" rows={4} maxLength={4000} placeholder="Measurements, before/after numbers, who verified what" />
                </div>
              </div>
            </ActionForm>
            {js.length > 0 && (
              <div className="list-rows" style={{ marginTop: 14 }}>
                {js.slice(0, 5).map((j) => (
                  <div key={j.id}>
                    <Icon name={j.status === "failed" ? "alert" : j.status === "done" ? "check" : "clock"} className="i-sm c-3" />
                    <span className="grow t-12">{j.status === "queued" ? "Queued until the Mac picks it up" : j.status}{j.error ? `: ${j.error}` : ""}</span>
                    <span className="c-3 t-12">{stamp(j.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="panel panel-pad">
            <h2 className="t-16 w-600" style={{ marginBottom: 6 }}>Or start a blank report</h2>
            <ActionForm action={createBlankReport} submit="Create" icon="plus" secondary>
              <div className="stack" style={{ gap: 10 }}>
                {select("rep-project-b")}
                <div className="field"><label className="label" htmlFor="rep-title">Title (product or project name)</label><input className="input" id="rep-title" name="title" maxLength={120} required /></div>
                <div className="field"><label className="label" htmlFor="rep-period">Period label</label><input className="input" id="rep-period" name="period_label" maxLength={80} placeholder="October 2026" /></div>
              </div>
            </ActionForm>
          </section>
        </div>
      </div>
    </>
  );
}
