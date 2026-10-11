import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/app/components/Icon";
import { Money } from "@/app/components/Money";
import { firstName } from "@/lib/session";
import { portalContext } from "@/lib/portal-context";
import { invoicesOf, lastComments, peopleById, personName, ticketsOf, type Invoice, type Project, type Ticket } from "@/lib/portal";
import { clientStatus, isOpen, NEEDS_CLIENT, PRIORITY_LABEL, relativeDay, TYPE_LABEL } from "@/lib/tickets";
import { dayMonth, daysUntil, stamp } from "@/lib/dates";
import { splitMoney } from "@/lib/money";
import { initials } from "@/app/components/Shell";
import { OpenRequestButton, PortalHeader } from "./_ui/PortalHeader";
import { FanDeck, type FanCard } from "./_ui/FanDeck";
import { Gauge } from "./_ui/Gauge";
import { TicketRows, type TicketRow } from "./_ui/TicketRows";
import { NoOrg } from "./_ui/NoOrg";

export const metadata: Metadata = { title: "Home" };

function projectPill(p: Project, waiting: boolean): FanCard["pill"] {
  if (p.status === "paused") return { label: "Paused", tone: "pill-warn" };
  if (p.status === "done") return { label: "Delivered", tone: "" };
  if (waiting) return { label: "Needs review", tone: "pill-warn" };
  return { label: "On track", tone: "pill-good", live: true };
}

function invoiceCard(i: Invoice, now: Date): FanCard {
  const left = i.due_date ? daysUntil(i.due_date, now) : null;
  const overdue = i.status === "overdue" || (left !== null && left < 0);
  return {
    key: `i-${i.id}`,
    kind: "invoice",
    tone: "tone-amber",
    pill: { label: overdue ? "Overdue" : i.due_date ? `Due ${dayMonth(i.due_date)}` : "Issued", tone: "" },
    corner: `Invoice ${i.number ?? ""}`,
    title: i.project_label || "Invoice",
    sub: `${i.currency} · bank transfer or Wise`,
    footKey: "Status",
    footVal: left === null ? "Issued" : left > 1 ? `${left} days left` : left === 1 ? "Due tomorrow" : left === 0 ? "Due today" : `${-left} days overdue`,
    big: splitMoney(i.total, i.currency),
    href: `/invoices/${i.id}`,
  };
}

