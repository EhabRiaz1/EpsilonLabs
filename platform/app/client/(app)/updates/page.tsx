import type { Metadata } from "next";
import { Icon } from "@/app/components/Icon";
import { UpdateBody } from "@/app/components/UpdateBody";
import { portalContext } from "@/lib/portal-context";
import { dayMonthYear } from "@/lib/dates";
import { PortalHeader } from "../_ui/PortalHeader";
import { NoOrg } from "../_ui/NoOrg";

export const metadata: Metadata = { title: "Updates" };

type Row = { id: string; project_id: string; title: string; body_md: string; source: string; published_at: string };

/** The project updates feed: weekly updates and posts Ehab published (RLS: published rows of this org only). */
export default async function UpdatesFeed() {
  const { supabase, claims, org, projects, unread } = await portalContext();
  if (!org) return <NoOrg email={claims.email} />;
  const { data, error } = await supabase
    .from("updates")
    .select("id, project_id, title, body_md, source, published_at")
    .eq("org_id", org.orgId)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(60);
  const rows = (data ?? []) as Row[];
  const name = new Map(projects.map((p) => [p.id, p.name]));
  return (
    <>
      <PortalHeader title="Updates" sub={`${org.name} · what changed, what's next, what we need from you`} unread={unread} canRequest={projects.length > 0} />
      {error && <section className="panel panel-pad"><p className="c-bad t-13">Updates couldn&apos;t be loaded. Reload to try again.</p></section>}
      {!error && rows.length === 0 && (
        <section className="panel">
          <div className="empty">
            <div className="orb"><span className="wave" /><span className="wave" /><span className="core"><Icon name="file" className="i-lg" /></span></div>
            <h2 className="display">No updates yet</h2>
            <p className="c-2" style={{ maxWidth: "40ch" }}>Ehab posts a short update on Fridays: done this week, what&apos;s next, and anything that needs you.</p>
          </div>
        </section>
      )}
      <div className="stack" style={{ gap: 14 }}>
        {rows.map((u) => (
          <article key={u.id} className="panel panel-pad">
            <div className="row between wrap" style={{ gap: 8, marginBottom: 10 }}>
              <div>
                <h2 className="t-16 w-600">{u.title}</h2>
                <div className="c-3 t-12">{name.get(u.project_id) ?? "Project"} · {dayMonthYear(u.published_at)}</div>
              </div>
              <span className="pill"><span className="dot" />{u.source === "weekly" ? "Weekly update" : "Update"}</span>
            </div>
            <UpdateBody md={u.body_md} />
          </article>
        ))}
      </div>
    </>
  );
}
