"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import { ACCEPT } from "@/lib/files";
import { uploadAll } from "@/lib/upload-client";
import { addComment } from "../actions";

/** Reply on a ticket thread (add_ticket_comment): visible to the org and to Ehab. */
export function ThreadComposer({ ticketId, readOnly }: { ticketId: string; readOnly: boolean }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  if (readOnly) return <p className="c-3 t-13 composer">This ticket is closed. Raise a new request if something else comes up.</p>;
  function send() {
    if (!body.trim()) return;
    start(async () => {
      const r = await addComment(ticketId, body);
      setMsg(r ?? null);
      if (r?.ok) {
        setBody("");
        router.refresh();
      }
    });
  }
  return (
    <div className="composer">
      <label className="sr-only" htmlFor="reply">
        Your reply
      </label>
      <textarea
        className="textarea"
        id="reply"
        maxLength={10000}
        placeholder="Add a note or answer Epsilon's question. Everyone in your organisation can see it."
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
        }}
      />
      <div className="row between wrap" style={{ gap: 8 }}>
        <span className="hint">⌘↵ to send</span>
        <button className="btn btn-primary btn-sm" type="button" disabled={pending || !body.trim()} onClick={send}>
          {pending ? <span className="spinner" /> : <Icon name="send" className="i-sm" />}
          Send
        </button>
      </div>
      {msg?.error && (
        <p className="auth-error" role="alert" style={{ marginTop: 0 }}>
          <Icon name="alert" className="i-sm" />
          {msg.error}
        </p>
      )}
    </div>
  );
}

/** Attach files to a ticket (browser → Storage, see lib/upload-client.ts). */
export function AttachFiles({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await uploadAll(Array.from(list), { ticketId });
      const bad = res.filter((r) => !r.ok);
      setMsg(bad.length ? { error: bad.map((b) => (b.ok ? "" : b.error)).join(" ") } : { ok: "Attached." });
      if (bad.length < res.length) router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <label className="btn btn-secondary btn-sm" style={{ position: "relative", alignSelf: "flex-start" }} aria-disabled={busy}>
        {busy ? <span className="spinner" /> : <Icon name="clip" className="i-sm" />}
        {busy ? "Uploading" : "Attach files"}
        <input type="file" multiple accept={ACCEPT} disabled={busy} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
      </label>
      {msg?.error && (
        <span className="c-bad t-12" role="alert">
          {msg.error}
        </span>
      )}
      {msg?.ok && (
        <span className="c-good t-12" role="status">
          {msg.ok}
        </span>
      )}
    </div>
  );
}