export default async function ClientHome() {
  const { supabase, claims, org, projects, unread } = await portalContext();
  if (!org) return <NoOrg email={claims.email} />;
  const now = new Date();

  let tickets: Ticket[] = [];
  let invoices: Invoice[] = [];
  let failed = false;
  try {
    [tickets, invoices] = await Promise.all([ticketsOf(supabase, org.orgId), invoicesOf(supabase, org.orgId)]);
  } catch (e) {
    console.error("client home:", e instanceof Error ? e.message : e);
    failed = true;
  }
  const open = tickets.filter((t) => isOpen(t.status));
  const waiting = open.filter((t) => NEEDS_CLIENT.has(t.status));
  const closed = tickets.length - open.length;
  const outstanding = invoices.filter((i) => i.status === "sent" || i.status === "overdue");
  const shown = open.slice(0, 20);
  const last = await lastComments(supabase, shown.map((t) => t.id));
  const people = await peopleById(supabase, [...shown.map((t) => t.author_id), ...[...last.values()].map((c) => c.actor)]);
  const attachCount = new Map<string, number>();
  if (shown.length) {
    const { data } = await supabase.from("files").select("ticket_id").in("ticket_id", shown.map((t) => t.id)).eq("status", "ready");
    for (const f of (data ?? []) as { ticket_id: string }[]) attachCount.set(f.ticket_id, (attachCount.get(f.ticket_id) ?? 0) + 1);
  }
  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  // the front card: the first active project; invoices to the right of the projects
  const main = projects.find((p) => p.status === "active") ?? projects[0] ?? null;
  const cards: FanCard[] = [
    ...projects.map((p): FanCard => ({
      key: `p-${p.id}`,
      kind: "project",
      tone: p.id === main?.id ? "tone-ink" : "",
      pill: projectPill(p, waiting.some((t) => t.project_id === p.id)),
      corner: "Project",
      title: p.name,
      sub: p.summary ?? `Started ${dayMonth(p.created_at)}`,
      footKey: "Next",
      footVal: p.next_milestone ? `${p.next_milestone}${p.next_milestone_on ? ` · ${dayMonth(p.next_milestone_on)}` : ""}` : "No milestone set",
      big: p.progress === null ? null : { whole: String(p.progress), dec: "%" },
    })),
    ...outstanding.slice(0, 3).map((i) => invoiceCard(i, now)),
  ];

  const upcoming = projects
    .filter((p) => p.next_milestone_on && daysUntil(p.next_milestone_on, now) >= 0)
    .sort((a, b) => String(a.next_milestone_on).localeCompare(String(b.next_milestone_on)))[0];
  const currencies = [...new Set(outstanding.map((i) => i.currency))];
  const outstandingTotal = outstanding.reduce((s, i) => s + Number(i.total), 0);
  const nextDue = outstanding.map((i) => i.due_date).filter((d): d is string => Boolean(d)).sort()[0];
  const need = waiting[0];
  const needLast = need ? last.get(need.id) : undefined;

  const rows: TicketRow[] = shown.map((t) => {
    const c = last.get(t.id);
    const files = attachCount.get(t.id) ?? 0;
    const who = personName(people, c?.actor, claims.sub);
    return {
      id: t.id,
      ref: t.ref,
      title: t.title,
      sub: [TYPE_LABEL[t.type] ?? t.type, files ? `${files} attachment${files > 1 ? "s" : ""}` : "", t.priority === "urgent" ? "urgent" : ""].filter(Boolean).join(" · "),
      project: projectName.get(t.project_id) ?? "",
      status: clientStatus(t.status),
      updated: relativeDay(t.updated_at, now),
      fields: [
        ["Type", TYPE_LABEL[t.type] ?? t.type],
        ["Opened", `${dayMonth(t.created_at)} · by ${personName(people, t.author_id, claims.sub)}`],
        ["Last update", stamp(t.updated_at)],
        ["Urgency", PRIORITY_LABEL[t.priority] ?? t.priority],
        ...(files ? ([["Attachments", String(files)]] as [string, string][]) : []),
      ],
      last: c ? { who, initials: initials(who === "You" ? (claims.email ?? "Y") : who.split(" · ")[0]), when: relativeDay(c.created_at, now), body: c.body } : null,
      waiting: NEEDS_CLIENT.has(t.status),
    };
  });

  return (
    <>
      <PortalHeader
        title={`Welcome back, ${firstName(claims)}`}
        sub={`${org.name} · ${open.length ? `${open.length} open request${open.length > 1 ? "s" : ""}` : "no open requests"}`}
        unread={unread}
        canRequest={projects.length > 0}
      />

      {failed && (
        <section className="panel panel-pad" style={{ marginBottom: 14 }}>
          <p className="c-bad t-13">Some of your data couldn&apos;t be loaded. Reload the page to try again.</p>
        </section>
      )}

      {projects.length === 0 ? (
        <section className="panel">
          <div className="empty">
            <div className="orb">
              <span className="wave" />
              <span className="wave" />
              <span className="core">
                <Icon name="folder" className="i-lg" />
              </span>
            </div>
            <h2 className="display">Your projects will appear here</h2>
            <p className="c-2" style={{ maxWidth: "40ch" }}>
              Once your first project starts you can follow its progress, raise requests and share files from this page.
            </p>
          </div>
        </section>
      ) : (
        <FanDeck cards={cards} initial={Math.max(0, cards.findIndex((c) => c.key === `p-${main?.id}`))} />
      )}

      <section className="kpi kpi-3" style={{ marginTop: 18 }} aria-label="At a glance">
        <div className="panel tile">
          <div className="l">
            <div className="k">Open tickets</div>
            <div className="v big num">{open.length}</div>
            <div className="d">{waiting.length ? `${waiting.length} waiting on you` : "none waiting on you"}</div>
          </div>
        </div>
        <div className="panel tile">
          <div className="l">
            <div className="k">Next milestone</div>
            {upcoming?.next_milestone_on ? (
              <>
                <div className="v big num">
                  {daysUntil(upcoming.next_milestone_on, now)}
                  <span className="dec"> {daysUntil(upcoming.next_milestone_on, now) === 1 ? "day" : "days"}</span>
                </div>
                <div className="d">
                  {upcoming.next_milestone ?? upcoming.name} · {dayMonth(upcoming.next_milestone_on)}
                </div>
              </>
            ) : (
              <>
                <div className="v big num c-3">–</div>
                <div className="d">none scheduled</div>
              </>
            )}
          </div>
        </div>
        <div className="panel tile">
          <div className="l">
            <div className="k">Outstanding</div>
            {outstanding.length === 0 ? (
              <>
                <div className="v big num">
                  0<span className="dec">.00</span>
                </div>
                <div className="d">nothing due</div>
              </>
            ) : (
              <>
                <div className="v big num">
                  {currencies.length === 1 ? <Money value={outstandingTotal} currency={currencies[0]} className="num" /> : `${outstanding.length} invoices`}
                </div>
                <div className="d">
                  {outstanding.length} invoice{outstanding.length > 1 ? "s" : ""}
                  {nextDue ? ` · due ${dayMonth(nextDue)}` : ""}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <div className="grid-main">
        <div className="col">
          {need ? (
            <section className="panel needs" aria-label="Needs your input">
              <div className="grow">
                <span className="pill pill-accent">
                  <span className="dot" />
                  Needs your input · since {dayMonth(need.updated_at)}
                </span>
                <h2>{need.title}</h2>
                <p>
                  {needLast ? `${needLast.body.slice(0, 180)}${needLast.body.length > 180 ? "…" : ""}` : `Ehab is waiting on your review of ${need.ref}.`}
                  {waiting.length > 1 ? ` (${waiting.length - 1} more waiting on you.)` : ""}
                </p>
              </div>
              <div className="actions">
                <Link className="btn btn-primary" href={`/tickets/${need.id}`}>
                  Review {need.ref}
                </Link>
                <OpenRequestButton className="btn btn-secondary">Ask a question</OpenRequestButton>
              </div>
            </section>
          ) : (
            <section className="panel needs" aria-label="Needs your input">
              <span className="avatar avatar-soft avatar-lg" aria-hidden="true">
                <Icon name="check" />
              </span>
              <div className="grow">
                <h2 style={{ marginTop: 0 }}>Nothing needs you right now</h2>
                <p>When Ehab needs a decision or a review from you, it shows here first.</p>
              </div>
            </section>
          )}
        </div>
        <div className="col">
          {main && (
            <section className="panel gauge-panel" aria-label={main.name}>
              <div className="row between">
                <h2 className="t-16" style={{ fontFamily: "var(--font-sans)", fontWeight: 600 }}>
                  {main.name}
                </h2>
                <span className={`pill ${projectPill(main, waiting.some((t) => t.project_id === main.id)).tone}`}>
                  <span className="dot" />
                  {projectPill(main, waiting.some((t) => t.project_id === main.id)).label}
                </span>
              </div>
              {main.progress !== null ? (
                <Gauge pct={main.progress} label="of the build complete" />
              ) : (
                <p className="c-3 t-13" style={{ marginTop: 10 }}>
                  Progress is shown here once the build starts.
                </p>
              )}
              <div className="ms">
                <div data-s="now">
                  <span className="d" />
                  {main.status === "done" ? "Delivered" : "In progress"}
                  <span className="when">now</span>
                </div>
                {main.next_milestone && (
                  <div>
                    <span className="d" />
                    {main.next_milestone}
                    <span className="when">{main.next_milestone_on ? dayMonth(main.next_milestone_on) : "date to be set"}</span>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </div>

      <section className="panel" id="tickets" style={{ marginTop: 14, overflow: "hidden" }}>
        <div className="panel-head">
          <h2>Open tickets</h2>
          <span className="c-3 t-13">{open.length ? `${open.length} open` : ""}</span>
          <Link className="btn btn-ghost btn-sm more" href="/tickets">
            All tickets
          </Link>
        </div>
        {rows.length ? (
          <TicketRows rows={rows} initiallyOpen={need?.id ?? null} />
        ) : (
          <div className="empty" style={{ padding: "40px 24px" }}>
            <div className="orb">
              <span className="wave" />
              <span className="wave" />
              <span className="core">
                <Icon name="ticket" className="i-lg" />
              </span>
            </div>
            <h2 className="display">No open tickets</h2>
            <p className="c-2" style={{ maxWidth: "36ch" }}>
              Bugs, changes and questions you raise show here with their status.
            </p>
            {projects.length > 0 && <OpenRequestButton className="btn btn-primary">New request</OpenRequestButton>}
          </div>
        )}
        <div className="panel-foot t-12 c-3">
          <span>{closed ? `${closed} closed` : "Nothing closed yet"}</span>
          <Link href="/tickets" className="c-2" style={{ marginLeft: "auto" }}>
            {closed ? "Closed tickets" : "Tickets"}
          </Link>
        </div>
      </section>
    </>
  );
}
