import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import { getSession } from "@/lib/session";
import { dayMonthYear } from "@/lib/dates";
import { normalise } from "@/lib/report-content";
import { monthYear, reportDocument } from "@/lib/report-template";

export const metadata: Metadata = { title: "Report" };

type Row = { id: string; title: string; period_label: string; content: unknown; published_at: string; organizations: { name: string } | { name: string }[] | null };

export default async function ClientReport({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await getSession();
  // RLS: published reports of the user's organisations only
  const { data } = await supabase.from("reports").select("id, title, period_label, content, published_at, approved_at, organizations(name)").eq("id", id).eq("status", "published").maybeSingle();
  if (!data) notFound();
  const r = data as unknown as Row & { approved_at: string | null };
  const org = Array.isArray(r.organizations) ? r.organizations[0] : r.organizations;
  const html = reportDocument(normalise(r.content), { orgName: org?.name, dateLabel: monthYear(r.approved_at ?? r.published_at) });
  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="display">{r.title}</h1>
          <div className="sub">{[r.period_label, `published ${dayMonthYear(r.published_at)}`].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="actions-bar">
          <Link className="btn btn-ghost" href="/reports"><Icon name="arrowL" className="i-sm" />Reports</Link>
          <a className="btn btn-primary" href={`/reports/${r.id}/pdf`}><Icon name="download" className="i-sm" />Download PDF</a>
        </div>
      </header>
      <iframe className="sheet-frame" title={`Report ${r.title}`} srcDoc={html} sandbox="" style={{ minHeight: 900 }} />
    </>
  );
}
