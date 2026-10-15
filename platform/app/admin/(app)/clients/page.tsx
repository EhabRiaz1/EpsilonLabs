import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/app/components/Icon";
import { PageHeader } from "@/app/components/PageHeader";
import { Empty } from "@/app/components/Empty";
import { Note } from "@/app/components/Note";
import { Money } from "@/app/components/Money";
import { Sheet } from "@/app/components/Sheet";
import { SheetButton } from "@/app/components/SheetButton";
import { getSession } from "@/lib/session";
import { dayMonth } from "@/lib/dates";
import { isOpen } from "@/lib/tickets";
import { tierLabel } from "@/lib/retainers";
import { CreateOrgForm } from "./ClientForms";

export const metadata: Metadata = { title: "Clients" };

type Org = { id: string; name: string; slug: string; domain: string | null; status: string; is_test: boolean; created_at: string; companies: { name: string } | { name: string }[] | null };

export default async function ClientsPage() {
  const { supabase } = await getSession();
  // RLS: staff (aal2); test-scope staff see is_test orgs only
  const [orgs, members, projects, tickets, invites, companies, retainers, invoices] = await Promise.all([
    supabase.from("organizations").select("id, name, slug, domain, status, is_test, created_at, companies(name)").order("created_at", { ascending: false }).limit(300),
    supabase.from("memberships").select("org_id").limit(5000),
    supabase.from("projects").select("org_id, status").limit(5000),
    supabase.from("tickets").select("org_id, status").limit(10000),
    supabase.from("invites").select("org_id").is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString()).limit(2000),
    supabase.from("companies").select("id, name").order("name").limit(800),
    supabase.from("retainers").select("org_id, tier").eq("status", "active").limit(1000),
    supabase.from("invoices").select("org_id, total, currency, status").eq("kind", "invoice").in("status", ["sent", "overdue"]).limit(2000),
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
  const retainer = new Map(((retainers.data ?? []) as { org_id: string; tier: string }[]).map((r) => [r.org_id, r.tier]));
  const owed = new Map<string, { sum: number; currency: string; overdue: boolean }>();
  for (const i of (invoices.data ?? []) as { org_id: string; total: number | string; currency: string; status: string }[]) {
    const o = owed.get(i.org_id) ?? { sum: 0, currency: i.currency, overdue: false };
    if (i.currency === o.currency) o.sum += Number(i.total);
    o.overdue ||= i.status === "overdue";
    owed.set(i.org_id, o);
  }
  const active = rows.filter((o) => o.status !== "archived").length;
  const openTotal = [...nOpen.values()].reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader
        title="Clients"
        sub={
          <>
            <span>
              {active} organisation{active === 1 ? "" : "s"}
            </span>
            <span aria-hidden="true">·</span>
            <span>{openTotal} open tickets</span>
            <span aria-hidden="true">·</span>
            <span>accepted proposals create one automatically</span>
          </>
        }
        actions={
          <SheetButton sheet="org-sheet" className="btn btn-primary">
            <Icon name="plus" className="i-sm" />
            New organisation
          </SheetButton>
        }
      />

      {orgs.error ? (
        <Note retry>Couldn&apos;t load organisations.</Note>
      ) : rows.length === 0 ? (
        <section className="panel">
          <Empty
            icon="users"
            title="No client organisations yet"
            action={
              <SheetButton sheet="org-sheet" className="btn btn-primary">
                <Icon name="plus" className="i-sm" />
                New organisation
              </SheetButton>
            }
          >
            <p>Create one for an existing client, or accept a proposal in the deal room.</p>
          </Empty>
        </section>
      ) : (
        <section className="panel table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Organisation</th>
                <th scope="col">People</th>
                <th scope="col" className="hide-m">Projects</th>
                <th scope="col">Open tickets</th>
                <th scope="col" className="hide-m">Retainer</th>
                <th scope="col" className="num-col">Outstanding</th>
                <th scope="col" className="hide-m">Since</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const company = Array.isArray(o.companies) ? o.companies[0] : o.companies;
                const due = owed.get(o.id);
                const tier = retainer.get(o.id);
                return (
                  <tr key={o.id} className={o.status === "archived" ? "dim" : undefined}>
                    <td>
                      <Link className="rowlink" href={`/clients/${o.id}`}>
                        <div className="w-600">
                          {o.name}{" "}
                          {o.is_test && (
                            <span className="pill pill-warn">
                              <span className="dot" />
                              Test
                            </span>
                          )}
                        </div>
                        <div className="c-3 t-12 truncate">{[o.domain, company?.name && company.name !== o.name ? `CRM: ${company.name}` : null].filter(Boolean).join(" · ") || o.slug}</div>
                      </Link>
                    </td>
                    <td className="t-13 mono-num">
                      {nMembers.get(o.id) ?? 0}
                      {nInvites.get(o.id) ? <span className="c-3"> · {nInvites.get(o.id)} invited</span> : null}
                    </td>
                    <td className="hide-m t-13 mono-num">{nProjects.get(o.id) ?? 0}</td>
                    <td className="t-13 mono-num">{nOpen.get(o.id) ?? 0}</td>
                    <td className="hide-m t-13">
                      {tier ? (
                        <span className="pill pill-good">
                          <span className="dot" />
                          {tierLabel(tier)}
                        </span>
                      ) : (
                        <span className="c-3">–</span>
                      )}
                    </td>
                    <td className="num-col">
                      {due && due.sum > 0 ? <Money value={due.sum} currency={due.currency} className={`money${due.overdue ? " c-bad" : ""}`} /> : <span className="c-3">–</span>}
                    </td>
                    <td className="hide-m c-3 t-12">{dayMonth(o.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <Sheet id="org-sheet" title="New organisation" sub="Then invite its people and add projects." wide>
        <CreateOrgForm companies={((companies.data ?? []) as { id: string; name: string }[]).map((c) => ({ id: c.id, name: c.name }))} />
      </Sheet>
    </>
  );
}
