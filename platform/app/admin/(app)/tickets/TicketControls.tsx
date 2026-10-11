"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import { eps } from "@/app/components/eps";
import { STATUSES, staffStatus } from "@/lib/tickets";
import { replyToTicket, sendNoteToClient, setTicketStatus, type TicketResult } from "./actions";

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
    <div className="stack" style={{ gap: 6 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <select className="select" aria-label="Status" value={next} onChange={(e) => setNext(e.target.value)} style={{ height: compact ? 36 : 40, minWidth: 150, width: "auto" }}>
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
  function send() {
    if (!body.trim()) return;
    if (mode === "client" && !window.confirm(`Send this reply to ${clientName}? They see it in the portal straight away.`)) return;
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
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
        }}
        placeholder={mode === "client" ? `${clientName} sees it in the portal and gets a notification.` : "Only you see internal notes."}
      />
      <div className="row between wrap" style={{ gap: 8 }}>
        <div className="seg" data-manual role="group" aria-label="Who sees it">
          <button type="button" aria-pressed={mode === "client"} onClick={() => setMode("client")}>
            To {clientName}
          </button>
          <button type="button" aria-pressed={mode === "internal"} onClick={() => setMode("internal")}>
            Internal note
          </button>
        </div>
        <button className="btn btn-primary btn-sm" type="button" disabled={pending || !body.trim()} onClick={send}>
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
  const [pending, start] = useTransition();
  const [r, setR] = useState<TicketResult>(undefined);
  return (
    <span className="row" style={{ gap: 8 }}>
      <button
        className="btn btn-ghost btn-sm"
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Send this internal note to the client as written?")) return;
          start(async () => {
            setR(await sendNoteToClient(ticketId, eventId));
            router.refresh();
          });
        }}
      >
        {pending ? <span className="spinner" /> : <Icon name="send" className="i-sm" />}
        Send to client
      </button>
      <Msg r={r} />
    </span>
  );
}

export function TimelineFilter({ children }: { children: React.ReactNode }) {
  const [f, setF] = useState<"all" | "client" | "internal">("all");
  return (
    <div data-tl-filter={f}>
      <div className="panel-head">
        <h2>Timeline</h2>
        <div className="seg more" data-manual role="group" aria-label="Show">
          {(["all", "client", "internal"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={f === v} onClick={() => setF(v)}>
              {v === "all" ? "All" : v === "client" ? "Client" : "Internal"}
            </button>
          ))}
        </div>
      </div>
      {children}
    </div>
  );
}
