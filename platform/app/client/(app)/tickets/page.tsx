import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/app/components/Icon";
import { initials } from "@/app/components/Shell";
import { portalContext } from "@/lib/portal-context";
import { lastComments, peopleById, personName, ticketsOf, type Ticket } from "@/lib/portal";
import { clientStatus, isOpen, NEEDS_CLIENT, PRIORITY_LABEL, relativeDay, TYPE_LABEL } from "@/lib/tickets";
import { dayMonth, stamp } from "@/lib/dates";
import { PortalHeader } from "../_ui/PortalHeader";
import { TicketRows, type TicketRow } from "../_ui/TicketRows";
import { NoOrg } from "../_ui/NoOrg";

export const metadata: Metadata = { title: "Tickets" };

const VIEWS = [
  ["open", "Open"],
  ["waiting", "Waiting on you"],
  ["closed", "Closed"],
  ["all", "All"],
] as const;
type View = (typeof VIEWS)[number][0];

export default async function TicketsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view: raw } = await searchParams;
  const view: View = VIEWS.some(([v]) => v === raw) ? (raw as View) : "open";
  const { supabase, claims, org, projects, unread } = await portalContext();
  if (!org) return <NoOrg email={claims.email} />;
  const now = new Date();
  let all: Ticket[] = [];
  let failed = false;
  try {
    all = await ticketsOf(supabase, org.orgId, 500);
  } catch {
    failed = true;
  }
  const pick = (t: Ticket) =>
    view === "open" ? isOpen(t.status) : view === "waiting" ? NEEDS_CLIENT.has(t.status) : view === "closed" ? !isOpen(t.status) : true;
  const list = all.filter(pick).slice(0, 100);
  const count = (v: View) => all.filter((t) => (v === "open" ? isOpen(t.status) : v === "waiting" ? NEEDS_CLIENT.has(t.status) : v === "closed" ? !isOpen(t.status) : true)).length;
  const last = await lastComments(supabase, list.map((t) => t.id));
  const people = await peopleById(supabase, [...list.map((t) => t.author_id), ...[...last.values()].map((c) => c.actor)]);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const rows: TicketRow[] = list.map((t) => {
    const c = last.get(t.id);
    const who = personName(people, c?.actor, claims.sub);
    return {
      id: t.id,
      ref: t.ref,
      title: t.title,
      sub: [TYPE_LABEL[t.type] ?? t.type, t.priority === "urgent" ? "urgent" : ""].filter(Boolean).join(" · "),
      project: projectName.get(t.project_id) ?? "",
      status: clientStatus(t.status),
      updated: relativeDay(t.updated_at, now),
      fields: [
        ["Type", TYPE_LABEL[t.type] ?? t.type],
        ["Opened", `${dayMonth(t.created_at)} · by ${personName(people, t.author_id, claims.sub)}`],
        ["Last update", stamp(t.updated_at)],
        ["Urgency", PRIORITY_LABEL[t.priority] ?? t.priority],
      ],
      last: c ? { who, initials: initials(who === "You" ? (claims.email ?? "Y") : who.split(" · ")[0]), when: relativeDay(c.created_at, now), body: c.body } : null,
      waiting: NEEDS_CLIENT.has(t.status),
    };
  });

  return (
    <>
      <PortalHeader title="Tickets" sub={`${org.name} · every request and its status`} unread={unread} canRequest={projects.length > 0} />
      <section className="panel" style={{ overflow: "hidden" }}>
        <div className="q-head">
          <nav className="tabs" aria-label="Filter tickets">
            {VIEWS.map(([v, label]) => (
              <Link key={v} className="tab" href={v === "open" ? "/tickets" : `/tickets?view=${v}`} aria-current={view === v ? "page" : undefined}>
                {label} <span className="c-3">{count(v)}</span>
              </Link>
            ))}
          </nav>
        </div>
        {failed ? (
          <p className="c-bad t-13 panel-pad">Couldn&apos;t load tickets. Reload to retry.</p>
        ) : rows.length ? (
          <TicketRows rows={rows} />
        ) : (
          <div className="empty" style={{ padding: "48px 24px" }}>
            <div className="orb">
              <span className="wave" />
              <span className="wave" />
              <span className="core">
                <Icon name={view === "waiting" ? "check" : "ticket"} className="i-lg" />
              </span>
            </div>
            <h2 className="display">{view === "waiting" ? "Nothing waits on you" : view === "closed" ? "Nothing closed yet" : "No tickets here"}</h2>
            <p className="c-2" style={{ maxWidth: "36ch" }}>
              {view === "waiting" ? "When Ehab needs your review or a decision, the ticket shows here." : "Raise a bug, a change or a question with New request."}
            </p>
          </div>
        )}
      </section>
    </>
  );
}
