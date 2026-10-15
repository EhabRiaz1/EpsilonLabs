import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import { PageHeader } from "@/app/components/PageHeader";
import { Note } from "@/app/components/Note";
import { getSession } from "@/lib/session";
import { stamp } from "@/lib/dates";
import { checkReport, normalise } from "@/lib/report-content";
import { reportToText } from "@/lib/report-text";
import { monthYear, reportDocument } from "@/lib/report-template";
import { ReportEditor } from "./ReportEditor";

export const metadata: Metadata = { title: "Report" };
// "Approve & publish" renders the PDF in this page's server action (headless Chromium, F15)
export const maxDuration = 60;

type Row = {
  id: string; title: string; period_label: string; content: unknown; status: string; pdf_path: string | null; pdf_error: string | null;
  job_id: string | null; created_at: string; approved_at: string | null; published_at: string | null; edited_at: string | null;
  projects: { name: string } | { name: string }[] | null; organizations: { id: string; name: string } | { id: string; name: string }[] | null;
};
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export default async function AdminReport({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await getSession();
  const { data } = await supabase
    .from("reports")
    .select("id, title, period_label, content, status, pdf_path, pdf_error, job_id, created_at, approved_at, published_at, edited_at, projects(name), organizations(id, name)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const r = data as unknown as Row;
  const org = one(r.organizations);
  const content = normalise(r.content);
  const valid = checkReport(r.content);
  const job = r.job_id ? (await supabase.from("jobs").select("result").eq("id", r.job_id).maybeSingle()).data : null;
  const notes = ((job?.result ?? null) as { notes?: string } | null)?.notes ?? "";
  const html = reportDocument(content, { orgName: org?.name, dateLabel: monthYear(r.approved_at ?? r.published_at ?? new Date()), draft: r.status !== "published" });

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Reports", href: "/reports" }, { label: r.title }]}
        title={r.title}
        pills={
          <span className={`pill ${r.status === "published" ? "pill-good" : r.status === "approved" ? "pill-warn" : ""}`}>
            <span className="dot" />
            {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
          </span>
        }
        sub={
          <span>
            {[org?.name, one(r.projects)?.name, r.period_label].filter(Boolean).join(" · ")} · drafted {stamp(r.created_at)}
            {r.edited_at ? ` · edited ${stamp(r.edited_at)}` : ""}
            {r.published_at ? ` · published ${stamp(r.published_at)}` : ""}
          </span>
        }
      />
      {r.status === "approved" && r.pdf_error && (
        <Note tone="error">Approved but not published: {r.pdf_error}. Nothing reached the client. Press &quot;Retry publish&quot;.</Note>
      )}
      {!valid.ok && r.status !== "void" && (
        <Note tone="warn">Not publishable yet: {valid.error}</Note>
      )}
      {notes && (
        <p className="ok-note" role="note" style={{ marginBottom: 14 }}>
          <Icon name="sparkle" className="i-sm" />
          Drafter&apos;s note (only you see this): {notes}
        </p>
      )}
      <div className="grid-main" style={{ marginTop: 0 }}>
        <div className="col">
          <section className="panel panel-pad">
            <ReportEditor id={r.id} status={r.status} text={reportToText(content)} periodLabel={r.period_label} />
          </section>
        </div>
        <div className="col">
          <iframe className="sheet-frame" title={`Report ${r.title}`} srcDoc={html} sandbox="" style={{ minHeight: 900 }} />
        </div>
      </div>
    </>
  );
}
