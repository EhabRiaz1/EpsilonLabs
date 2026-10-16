import type { ReactNode } from "react";
import { Shell, initials } from "@/app/components/Shell";
import { displayName } from "@/lib/session";
import { portalContext } from "@/lib/portal-context";
import { filesOf, invoicesOf } from "@/lib/portal";
import { dayMonth } from "@/lib/dates";
import { relativeDay } from "@/lib/tickets";
import { RequestSheet } from "./_ui/RequestSheet";
import { FilesSheet, type SheetFile, type SheetInvoice } from "./_ui/FilesSheet";
import { BellSheet, type Bell } from "./_ui/BellSheet";
import { DEMO_NAME } from "@/lib/demo";
import { NEEDS_CLIENT } from "@/lib/tickets";
import { ClientNav } from "./_ui/ClientNav";

/** On every screen of the demo portal (E3). */
function DemoBanner() {
  return (
    <div className="demo-banner" role="note">
      <span>DEMO · sample data. Northwind Industrial is a fictional company; nothing here can be changed.</span>
      <a href="https://epsilon-labs.co/start/">Start a real project</a>
    </div>
  );
}

export default async function ClientAppLayout({ children }: { children: ReactNode }) {
  const { supabase, claims, org, projects, notifications } = await portalContext();
  const demo = Boolean(org?.isDemo);
  // visitors share the demo login, so its Auth metadata is never shown
  const name = demo ? DEMO_NAME : displayName(claims);
  const now = new Date();

  let sheetFiles: SheetFile[] = [];
  let sheetInvoices: SheetInvoice[] = [];
  if (org) {
    const [files, invoices] = await Promise.all([filesOf(supabase, org.orgId), invoicesOf(supabase, org.orgId)]);
    const ticketIds = [...new Set(files.map((f) => f.ticket_id).filter((x): x is string => Boolean(x)))];
    const refs = new Map<string, string>();
    if (ticketIds.length) {
      const { data } = await supabase.from("tickets").select("id, ref").in("id", ticketIds.slice(0, 200));
      for (const t of (data ?? []) as { id: string; ref: string }[]) refs.set(t.id, t.ref);
    }
    const projectName = new Map(projects.map((p) => [p.id, p.name]));
    sheetFiles = files.map((f) => ({
      id: f.id,
      name: f.name,
      size: Number(f.size),
      when: dayMonth(f.created_at),
      where: f.ticket_id ? (refs.get(f.ticket_id) ?? "Ticket") : (projectName.get(f.project_id ?? "") ?? "Project"),
      ticket: Boolean(f.ticket_id),
    }));
    sheetInvoices = invoices
      .filter((i) => i.number)
      .map((i) => ({ id: i.id, number: i.number as string, label: i.project_label || (i.kind === "credit_note" ? "Credit note" : "Invoice"), when: i.issued_at ? dayMonth(i.issued_at) : "", hasPdf: Boolean(i.pdf_path) }));
  }
  const bells: Bell[] = notifications.map((n) => ({ id: n.id, kind: n.kind, title: n.title, link: n.link, urgent: n.urgent, unread: !n.read_at, when: relativeDay(n.created_at, now) }));
  const projectChoices = projects.map((p) => ({ id: p.id, name: p.name }));
  const [retainer, waiting] = org
    ? await Promise.all([
        supabase.from("retainers").select("id").eq("org_id", org.orgId).neq("status", "ended").limit(1).then((r) => r.data?.length ?? 0),
        // the hot count on Tickets: requests waiting on the client
        supabase.from("tickets").select("id", { count: "exact", head: true }).eq("org_id", org.orgId).in("status", [...NEEDS_CLIENT]).then((r) => r.count ?? 0),
      ])
    : [0, 0];

  return (
    <Shell
      orgName="Epsilon Labs"
      orgHost={`${org?.name ?? "Your portal"} · client portal`}
      searchLabel="Search or jump to…"
      navigation={
        <ClientNav
          items={[
            { href: "/", label: "Home", icon: "home" },
            { href: "/tickets", label: "Tickets", icon: "ticket", ...(waiting ? { count: waiting, hot: true } : {}) },
            { href: "/updates", label: "Updates", icon: "send" },
            { href: "/reports", label: "Reports", icon: "chart" },
            ...(retainer ? [{ href: "/retainer", label: "Retainer", icon: "clock" as const }] : []),
          ]}
          files={org ? sheetFiles.length : null}
          more={[{ href: "/account", label: "Account & team", icon: "users" }]}
        />
      }
      user={{
        name,
        detail: demo ? "Read-only demo" : org ? `${org.role === "owner" ? "Owner" : "Member"} · ${org.name}` : (claims.email ?? ""),
        initials: initials(name),
      }}
      status={demo ? <span className="pill pill-warn"><span className="dot" />DEMO</span> : undefined}
      banner={demo ? <DemoBanner /> : undefined}
    >
      {children}
      {org && (
        <>
          <RequestSheet key={org.orgId} projects={projectChoices} />
          <FilesSheet key={`f-${org.orgId}`} files={sheetFiles} invoices={sheetInvoices} projects={projectChoices} />
        </>
      )}
      <BellSheet items={bells} />
    </Shell>
  );
}
