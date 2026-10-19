import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import { MenuButton } from "@/app/components/ShellControls";
import { portalContext } from "@/lib/portal-context";
import { peopleById, personName, TICKET_COLUMNS, type Ticket } from "@/lib/portal";
import { clientStatus, isOpen, NEEDS_CLIENT, PRIORITY_LABEL, TYPE_LABEL } from "@/lib/tickets";
import { clientPill } from "../../_ui/pill";
import { dayMonth, stamp } from "@/lib/dates";
import { prettySize } from "@/lib/files";
import { AttachFiles, ThreadComposer } from "../../_ui/ThreadComposer";

export const metadata: Metadata = { title: "Ticket" };

type Event = { id: string; kind: string; body: string | null; data: { from?: string; to?: string } | null; actor: string | null; created_at: string };
type File = { id: string; name: string; size: number; created_at: string; uploaded_by: string | null };

export default async function TicketThread({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, claims } = await portalContext();
  // RLS: members of the ticket's org; ticket_events only where client_visible
  const { data: t } = await supabase.from("tickets").select(`${TICKET_COLUMNS}, projects(name)`).eq("id", id).maybeSingle();
  if (!t) notFound();
  const ticket = t as Ticket & { projects: { name: string } | { name: string }[] | null };
  const project = Array.isArray(ticket.projects) ? ticket.projects[0] : ticket.projects;
  const [{ data: ev }, { data: fl }] = await Promise.all([
    supabase.from("ticket_events").select("id, kind, body, data, actor, created_at").eq("ticket_id", id).in("kind", ["status", "comment"]).order("created_at"),
    supabase.from("files").select("id, name, size, created_at, uploaded_by").eq("ticket_id", id).eq("status", "ready").order("created_at"),
  ]);
  const events = (ev ?? []) as Event[];
  const files = (fl ?? []) as File[];
  const people = await peopleById(supabase, [ticket.author_id, ...events.map((e) => e.actor), ...files.map((f) => f.uploaded_by)]);
  const who = (uid: string | null) => personName(people, uid, claims.sub);
  const status = clientStatus(ticket.status);

  type Item = { key: string; at: string; kind: "client" | "done" | "internal"; title: string; body?: string };
  const items: Item[] = [
    { key: "open", at: ticket.created_at, kind: "client" as const, title: `${who(ticket.author_id)} opened the ticket` },
    ...events.map((e): Item =>
      e.kind === "status"
        ? { key: e.id, at: e.created_at, kind: e.data?.to === "done" ? "done" : "internal", title: `Status → ${clientStatus(e.data?.to ?? "").label}` }
        : { key: e.id, at: e.created_at, kind: "client", title: who(e.actor), body: e.body ?? "" },
    ),
    ...files.map((f): Item => ({ key: f.id, at: f.created_at, kind: "client", title: `${who(f.uploaded_by)} attached ${f.name}` })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <>
      <div className="row" style={{ gap: 12, marginBottom: 6 }}>
        <MenuButton />
        <Link className="btn btn-ghost btn-sm" href="/tickets">
          <Icon name="arrowL" className="i-sm" />
          Requests
        </Link>
      </div>
      <header className="t-head">
        <div style={{ minWidth: 0 }}>
          <span className="t-ref">{ticket.ref}</span>
          <h1 style={{ overflowWrap: "anywhere" }}>{ticket.title}</h1>
          <div className="pills">
            <span className={`pill ${clientPill(status.tone, NEEDS_CLIENT.has(ticket.status))}`}>
              <span className="dot" />
              {status.label}
            </span>
            <span className="pill">{TYPE_LABEL[ticket.type] ?? ticket.type}</span>
            {project && <span className="pill">{project.name}</span>}
            <span className={`pill ${ticket.priority === "urgent" ? "pill-bad" : ""}`}>{PRIORITY_LABEL[ticket.priority] ?? ticket.priority}</span>
          </div>
        </div>
        <div className="opened">
          <strong>Opened {dayMonth(ticket.created_at)}</strong>
          by {who(ticket.author_id)} · updated {stamp(ticket.updated_at)}
        </div>
      </header>

      <div className="t-grid">
        <div className="col">
          <section className="panel">
            <div className="panel-head">
              <h2>The request</h2>
            </div>
            <div className="pane" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {ticket.body.trim() || <span className="c-3">No description.</span>}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Attachments</h2>
              <span className="c-3 t-12 more">{files.length ? `${files.length} file${files.length > 1 ? "s" : ""}` : ""}</span>
            </div>
            <div className="pane">
              {files.length ? (
                <div className="list-rows" style={{ marginBottom: 12 }}>
                  {files.map((f) => (
                    <a key={f.id} href={`/files/${f.id}`} download>
                      <Icon name="file" className="i-sm c-3" />
                      <span className="grow truncate">{f.name}</span>
                      <span className="c-3 t-12">{prettySize(Number(f.size))}</span>
                      <Icon name="download" className="i-sm c-3" />
                    </a>
                  ))}
                </div>
              ) : (
                <p className="c-3 t-13" style={{ marginBottom: 12 }}>
                  No files yet. Screenshots, exports or a photo of the screen help Epsilon reproduce it first time.
                </p>
              )}
              {isOpen(ticket.status) && <AttachFiles ticketId={ticket.id} />}
            </div>
          </section>
        </div>

        <aside className="col">
          <section className="panel">
            <div className="panel-head">
              <h2>Timeline</h2>
            </div>
            <ol className="tl" style={{ padding: "4px 22px 22px" }}>
              {items.map((it) => (
                <li key={it.key} data-kind={it.kind}>
                  <span className="tl-dot" />
                  <div className="tl-title">{it.title}</div>
                  {it.body !== undefined && (
                    <div className="comment" style={{ marginTop: 8 }}>
                      {it.body}
                    </div>
                  )}
                  <div className="tl-meta">{stamp(it.at)}</div>
                </li>
              ))}
            </ol>
          </section>
          <section className="panel" id="reply-panel">
            <div className="panel-head">
              <h2>Reply</h2>
              <span className="c-3 t-12 more">Epsilon replies within two working days</span>
            </div>
            <ThreadComposer ticketId={ticket.id} readOnly={!isOpen(ticket.status)} />
          </section>
        </aside>
      </div>
    </>
  );
}
