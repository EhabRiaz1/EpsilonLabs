import type { Metadata } from "next";
import Link from "next/link";
import { Empty } from "@/app/components/Empty";
import { Note } from "@/app/components/Note";
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
    view === "open" ? isOpen(t.status) : view === "waiting" ? NEEDS_CLIENT.has(t.status) : !isOpen(t.status);
  const list = all.filter(pick).slice(0, 100);
  const count = (v: View) => all.filter((t) => (v === "open" ? isOpen(t.status) : v === "waiting" ? NEEDS_CLIENT.has(t.status) : !isOpen(t.status))).length;
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
      sub: [(TYPE_LABEL[t.type] ?? t.type).toLowerCase(), t.priority === "urgent" ? "urgent" : ""].filter(Boolean).join(" · "),
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

  const waitingCount = count("waiting");
  return (
    <>
      <PortalHeader
        title="Requests"
        sub={`${org.name} · ${count("open")} open${waitingCount ? ` · ${waitingCount} waiting on you` : ""}`}
        unread={unread}
        canRequest={projects.length > 0}
      />
      <section className="panel tk">
        <div className="tk-head">
          <nav className="tabs" aria-label="Filter requests">
            {VIEWS.map(([v, label]) => (
              <Link key={v} className="tab" href={v === "open" ? "/tickets" : `/tickets?view=${v}`} aria-current={view === v ? "page" : undefined}>
                {label} <span className="c-3">{count(v)}</span>
              </Link>
            ))}
          </nav>
        </div>
        {failed ? (
          <div className="panel-pad">
            <Note retry>Couldn&apos;t load your requests.</Note>
          </div>
        ) : rows.length ? (
          <TicketRows rows={rows} />
        ) : (
          <Empty icon={view === "waiting" ? "check" : "ticket"} title={view === "waiting" ? "Nothing waits on you" : view === "closed" ? "Nothing closed yet" : "No open requests"}>
            <p>{view === "waiting" ? "When Ehab needs your review or a decision, the request shows here." : "Raise a bug, a change or a question with New request."}</p>
          </Empty>
        )}
        <div className="panel-foot">
          <span>Ehab replies within two working days</span>
          {view !== "closed" && (
            <Link href="/tickets?view=closed" className="c-2" style={{ marginLeft: "auto" }}>
              Closed requests
            </Link>
          )}
        </div>
      </section>
    </>
  );
}
