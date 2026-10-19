import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/app/components/Icon";
import { Empty } from "@/app/components/Empty";
import { Note } from "@/app/components/Note";
import { firstName } from "@/lib/session";
import { portalContext } from "@/lib/portal-context";
import { invoicesOf, lastComments, peopleById, personName, ticketsOf, type Invoice, type Project, type Ticket } from "@/lib/portal";
import { clientStatus, isOpen, NEEDS_CLIENT, PRIORITY_LABEL, relativeDay, TYPE_LABEL } from "@/lib/tickets";
import { dayMonth, daysUntil, greeting, longDate, stamp } from "@/lib/dates";
import { splitMoney } from "@/lib/money";
import { hm, type Usage } from "@/lib/retainers";
import { initials } from "@/app/components/Shell";
import { OpenRequestButton, PortalHeader } from "./_ui/PortalHeader";
import { TicketRows, type TicketRow } from "./_ui/TicketRows";
import { UpdateCard } from "./_ui/UpdateCard";
import { NoOrg } from "./_ui/NoOrg";

export const metadata: Metadata = { title: "Home" };

type Report = { id: string; title: string; period_label: string; published_at: string };
type Update = { id: string; title: string; body_md: string; source: string; published_at: string };

function projectPill(p: Project): { label: string; tone: string; live?: boolean } {
  if (p.status === "paused") return { label: "Paused", tone: "pill-warn" };
  if (p.status === "done") return { label: "Delivered", tone: "" };
  return { label: "On track", tone: "pill-good", live: true };
}

/** The milestone list: only what the project row records (started, delivered, the next milestone). */
function milestones(p: Project): { key: string; s: "done" | "now" | ""; label: string; when: string }[] {
  const out: { key: string; s: "done" | "now" | ""; label: string; when: string }[] = [{ key: "start", s: "done", label: "Project started", when: dayMonth(p.created_at) }];
  if (p.status === "done") out.push({ key: "done", s: "done", label: "Delivered", when: "" });
  else if (p.next_milestone) out.push({ key: "next", s: "now", label: p.next_milestone, when: p.next_milestone_on ? dayMonth(p.next_milestone_on) : "date to be set" });
  else out.push({ key: "now", s: "now", label: p.status === "paused" ? "Paused" : "In progress", when: "now" });
  return out;
}

