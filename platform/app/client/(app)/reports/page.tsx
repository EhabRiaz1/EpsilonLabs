import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/app/components/Icon";
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
      <section className="panel">
        {error ? (
          <p className="c-bad t-13 panel-pad">Reports couldn&apos;t be loaded. Reload to try again.</p>
        ) : rows.length === 0 ? (
          <div className="empty">
            <div className="orb"><span className="wave" /><span className="wave" /><span className="core"><Icon name="chart" className="i-lg" /></span></div>
            <h2 className="display">No reports yet</h2>
            <p className="c-2" style={{ maxWidth: "40ch" }}>At the end of a release Ehab publishes a delivery report here: what changed, how it was verified, and what is still open.</p>
          </div>
        ) : (
          <div className="list-rows" style={{ padding: "8px 18px" }}>
            {rows.map((r) => (
              <div key={r.id}>
                <span className="avatar avatar-soft" aria-hidden="true"><Icon name="chart" className="i-sm" /></span>
                <Link className="grow" href={`/reports/${r.id}`} style={{ minWidth: 0, color: "inherit", textDecoration: "none" }}>
                  <span className="w-600">{r.title}</span>
                  <span className="c-3 t-12" style={{ display: "block" }}>{[name.get(r.project_id), r.period_label, `published ${dayMonthYear(r.published_at)}`].filter(Boolean).join(" · ")}</span>
                </Link>
                <a className="btn btn-secondary btn-sm" href={`/reports/${r.id}/pdf`}><Icon name="download" className="i-sm" />PDF</a>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
