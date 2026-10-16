"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import { eps } from "@/app/components/eps";
import { ask } from "@/app/components/Confirm";
import { STATUSES, staffStatus } from "@/lib/tickets";
import { replyToTicket, sendDraftReply, sendNoteToClient, setTicketStatus, type TicketResult } from "./actions";

function Msg({ r }: { r: TicketResult }) {
  if (r?.error)
    return (
      <span className="c-bad t-12" role="alert">
        <Icon name="alert" className="i-sm" /> {r.error}
      </span>
    );
  return null;
}

/** Status change through set_ticket_status. "With client" (review) asks the client for input and flags it urgent. */
export function StatusControl({ id, status, compact }: { id: string; status: string; compact?: boolean }) {
  const router = useRouter();
  const [next, setNext] = useState(status);
  const [r, setR] = useState<TicketResult>(undefined);
  const [pending, start] = useTransition();
  return (
    <div className="stack g-6">
      <div className="row wrap g-8">
        <select className="select status-select" aria-label="Status" value={next} onChange={(e) => setNext(e.target.value)} data-compact={compact ? "" : undefined}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {staffStatus(s).label}
            </option>
          ))}
        </select>
        <button
          className={`btn ${compact ? "btn-sm btn-secondary" : "btn-primary"}`}
          type="button"
          disabled={pending || next === status}
          onClick={(e) => {
            e.stopPropagation();
            start(async () => {
              const res = await setTicketStatus(id, next);
              setR(res);
              if (res?.ok) eps()?.toast(`Status → ${staffStatus(next).label} · client notified`, { icon: "check" });
              router.refresh();
            });
          }}
        >
          {pending ? <span className="spinner" /> : null}
          Set status
        </button>
      </div>
      <Msg r={r} />
    </div>
  );
}

/** Reply composer (ticket.html): To client / Internal note. */
export function ReplyComposer({ id, clientName }: { id: string; clientName: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"client" | "internal">("client");
  const [body, setBody] = useState("");
  const [r, setR] = useState<TicketResult>(undefined);
  const [pending, start] = useTransition();
  async function send() {
    if (!body.trim()) return;
    if (mode === "client" && !(await ask({ title: `Send this reply to ${clientName}?`, body: "They see it in the portal straight away and get a notification.", confirm: "Send to client", icon: "send" }))) return;
    start(async () => {
      const res = await replyToTicket(id, body, mode === "client");
      setR(res);
      if (res?.ok) {
        setBody("");
        eps()?.toast(res.ok, { icon: mode === "client" ? "send" : "pencil" });
        router.refresh();
      }
    });
  }
  return (
    <div className="composer">
      <label className="sr-only" htmlFor="staff-reply">
        Reply
      </label>
      <textarea
        className="textarea"
        id="staff-reply"
        maxLength={10000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
        }}
        placeholder={mode === "client" ? `${clientName} sees it in the portal and gets a notification.` : "Only you see internal notes."}
      />
      <div className="row between wrap g-8">
        <div className="seg" data-manual role="group" aria-label="Who sees it">
          <button type="button" aria-pressed={mode === "client"} onClick={() => setMode("client")}>
            To {clientName}
          </button>
          <button type="button" aria-pressed={mode === "internal"} onClick={() => setMode("internal")}>
            Internal note
          </button>
        </div>
        <button className="btn btn-primary btn-sm" type="button" disabled={pending || !body.trim()} onClick={() => void send()}>
          {pending ? <span className="spinner" /> : <Icon name={mode === "client" ? "send" : "pencil"} className="i-sm" />}
          {mode === "client" ? "Send to client" : "Save note"}
        </button>
      </div>
      <span className="hint">You type it, you send it (F13). Fixed status messages go automatically.</span>
      <Msg r={r} />
    </div>
  );
}

export function SendNoteButton({ ticketId, eventId }: { ticketId: string; eventId: string }) {
  const router = useRouter();
  return (
    <span className="row g-8">
      <button
        className="btn btn-ghost btn-sm"
        type="button"
        onClick={async () => {
          // the dialog runs the send and stays open with the error if it fails
          if (await ask({ title: "Send this internal note to the client?", body: "It goes out as written; they see it in the portal.", confirm: "Send to client", icon: "send", run: () => sendNoteToClient(ticketId, eventId) }))
            router.refresh();
        }}
      >
        <Icon name="send" className="i-sm" />
        Send to client
      </button>
    </span>
  );
}

/** 017: a reply Claude Code drafted. "Send as reply" sends it as written; "Edit" opens it in place, then sends the
 *  edited text. Both go through send_draft_reply (publish_ticket_event: client-visible, notification, email digest). */
export function DraftReply({ ticketId, eventId, body, clientName, internal }: { ticketId: string; eventId: string; body: string; clientName: string; internal: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(body);
  async function send(edited: boolean) {
    const ok = await ask({
      title: `Send this reply to ${clientName}?`,
      body: "They see it in the portal straight away and get a notification.",
      confirm: "Send to client",
      icon: "send",
      run: () => sendDraftReply(ticketId, eventId, edited ? text : null),
    });
    if (ok) {
      setEditing(false);
      router.refresh();
    }
  }
  if (internal) return <span className="hint">Internal ticket: share it with the client before sending.</span>;
  return editing ? (
    <div className="stack g-6 draft-edit">
      <label className="sr-only" htmlFor={`draft-${eventId}`}>
        Edit the draft reply
      </label>
      <textarea className="textarea" id={`draft-${eventId}`} maxLength={10000} value={text} onChange={(e) => setText(e.target.value)} />
      <span className="row g-8">
        <button className="btn btn-primary btn-sm" type="button" disabled={!text.trim()} onClick={() => void send(true)}>
          <Icon name="send" className="i-sm" />
          Send edited reply
        </button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setText(body); setEditing(false); }}>
          Cancel
        </button>
      </span>
    </div>
  ) : (
    <span className="row g-8">
      <button className="btn btn-primary btn-sm" type="button" onClick={() => void send(false)}>
        <Icon name="send" className="i-sm" />
        Send as reply
      </button>
      <button className="btn btn-ghost btn-sm" type="button" onClick={() => setEditing(true)}>
        <Icon name="pencil" className="i-sm" />
        Edit
      </button>
    </span>
  );
}

/** The Timeline panel's All / Client / Internal filter. On phones the timeline sits behind a toggle under the reply
 *  box (design review: Reply first). */
export function TimelineFilter({ children, count }: { children: React.ReactNode; count?: number }) {
  const [f, setF] = useState<"all" | "client" | "internal">("all");
  const [shown, setShown] = useState(false);
  return (
    <div data-tl-filter={f} data-tl-shown={shown ? "" : undefined} className="tl-wrap">
      <div className="panel-head">
        <h2>
          Timeline{count !== undefined && <span className="c-3"> · {count}</span>}
        </h2>
        <div className="seg more tl-seg" data-manual role="group" aria-label="Show">
          {(["all", "client", "internal"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={f === v} onClick={() => setF(v)}>
              {v === "all" ? "All" : v === "client" ? "Client" : "Internal"}
            </button>
          ))}
        </div>
        <button className="btn btn-secondary btn-sm tl-toggle" type="button" aria-expanded={shown} onClick={() => setShown((x) => !x)}>
          {shown ? "Hide" : "Show"}
          <Icon name="chevD" className="i-sm" />
        </button>
      </div>
      <div className="tl-body">{children}</div>
    </div>
  );
}