function addMonth(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
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
  // RLS: published reports and updates of this org only; the retainer RPC checks membership
  const [{ data: rep }, { data: upd }, { data: prof }, { data: ret }] = await Promise.all([
    supabase.from("reports").select("id, title, period_label, published_at").eq("org_id", org.orgId).eq("status", "published").order("published_at", { ascending: false }).limit(1),
    supabase.from("updates").select("id, title, body_md, source, published_at").eq("org_id", org.orgId).eq("status", "published").order("published_at", { ascending: false }).limit(1),
    supabase.from("profiles").select("timezone").eq("user_id", claims.sub).maybeSingle(),
    supabase.rpc("retainer_usage", { p_org_id: org.orgId, p_months: 1, p_today: null }),
  ]);
  const report = ((rep ?? []) as Report[])[0] ?? null;
  const update = ((upd ?? []) as Update[])[0] ?? null;
  const tz = (prof as { timezone?: string } | null)?.timezone || "Asia/Karachi";
  const usage = (ret ?? null) as Usage | null;
  const period = usage?.retainer ? (usage.periods.find((p) => p.current) ?? null) : null;

  const open = tickets.filter((t) => isOpen(t.status));
  const waiting = open.filter((t) => NEEDS_CLIENT.has(t.status));
  const closed = tickets.length - open.length;
  const outstanding = invoices
    .filter((i) => i.status === "sent" || i.status === "overdue")
    .sort((a, b) => String(a.due_date ?? "9999").localeCompare(String(b.due_date ?? "9999")));
  const shown = open.slice(0, 20);
  const last = await lastComments(supabase, shown.map((t) => t.id));
  const people = await peopleById(supabase, [...shown.map((t) => t.author_id), ...[...last.values()].map((c) => c.actor)]);
  const attachCount = new Map<string, number>();
  if (shown.length) {
    const { data } = await supabase.from("files").select("ticket_id").in("ticket_id", shown.map((t) => t.id)).eq("status", "ready");
    for (const f of (data ?? []) as { ticket_id: string }[]) attachCount.set(f.ticket_id, (attachCount.get(f.ticket_id) ?? 0) + 1);
  }
  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  const main = projects.find((p) => p.status === "active") ?? projects[0] ?? null;
  const others = projects.filter((p) => p.id !== main?.id);
  const need = waiting[0];
  const needLast = need ? last.get(need.id) : undefined;
  const invoice = outstanding[0] ?? null;

  const rows: TicketRow[] = shown.map((t) => {
    const c = last.get(t.id);
    const files = attachCount.get(t.id) ?? 0;
    const who = personName(people, c?.actor, claims.sub);
    return {
      id: t.id,
      ref: t.ref,
      title: t.title,
      sub: [(TYPE_LABEL[t.type] ?? t.type).toLowerCase(), files ? `${files} attachment${files > 1 ? "s" : ""}` : "", t.priority === "urgent" ? "urgent" : ""].filter(Boolean).join(" · "),
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

  const invoiceLeft = invoice?.due_date ? daysUntil(invoice.due_date, now) : null;
  const invoiceOverdue = invoice ? invoice.status === "overdue" || (invoiceLeft !== null && invoiceLeft < 0) : false;
  const money = invoice ? splitMoney(invoice.total, invoice.currency) : null;

  return (
    <>
      <PortalHeader
        title={org.isDemo ? "Welcome to the demo portal" : `${greeting(now, tz)}, ${firstName(claims)}`}
        sub={`${longDate(now, tz)} · ${org.name} · ${open.length ? `${open.length} open request${open.length > 1 ? "s" : ""}` : "no open requests"}`}
        unread={unread}
        canRequest={projects.length > 0}
      />

      {failed && <Note retry>Some of your data couldn&apos;t be loaded.</Note>}

      <div className="eyebrow-t">
        Needs you <span className="c-3">· {waiting.length}</span>
      </div>
      {need ? (
        <section className="panel needs-c" aria-label="Needs your input">
          <div>
            <span className="tag">
              <span className="dot" />
              Waiting on you · since {relativeDay(need.updated_at, now).toLowerCase()}
            </span>
            <h2>{need.title}</h2>
            <p>
              {needLast ? `${needLast.body.slice(0, 180)}${needLast.body.length > 180 ? "…" : ""}` : (
                <>
                  Epsilon is waiting on your review of <span className="mono">{need.ref}</span>. Approve it, or tell us what to change.
                </>
              )}
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
        <section className="panel needs-c calm" aria-label="Needs your input">
          <div>
            <h2>Nothing needs you right now</h2>
            <p>When Epsilon needs a decision or a review from you, it shows here first.</p>
          </div>
        </section>
      )}

      <div className="eyebrow-t">{projects.length > 1 ? "Your projects" : "Your project"}</div>
      {!main ? (
        <section className="panel">
          <Empty icon="folder" title="Your projects will appear here">
            <p>Once your first project starts you can follow its progress, raise requests and share files from this page.</p>
          </Empty>
        </section>
      ) : (
        <div className="hero">
          <section className="panel proj-c" aria-label={main.name}>
            <div className="top">
              <div style={{ minWidth: 0 }}>
                <h3>{main.name}</h3>
                {main.summary && <div className="sub">{main.summary}</div>}
              </div>
              {(() => {
                const pill = projectPill(main);
                return (
                  <span className={`pill ${pill.tone}`}>
                    <span className={pill.live ? "dot live" : "dot"} />
                    {pill.label}
                  </span>
                );
              })()}
            </div>
            {main.progress !== null ? (
              <>
                <div className="prog">
                  <span className="pct">
                    {main.progress}
                    <small>%</small>
                  </span>
                  <span className="lbl">complete</span>
                </div>
                <div className="bar-t" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={main.progress} aria-label={`${main.name} progress`}>
                  <i style={{ width: `${Math.max(0, Math.min(100, main.progress))}%` }} />
                </div>
              </>
            ) : (
              <p className="prog-none">Progress shows here once the build starts.</p>
            )}
            <div className="ms-t">
              {milestones(main).map((m) => (
                <div key={m.key} data-s={m.s || undefined}>
                  <span className="d" />
                  {m.label}
                  <span className="when">{m.when}</span>
                </div>
              ))}
            </div>
            {others.length > 0 && (
              <div className="proj-more">
                {others.map((p) => {
                  const pill = projectPill(p);
                  return (
                    <div key={p.id}>
                      <span className="grow truncate">{p.name}</span>
                      {p.progress !== null && <span className="mono c-3">{p.progress}%</span>}
                      <span className={`pill ${pill.tone}`}>
                        <span className="dot" />
                        {pill.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <div className="stack-c">
            {report ? (
              <div className="panel doc">
                <span className="ic" aria-hidden="true">
                  <Icon name="chart" />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="k">Latest report</div>
                  <Link className="t stretch" href={`/reports/${report.id}`}>
                    {report.title}
                  </Link>
                  <div className="m">{[report.period_label, `published ${dayMonth(report.published_at)}`].filter(Boolean).join(" · ")}</div>
                </div>
                <a className="btn btn-ghost btn-icon btn-sm over" href={`/reports/${report.id}/pdf`} aria-label={`Download ${report.title} as PDF`}>
                  <Icon name="download" className="i-sm" />
                </a>
              </div>
            ) : (
              <div className="panel doc quiet">
                <span className="ic" aria-hidden="true">
                  <Icon name="chart" />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="k">Latest report</div>
                  <div className="t">None yet</div>
                  <div className="m">published at the end of each release</div>
                </div>
              </div>
            )}

            {invoice && money ? (
              <Link className="panel doc" href={`/invoices/${invoice.id}`}>
                <span className="ic" aria-hidden="true">
                  <Icon name="receipt" />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="k">Invoice{invoice.number ? ` · ${invoice.number}` : ""}</div>
                  <div className="t">{invoice.project_label || "Invoice"}</div>
                  <div className="m">{outstanding.length > 1 ? `${outstanding.length} invoices open` : "bank transfer or Wise"}</div>
                </div>
                <div className="amt">
                  {money.whole}
                  <span className="dec">{money.dec}</span>
                  <small className={invoiceOverdue ? "c-bad" : undefined}>
                    {invoiceOverdue ? "overdue" : invoice.due_date ? `due ${dayMonth(invoice.due_date)}` : invoice.currency}
                  </small>
                </div>
              </Link>
            ) : (
              <div className="panel doc quiet">
                <span className="ic" aria-hidden="true">
                  <Icon name="receipt" />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="k">Invoices</div>
                  <div className="t">Nothing due</div>
                  <div className="m">{invoices.length ? `${invoices.length} in Files` : "none issued yet"}</div>
                </div>
              </div>
            )}

            {usage?.retainer && period && (
              <Link className="panel doc" href="/retainer">
                <span className="ic" aria-hidden="true">
                  <Icon name="clock" />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="k">Retainer · {new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(new Date(`${period.starts_on}T00:00:00Z`))}</div>
                  <div className="t">
                    {hm(period.used_minutes)} of {hm(period.included_minutes)} used
                  </div>
                  <div className="m">resets {dayMonth(addMonth(period.starts_on))}</div>
                </div>
                <div className="amt">
                  {Math.round(period.pct)}
                  <span className="dec">%</span>
                </div>
              </Link>
            )}
          </div>
        </div>
      )}

      {update && (
        <>
          <div className="eyebrow-t">
            {update.source === "weekly" ? "This week from Epsilon" : "Latest from Epsilon"} <span className="c-3">· {update.title}</span>
            <Link className="more" href="/updates">
              All updates →
            </Link>
          </div>
          <UpdateCard meta={`${update.source === "weekly" ? "weekly update" : "update"} · ${stamp(update.published_at, tz)}`} md={update.body_md} />
        </>
      )}

      <div className="eyebrow-t">
        Open requests <span className="c-3">· {open.length}</span>
        <Link className="more" href="/tickets">
          All tickets →
        </Link>
      </div>
      <section className="panel tk" id="tickets">
        {rows.length ? (
          <TicketRows rows={rows} />
        ) : (
          <Empty icon="ticket" title="No open requests" action={projects.length > 0 ? <OpenRequestButton className="btn btn-primary">New request</OpenRequestButton> : undefined}>
            <p>Bugs, changes and questions you raise show here with their status.</p>
          </Empty>
        )}
        <div className="panel-foot">
          <span>{closed ? `${closed} closed so far` : "Nothing closed yet"}</span>
          <Link href={closed ? "/tickets?view=closed" : "/tickets"} className="c-2" style={{ marginLeft: "auto" }}>
            {closed ? "Closed requests" : "Requests"}
          </Link>
        </div>
      </section>
    </>
  );
}
