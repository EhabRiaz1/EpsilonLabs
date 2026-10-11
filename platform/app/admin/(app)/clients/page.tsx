import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/app/components/Icon";
import { MenuButton } from "@/app/components/ShellControls";
import { getSession } from "@/lib/session";
import { dayMonth } from "@/lib/dates";
import { isOpen } from "@/lib/tickets";
import { CreateOrgForm } from "./ClientForms";

export const metadata: Metadata = { title: "Clients" };

type Org = { id: string; name: string; slug: string; domain: string | null; status: string; is_test: boolean; created_at: string; companies: { name: string } | { name: string }[] | null };

export default async function ClientsPage() {
  const { supabase } = await getSession();
  // RLS: staff (aal2); test-scope staff see is_test orgs only
  const [orgs, members, projects, tickets, invites, companies] = await Promise.all([
    supabase.from("organizations").select("id, name, slug, domain, status, is_test, created_at, companies(name)").order("created_at", { ascending: false }).limit(300),
    supabase.from("memberships").select("org_id").limit(5000),
    supabase.from("projects").select("org_id, status").limit(5000),
    supabase.from("tickets").select("org_id, status").limit(10000),
    supabase.from("invites").select("org_id").is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString()).limit(2000),
    supabase.from("companies").select("id, name").order("name").limit(800),
  ]);
  const rows = (orgs.data ?? []) as Org[];
  const tally = (list: { org_id: string }[]) => {
    const m = new Map<string, number>();
    for (const x of list) m.set(x.org_id, (m.get(x.org_id) ?? 0) + 1);
    return m;
  };
  const nMembers = tally(members.data ?? []);
  const nProjects = tally(((projects.data ?? []) as { org_id: string; status: string }[]).filter((p) => p.status !== "archived"));
  const nOpen = tally(((tickets.data ?? []) as { org_id: string; status: string }[]).filter((t) => isOpen(t.status)));
  const nInvites = tally(invites.data ?? []);

  return (
    <>
      <header className="page-head">
        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
          <MenuButton />
          <div>
            <h1 className="display">Clients</h1>
            <div className="sub">Organisations, their people and projects. Accepted proposals create one automatically.</div>
          </div>
        </div>
      </header>

      {orgs.error ? (
        <section className="panel panel-pad">
          <p className="c-bad t-13">Couldn&apos;t load organisations. Reload to retry.</p>
        </section>
      ) : rows.length === 0 ? (
        <section className="panel">
          <div className="empty" style={{ padding: "48px 24px" }}>
            <div className="orb">
              <span className="wave" />
              <span className="wave" />
              <span className="core">
                <Icon name="users" className="i-lg" />
              </span>
            </div>
            <h2 className="display">No client organisations yet</h2>
            <p className="c-2" style={{ maxWidth: "40ch" }}>
              Create one below for an existing client, or accept a proposal in the deal room.
            </p>
          </div>
        </section>
      ) : (
        <section className="panel table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Organisation</th>
                <th>People</th>
                <th className="hide-m">Projects</th>
                <th>Open tickets</th>
                <th className="hide-m">Since</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const company = Array.isArray(o.companies) ? o.companies[0] : o.companies;
                return (
                  <tr key={o.id} className={o.status === "archived" ? "dim" : undefined}>
                    <td>
                      <Link className="rowlink" href={`/clients/${o.id}`}>
                        <div className="w-600">
                          {o.name} {o.is_test && <span className="pill pill-warn">test</span>}
                        </div>
                        <div className="c-3 t-12 truncate">{[o.domain, company?.name && company.name !== o.name ? `CRM: ${company.name}` : null].filter(Boolean).join(" · ") || o.slug}</div>
                      </Link>
                    </td>
                    <td className="t-13">
                      {nMembers.get(o.id) ?? 0}
                      {nInvites.get(o.id) ? <span className="c-3"> · {nInvites.get(o.id)} invited</span> : null}
                    </td>
                    <td className="hide-m t-13">{nProjects.get(o.id) ?? 0}</td>
                    <td className="t-13">{nOpen.get(o.id) ?? 0}</td>
                    <td className="hide-m c-3 t-12">{dayMonth(o.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <section className="panel" style={{ marginTop: 14 }}>
        <div className="panel-head">
          <h2>New organisation</h2>
        </div>
        <div className="panel-pad" style={{ paddingTop: 4 }}>
          <CreateOrgForm companies={((companies.data ?? []) as { id: string; name: string }[]).map((c) => ({ id: c.id, name: c.name }))} />
        </div>
      </section>
    </>
  );
}
