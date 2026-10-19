import type { Metadata } from "next";
import { Empty } from "@/app/components/Empty";
import { Note } from "@/app/components/Note";
import { portalContext } from "@/lib/portal-context";
import { dayMonthYear } from "@/lib/dates";
import { PortalHeader } from "../_ui/PortalHeader";
import { NoOrg } from "../_ui/NoOrg";
import { UpdateCard } from "../_ui/UpdateCard";

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
      {error && <Note retry>Updates couldn&apos;t be loaded.</Note>}
      {!error && rows.length === 0 && (
        <section className="panel">
          <Empty icon="send" title="No updates yet">
            <p>Epsilon posts a short update on Fridays: done this week, what&apos;s next, and anything that needs you.</p>
          </Empty>
        </section>
      )}
      <div className="upd-list">
        {rows.map((u) => (
          <UpdateCard
            key={u.id}
            title={u.title}
            meta={`${u.source === "weekly" ? "weekly update" : "update"} · ${dayMonthYear(u.published_at)}`}
            md={u.body_md}
            aside={name.get(u.project_id) ? <span className="pill hide-m">{name.get(u.project_id)}</span> : undefined}
          />
        ))}
      </div>
    </>
  );
}
