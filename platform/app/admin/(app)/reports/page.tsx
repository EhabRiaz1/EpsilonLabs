import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/app/components/Icon";
import { PageHeader } from "@/app/components/PageHeader";
import { Empty } from "@/app/components/Empty";
import { Note } from "@/app/components/Note";
import { Sheet } from "@/app/components/Sheet";
import { SheetButton } from "@/app/components/SheetButton";
import { ActionForm } from "@/app/components/Forms";
import { getSession } from "@/lib/session";
import { dayMonth, isoDaysFromNow, stamp } from "@/lib/dates";
import { createBlankReport, queueReport } from "./actions";

export const metadata: Metadata = { title: "Reports" };

type Row = { id: string; title: string; period_label: string; status: string; created_at: string; published_at: string | null; pdf_error: string | null; projects: { name: string } | { name: string }[] | null; organizations: { name: string } | { name: string }[] | null };
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const TONE: Record<string, string> = { draft: "", approved: "pill-warn", published: "pill-good", void: "" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
      <PageHeader
        title="Reports"
        sub={
          <>
            <span>{rs.filter((r) => r.status === "draft" || r.status === "approved").length} to finish</span>
            <span aria-hidden="true">·</span>
            <span>{rs.filter((r) => r.status === "published").length} published</span>
            <span aria-hidden="true">·</span>
            <span>drafted on the Mac, edited and published here; the PDF is stored once, on publish</span>
          </>
        }
        actions={
          <>
            <SheetButton sheet="report-blank">
              <Icon name="plus" className="i-sm" />
              Blank report
            </SheetButton>
            <SheetButton sheet="report-draft" className="btn btn-primary">
              <Icon name="send" className="i-sm" />
              Draft a report
            </SheetButton>
          </>
        }
      />

      {js.length > 0 && (
        <section className="panel jobs-strip" aria-label="Drafting on the Mac">
          <div className="ph">
            <h2>Drafting on the Mac</h2>
            <span className="c-3">last {Math.min(5, js.length)}</span>
          </div>
          <div className="list-rows">
            {js.slice(0, 5).map((j) => (
              <div key={j.id}>
                <Icon name={j.status === "failed" ? "alert" : j.status === "done" ? "check" : "clock"} className={`i-sm ${j.status === "failed" ? "c-bad" : "c-3"}`} />
                <span className="grow t-12">
                  {j.status === "queued" ? "Queued until the Mac picks it up" : j.status}
                  {j.error ? `: ${j.error}` : ""}
                </span>
                <span className="c-3 t-12 mono">{stamp(j.created_at)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel table-wrap">
        {reports.error ? (
          <Note retry>Couldn&apos;t load reports.</Note>
        ) : rs.length === 0 ? (
          <Empty
            icon="chart"
            title="No reports yet"
            action={
              <SheetButton sheet="report-draft" className="btn btn-primary">
                <Icon name="send" className="i-sm" />
                Draft a report
              </SheetButton>
            }
          >
            <p>Queue a draft for a project and period; it appears here when the Mac has written it.</p>
          </Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Report</th>
                <th scope="col">Client</th>
                <th scope="col">Status</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {rs.map((r) => (
                <tr key={r.id} className={r.status === "void" ? "dim" : undefined}>
                  <td>
                    <Link className="rowlink" href={`/reports/${r.id}`}>
                      {r.title}
                    </Link>
                    <div className="c-3 t-12">{[one(r.projects)?.name, r.period_label].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td>{one(r.organizations)?.name}</td>
                  <td>
                    <span className={`pill ${r.status === "approved" && r.pdf_error ? "pill-bad" : (TONE[r.status] ?? "")}`}>
                      <span className="dot" />
                      {r.status === "approved" && r.pdf_error ? "PDF failed" : cap(r.status)}
                    </span>
                  </td>
                  <td className="c-3 t-12">{r.published_at ? `published ${dayMonth(r.published_at)}` : dayMonth(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Sheet id="report-draft" title="Draft a delivery report" sub="The Mac reads the period's finished tickets, updates and EL-n commits.">
        <p className="hint">Add measurements and sign-offs as notes: the drafter never invents numbers.</p>
        <ActionForm action={queueReport} submit="Queue the draft" icon="send">
          <div className="stack gap-10">
            {select("rep-project")}
            <div className="row wrap gap-10">
              <div className="field grow">
                <label className="label" htmlFor="rep-from">From</label>
                <input className="input" type="date" id="rep-from" name="period_start" required defaultValue={isoDaysFromNow(-30)} />
              </div>
              <div className="field grow">
                <label className="label" htmlFor="rep-to">To</label>
                <input className="input" type="date" id="rep-to" name="period_end" required defaultValue={isoDaysFromNow(0)} />
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="rep-notes">
                Notes for the drafter <span className="c-3">(optional)</span>
              </label>
              <textarea className="textarea" id="rep-notes" name="notes" rows={4} maxLength={4000} placeholder="Measurements, before/after numbers, who verified what" />
            </div>
          </div>
        </ActionForm>
      </Sheet>
      <Sheet id="report-blank" title="Start a blank report" sub="You write it here; nothing reaches the client until you publish.">
        <ActionForm action={createBlankReport} submit="Create" icon="plus">
          <div className="stack gap-10">
            {select("rep-project-b")}
            <div className="field">
              <label className="label" htmlFor="rep-title">Title (product or project name)</label>
              <input className="input" id="rep-title" name="title" maxLength={120} required />
            </div>
            <div className="field">
              <label className="label" htmlFor="rep-period">Period label</label>
              <input className="input" id="rep-period" name="period_label" maxLength={80} placeholder="October 2026" />
            </div>
          </div>
        </ActionForm>
      </Sheet>
    </>
  );
}
