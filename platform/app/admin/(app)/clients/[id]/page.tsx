import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import { MenuButton } from "@/app/components/ShellControls";
import { initials } from "@/app/components/Shell";
import { getSession } from "@/lib/session";
import { dayMonth, dayMonthYear } from "@/lib/dates";
import { isOpen } from "@/lib/tickets";
import { InviteForm, ProjectForm, RowAction } from "../ClientForms";

export const metadata: Metadata = { title: "Client" };

type Team = {
  members: { user_id: string; email: string; name: string; role: string; joined_at: string }[];
  invites: { id: string; email: string; role: string; created_at: string; expires_at: string; state: string }[];
};
type Project = { id: string; name: string; status: string; summary: string | null; repo_path: string | null; progress: number | null; next_milestone: string | null; next_milestone_on: string | null };

export default async function ClientDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await getSession();
  const { data: org } = await supabase.from("organizations").select("id, name, slug, domain, status, is_test, created_at, companies(name)").eq("id", id).maybeSingle();
  if (!org) notFound();
  const [team, projects, tickets] = await Promise.all([
    supabase.rpc("org_team", { p_org_id: id }),
    // staff read repo_path through RLS (the column is not granted to clients)
    supabase.from("projects").select("id, name, status, summary, repo_path, progress, next_milestone, next_milestone_on").eq("org_id", id).order("created_at"),
    supabase.from("tickets").select("id, status").eq("org_id", id),
  ]);
  const t = (team.data ?? { members: [], invites: [] }) as Team;
  const ps = (projects.data ?? []) as Project[];
  const open = ((tickets.data ?? []) as { status: string }[]).filter((x) => isOpen(x.status)).length;
  const owners = t.members.filter((m) => m.role === "owner").length;
  const company = Array.isArray(org.companies) ? org.companies[0] : org.companies;

  return (
    <>
      <header className="page-head">
        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
          <MenuButton />
          <div>
            <h1 className="display">{org.name as string}</h1>
            <div className="sub">
              {[org.slug, org.domain, company?.name ? `CRM: ${company.name}` : null, `since ${dayMonthYear(org.created_at as string)}`].filter(Boolean).join(" · ")}
              {org.is_test ? " · test org" : ""}
            </div>
          </div>
        </div>
        <div className="actions-bar">
          <Link className="btn btn-secondary" href={`/tickets?org=${id}`}>
            <Icon name="ticket" className="i-sm" />
            {open} open ticket{open === 1 ? "" : "s"}
          </Link>
          <Link className="btn btn-ghost" href="/clients">
            <Icon name="arrowL" className="i-sm" />
            Clients
          </Link>
        </div>
      </header>

      <div className="grid-main" style={{ marginTop: 0 }}>
        <div className="col">
          <section className="panel">
            <div className="panel-head">
              <h2>Projects</h2>
              <span className="c-3 t-12 more">{ps.length}</span>
            </div>
            {ps.length === 0 && <p className="c-3 t-13" style={{ padding: "0 22px 12px" }}>No projects yet. Clients can raise requests once there is one.</p>}
            {ps.map((p) => (
              <details key={p.id} style={{ borderTop: "1px solid var(--line)" }}>
                <summary className="row" style={{ padding: "14px 22px", cursor: "pointer", listStyle: "none" }}>
                  <span className="grow">
                    <span className="w-600">{p.name}</span>
                    <span className="c-3 t-12" style={{ display: "block" }}>
                      {[p.status, p.progress !== null ? `${p.progress}%` : null, p.next_milestone ? `next: ${p.next_milestone}${p.next_milestone_on ? ` · ${dayMonth(p.next_milestone_on)}` : ""}` : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <Icon name="pencil" className="i-sm c-3" />
                </summary>
                <div style={{ padding: "4px 22px 20px" }}>
                  <ProjectForm
                    orgId={id}
                    p={{ id: p.id, name: p.name, status: p.status, summary: p.summary ?? "", repo_path: p.repo_path ?? "", progress: p.progress === null ? "" : String(p.progress), next_milestone: p.next_milestone ?? "", next_milestone_on: p.next_milestone_on ?? "" }}
                  />
                </div>
              </details>
            ))}
            <details style={{ borderTop: "1px solid var(--line)" }} open={ps.length === 0}>
              <summary className="row" style={{ padding: "14px 22px", cursor: "pointer", listStyle: "none" }}>
                <Icon name="plus" className="i-sm" />
                <span className="w-600">Add a project</span>
              </summary>
              <div style={{ padding: "4px 22px 20px" }}>
                <ProjectForm key={`new-${ps.length}`} orgId={id} p={{ id: null, name: "", status: "active", summary: "", repo_path: "", progress: "", next_milestone: "", next_milestone_on: "" }} />
              </div>
            </details>
          </section>
        </div>

        <div className="col">
          <section className="panel">
            <div className="panel-head">
              <h2>People</h2>
              <span className="c-3 t-12 more">{t.members.length}</span>
            </div>
            {team.error ? (
              <p className="c-bad t-13 panel-pad">Couldn&apos;t load the team.</p>
            ) : (
              <div className="list-rows" style={{ padding: "0 18px 8px" }}>
                {t.members.length === 0 && <p className="c-3 t-13" style={{ padding: "0 4px 8px" }}>Nobody yet. Invite the client&apos;s first owner below.</p>}
                {t.members.map((m) => (
                  <div key={m.user_id}>
                    <span className="avatar">{initials(m.name || m.email)}</span>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="w-600">{m.name || m.email.split("@")[0]}</span>
                      <span className="c-3 t-12 truncate" style={{ display: "block" }}>
                        {m.email} · {m.role} · {dayMonth(m.joined_at)}
                      </span>
                    </span>
                    {!(m.role === "owner" && owners <= 1) && (
                      <RowAction kind="remove" orgId={id} id={m.user_id} label="Remove" confirmText={`Remove ${m.email}? Their access ends straight away.`} />
                    )}
                  </div>
                ))}
              </div>
            )}
            {t.invites.length > 0 && (
              <>
                <div className="panel-head" style={{ paddingTop: 6 }}>
                  <h2 className="t-13">Invites</h2>
                </div>
                <div className="list-rows" style={{ padding: "0 18px 8px" }}>
                  {t.invites.slice(0, 12).map((i) => (
                    <div key={i.id}>
                      <span className="avatar avatar-soft" aria-hidden="true">
                        <Icon name="mail" className="i-sm" />
                      </span>
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="w-500 truncate" style={{ display: "block" }}>
                          {i.email}
                        </span>
                        <span className="c-3 t-12">
                          {i.role} · {i.state === "pending" ? `expires ${dayMonth(i.expires_at)}` : i.state}
                        </span>
                      </span>
                      {i.state === "pending" && <RowAction kind="revoke" orgId={id} id={i.id} label="Revoke" confirmText={`Revoke the invite for ${i.email}?`} />}
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="panel-pad" style={{ borderTop: "1px solid var(--line)" }}>
              <InviteForm orgId={id} />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
