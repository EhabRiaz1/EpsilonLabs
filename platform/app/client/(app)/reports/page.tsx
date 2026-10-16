import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/app/components/Icon";
import { Empty } from "@/app/components/Empty";
import { Note } from "@/app/components/Note";
import { portalContext } from "@/lib/portal-context";
import { dayMonthYear } from "@/lib/dates";
import { PortalHeader } from "../_ui/PortalHeader";
import { NoOrg } from "../_ui/NoOrg";

export const metadata: Metadata = { title: "Reports" };

type Row = { id: string; project_id: string; title: string; period_label: string; published_at: string };

export default async function ReportsList() {
  const { supabase, claims, org, projects, unread } = await portalContext();
  if (!org) return <NoOrg email={claims.email} />;
  const { data, error } = await supabase
    .from("reports")
    .select("id, project_id, title, period_label, published_at")
    .eq("org_id", org.orgId)
    .eq("status", "published")
    .order("published_at", { ascending: false });
  const rows = (data ?? []) as Row[];
  const name = new Map(projects.map((p) => [p.id, p.name]));
  return (
    <>
      <PortalHeader title="Reports" sub={`${org.name} · delivery reports and their PDFs`} unread={unread} canRequest={projects.length > 0} />
      {error ? (
        <Note retry>Reports couldn&apos;t be loaded.</Note>
      ) : rows.length === 0 ? (
        <section className="panel">
          <Empty icon="chart" title="No reports yet">
            <p>At the end of a release Ehab publishes a delivery report here: what changed, how it was verified, and what is still open.</p>
          </Empty>
        </section>
      ) : (
        <>
          <div className="eyebrow-t">
            Delivery reports <span className="c-3">· {rows.length}</span>
          </div>
          <div className="doc-list">
            {rows.map((r) => (
              <div key={r.id} className="panel doc">
                <span className="ic" aria-hidden="true">
                  <Icon name="chart" />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="k">{[name.get(r.project_id), r.period_label].filter(Boolean).join(" · ") || "Report"}</div>
                  <Link className="t stretch" href={`/reports/${r.id}`}>
                    {r.title}
                  </Link>
                  <div className="m">published {dayMonthYear(r.published_at)}</div>
                </div>
                <a className="btn btn-secondary btn-sm over" href={`/reports/${r.id}/pdf`} aria-label={`Download ${r.title} as PDF`}>
                  <Icon name="download" className="i-sm" />
                  PDF
                </a>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
