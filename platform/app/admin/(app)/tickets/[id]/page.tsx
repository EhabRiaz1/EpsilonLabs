import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import { MenuButton } from "@/app/components/ShellControls";
import { getSession } from "@/lib/session";
import { peopleById } from "@/lib/portal";
import { clientStatus, PRIORITY_LABEL, staffStatus, TYPE_LABEL } from "@/lib/tickets";
import { dayMonth, stamp } from "@/lib/dates";
import { prettySize } from "@/lib/files";
import { ReplyComposer, SendNoteButton, StatusControl, TimelineFilter } from "../TicketControls";
import { TimePanel, type TimeEntry } from "../TimePanel";

export const metadata: Metadata = { title: "Ticket" };

type Ticket = {
  id: string; ref: string; org_id: string; title: string; body: string; type: string; priority: string; status: string; author_id: string | null;
  created_at: string; updated_at: string; organizations: { name: string } | { name: string }[] | null; projects: { name: string } | { name: string }[] | null;
};
type Event = { id: string; kind: string; body: string | null; data: { from?: string; to?: string } | null; client_visible: boolean; actor: string | null; created_at: string };
type File = { id: string; name: string; size: number; created_at: string; uploaded_by: string | null };
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export default async function AdminTicket({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await getSession();
  const { data } = await supabase
    .from("tickets")
    .select("id, ref, org_id, title, body, type, priority, status, author_id, created_at, updated_at, organizations(name), projects(name)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const t = data as Ticket;
  const [{ data: ev }, { data: fl }, { data: te }, { data: ret }] = await Promise.all([
    supabase.from("ticket_events").select("id, kind, body, data, client_visible, actor, created_at").eq("ticket_id", id).order("created_at"),
    supabase.from("files").select("id, name, size, created_at, uploaded_by").eq("ticket_id", id).eq("status", "ready").order("created_at"),
    supabase.from("time_entries").select("id, minutes, note, billable, worked_on").eq("ticket_id", id).order("worked_on", { ascending: false }).limit(100),
    supabase.from("retainers").select("id").eq("org_id", t.org_id).eq("status", "active").limit(1),
  ]);
  const events = (ev ?? []) as Event[];
  const files = (fl ?? []) as File[];
  const people = await peopleById(supabase, [t.author_id, ...events.map((e) => e.actor), ...files.map((f) => f.uploaded_by)]);
  const name = (uid: string | null) => (uid ? (people.get(uid)?.staff ? "You" : (people.get(uid)?.name ?? "Someone")) : "System");
  const author = people.get(t.author_id ?? "")?.name ?? "the client";
  const clientFirst = author.split(/\s+/)[0] || "the client";
  const org = one(t.organizations)?.name ?? "";
  const project = one(t.projects)?.name ?? "";
  const s = staffStatus(t.status);

  type Item = { key: string; at: string; vis: "client" | "internal"; kind: string; title: string; pill: string; body?: string; untrusted?: boolean; publish?: string };
  const items: Item[] = [
    { key: "open", at: t.created_at, vis: "client" as const, kind: "client", title: `${author} opened the ticket`, pill: "client" },
    ...events.map((e): Item => {
      const staffActor = Boolean(e.actor && people.get(e.actor)?.staff);
      if (e.kind === "status")
        return { key: e.id, at: e.created_at, vis: "client", kind: e.data?.to === "done" ? "done" : "client", title: `Status → ${staffStatus(e.data?.to ?? "").label} (client sees "${clientStatus(e.data?.to ?? "").label}")`, pill: "client · auto" };
      if (e.kind === "comment")
        return {
          key: e.id,
          at: e.created_at,
          vis: e.client_visible ? "client" : "internal",
          kind: e.client_visible ? "client" : "internal",
          title: staffActor ? (e.client_visible ? "You replied" : "Internal note") : `${name(e.actor)} commented`,
          pill: e.client_visible ? "client" : "internal",
          body: e.body ?? "",
          untrusted: !staffActor,
          publish: staffActor && !e.client_visible ? e.id : undefined,
        };
      return { key: e.id, at: e.created_at, vis: e.client_visible ? "client" : "internal", kind: "internal", title: e.kind, pill: e.client_visible ? "client" : "internal", body: e.body ?? undefined };
    }),
    ...files.map((f): Item => ({ key: f.id, at: f.created_at, vis: "client", kind: "client", title: `${name(f.uploaded_by)} attached ${f.name}`, pill: "client" })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const unanswered = (() => {
    const lastClient = [...items].reverse().find((i) => i.untrusted);
    const lastReply = [...items].reverse().find((i) => i.title === "You replied");
    return lastClient && (!lastReply || lastReply.at < lastClient.at) ? lastClient.key : null;
  })();

  return (
    <>
      <div className="row" style={{ gap: 12, marginBottom: 6 }}>
        <MenuButton />
        <Link className="btn btn-ghost btn-sm" href="/tickets">
          <Icon name="arrowL" className="i-sm" />
          Tickets
        </Link>
      </div>
      <header className="t-head">
        <div style={{ minWidth: 0 }}>
          <span className="mono c-3 t-13">
            {t.ref} · {org}
          </span>
          <h1 className="display" style={{ overflowWrap: "anywhere" }}>
            {t.title}
          </h1>
          <div className="pills">
            <span className={`pill ${s.tone}`}>
              <span className="dot" />
              {s.label}
            </span>
            <span className="pill">{TYPE_LABEL[t.type] ?? t.type}</span>
            {project && <span className="pill">{project}</span>}
            <span className={`pill ${t.priority === "urgent" ? "pill-bad" : ""}`}>{PRIORITY_LABEL[t.priority] ?? t.priority}</span>
          </div>
        </div>
        <div className="opened">
          <strong>Opened {dayMonth(t.created_at)}</strong>
          by {author} · updated {stamp(t.updated_at)}
        </div>
      </header>

      <div className="t-grid">
        <div className="col">
          <section className="panel">
            <div className="panel-head">
              <h2>Status</h2>
              <span className="c-3 t-12 more">client sees: {clientStatus(t.status).label}</span>
            </div>
            <div className="pane">
              <StatusControl id={t.id} status={t.status} />
              <p className="hint" style={{ marginTop: 10 }}>
                Every change is shown to {org} and notifies its people. &quot;With client&quot; asks them for input and is flagged urgent.
              </p>
            </div>
          </section>
          <TimePanel ticketId={t.id} entries={(te ?? []) as TimeEntry[]} hasRetainer={Boolean(ret?.length)} />
          <section className="panel">
            <div className="panel-head">
              <h2>Client request</h2>
              <Link className="btn btn-ghost btn-sm more" href={`/clients/${t.org_id}`}>
                {org}
              </Link>
            </div>
            <div className="pane">
              <div className="untrusted">
                <div className="untrusted-tag">
                  <Icon name="alert" className="i-sm" />
                  Untrusted client text · never reaches a session with tools
                </div>
                <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{t.body.trim() || "(no description)"}</div>
              </div>
              {files.length > 0 && (
                <div className="list-rows" style={{ marginTop: 12 }}>
                  {files.map((f) => (
                    <a key={f.id} href={`/files/${f.id}`} download>
                      <Icon name="clip" className="i-sm c-3" />
                      <span className="grow truncate">{f.name}</span>
                      <span className="c-3 t-12">
                        {prettySize(Number(f.size))} · {dayMonth(f.created_at)}
                      </span>
                      <Icon name="download" className="i-sm c-3" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="col">
          <section className="panel">
            <TimelineFilter>
              <ol className="tl" style={{ padding: "8px 22px 22px" }}>
                {items.map((it) => (
                  <li key={it.key} data-kind={it.kind} data-vis={it.vis}>
                    <span className="tl-dot" />
                    <div className="tl-title">{it.title}</div>
                    {it.body !== undefined &&
                      (it.untrusted ? (
                        <div className="untrusted" style={{ marginTop: 8 }}>
                          <div className="untrusted-tag">
                            <Icon name="alert" className="i-sm" />
                            untrusted
                          </div>
                          <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{it.body}</div>
                        </div>
                      ) : (
                        <div className="comment" style={{ marginTop: 8 }}>
                          {it.body}
                        </div>
                      ))}
                    <div className="tl-meta">
                      <span className={`tl-pill ${it.vis}`}>{it.pill}</span>
                      {stamp(it.at)}
                      {unanswered === it.key && <span className="c-warn">unanswered</span>}
                    </div>
                    {it.publish && <SendNoteButton ticketId={t.id} eventId={it.publish} />}
                  </li>
                ))}
              </ol>
            </TimelineFilter>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Reply to {clientFirst}</h2>
              <span className="c-3 t-12 more">Sent as Epsilon Labs</span>
            </div>
            <ReplyComposer id={t.id} clientName={clientFirst} />
          </section>
        </aside>
      </div>
    </>
  );
}
