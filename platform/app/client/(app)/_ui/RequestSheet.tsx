"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import { eps } from "@/app/components/eps";
import { ACCEPT, uploadCheck } from "@/lib/files";
import { PRIORITY_HINT, type Priority } from "@/lib/tickets";
import { uploadAll } from "@/lib/upload-client";
import { createTicket } from "../actions";

const KINDS: [string, string][] = [["bug", "Bug"], ["change", "Change"], ["question", "Question"], ["new", "Idea"]];
const URGENCY: [Priority, string][] = [["low", "Can wait"], ["normal", "This week"], ["urgent", "Urgent"]];

type Done = { ref: string; id: string; project: string; kind: string; failed: string[] };

/** "New request" bottom sheet (client-home.html): what / where / type / urgency / description / attachments. */
export function RequestSheet({ projects }: { projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [kind, setKind] = useState("change");
  const [priority, setPriority] = useState<Priority>("low");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [where, setWhere] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [over, setOver] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next: File[] = [];
    const errs: string[] = [];
    for (const f of Array.from(list)) {
      const c = uploadCheck(f.name, f.size);
      if (c.ok) next.push(f);
      else errs.push(c.error);
    }
    setFiles((cur) => [...cur, ...next].slice(0, 10));
    setError(errs.length ? errs.join(" ") : null);
  }

  function reset() {
    setTitle("");
    setDescription("");
    setWhere("");
    setFiles([]);
    setError(null);
    setDone(null);
    setKind("change");
    setPriority("low");
  }

  function close() {
    eps()?.close("sheet-request");
    if (done) setTimeout(reset, 400);
  }

  async function send() {
    if (busy) return;
    if (!title.trim()) {
      setError("Give the request a one-line title.");
      titleRef.current?.focus();
      return;
    }
    setError(null);
    setBusy("Sending");
    try {
      const r = await createTicket({ projectId, title, type: kind, priority, description, where });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      let failed: string[] = [];
      if (files.length) {
        setBusy(`Uploading ${files.length} file${files.length > 1 ? "s" : ""}`);
        const res = await uploadAll(files, { ticketId: r.id });
        failed = res.filter((x) => !x.ok).map((x) => (x.ok ? "" : x.error));
      }
      setDone({ ref: r.ref, id: r.id, project: projects.find((p) => p.id === projectId)?.name ?? "", kind: KINDS.find((k) => k[0] === kind)?.[1] ?? kind, failed });
      eps()?.toast(`Request ${r.ref} sent · Ehab is notified`, { icon: "check" });
      router.refresh();
    } catch {
      setError("We couldn't send the request. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="sheet" id="sheet-request" role="dialog" aria-modal="true" aria-labelledby="req-title">
      <div className="sheet-head">
        <div className="grow">
          <h2 id="req-title">New request</h2>
          <div className="c-3 t-13">Goes to Ehab. You get a ticket number straight away.</div>
        </div>
        <button className="btn btn-secondary btn-icon" type="button" aria-label="Close" onClick={close}>
          <Icon name="x" />
        </button>
      </div>

      {done ? (
        <>
          <div className="sheet-body">
            <div className="success" role="status">
              <svg className="check-anim" viewBox="0 0 72 72" aria-hidden="true">
                <circle cx="36" cy="36" r="32" />
                <path d="M22 37l9 9 19-20" />
              </svg>
              <h3>
                Request <span className="mono">{done.ref}</span> created
              </h3>
              <p className="c-2 t-13" style={{ maxWidth: "34ch" }}>
                {done.project} · {done.kind.toLowerCase()}. Ehab sees it in his queue now and replies within two working days.
              </p>
              {done.failed.length > 0 && (
                <p className="auth-error" role="alert" style={{ textAlign: "left" }}>
                  <Icon name="alert" className="i-sm" />
                  {done.failed.join(" ")} You can attach it again from the ticket.
                </p>
              )}
            </div>
          </div>
          <div className="sheet-foot">
            <span className="c-3 t-12 grow">You can follow it under Tickets.</span>
            <a className="btn btn-secondary" href={`/tickets/${done.id}`}>
              Open {done.ref}
            </a>
            <button className="btn btn-primary" type="button" onClick={close}>
              Done
            </button>
          </div>
        </>
      ) : projects.length === 0 ? (
        <div className="sheet-body">
          <div className="empty" style={{ padding: "48px 12px" }}>
            <div className="orb">
              <span className="wave" />
              <span className="wave" />
              <span className="core">
                <Icon name="folder" className="i-lg" />
              </span>
            </div>
            <h2 className="display">No project to file it under yet</h2>
            <p className="c-2" style={{ maxWidth: "36ch" }}>
              Requests open once your first project starts. Until then, email er@epsilon-labs.co.
            </p>
          </div>
        </div>
      ) : (
        <>
          <form
            className="sheet-body"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
          >
            <div className="field">
              <span className="label" id="req-project-l">
                Project
              </span>
              <div className="seg seg-block" data-manual role="group" aria-labelledby="req-project-l" style={{ flexWrap: "wrap" }}>
                {projects.map((p) => (
                  <button key={p.id} type="button" aria-pressed={projectId === p.id} onClick={() => setProjectId(p.id)}>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="label" id="req-kind-l">
                What kind of request
              </span>
              <div className="seg seg-block" data-manual role="group" aria-labelledby="req-kind-l">
                {KINDS.map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={kind === v} onClick={() => setKind(v)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="req-title-in">
                Title
              </label>
              <input ref={titleRef} className="input" id="req-title-in" maxLength={200} placeholder="One line, e.g. Export recipes as CSV" autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field">
              <label className="label" htmlFor="req-what">
                What do you need?
              </label>
              <textarea className="textarea" id="req-what" maxLength={19000} placeholder="What happens today, what should happen instead, and who it affects." value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="field">
              <label className="label" htmlFor="req-where">
                Where in the product
              </label>
              <input className="input" id="req-where" maxLength={300} placeholder="Screen, machine, site or report" autoComplete="off" value={where} onChange={(e) => setWhere(e.target.value)} />
              <span className="hint">Optional. Helps us reproduce it first time.</span>
            </div>
            <div className="field">
              <span className="label" id="req-urgency-l">
                How urgent
              </span>
              <div className="seg seg-block" data-manual role="group" aria-labelledby="req-urgency-l">
                {URGENCY.map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={priority === v} onClick={() => setPriority(v)}>
                    {l}
                  </button>
                ))}
              </div>
              <span className="hint">{PRIORITY_HINT[priority]}</span>
            </div>
            <div className="field">
              <span className="label">Attachments</span>
              <label
                className="drop"
                data-over={over ? "" : undefined}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(false);
                  addFiles(e.dataTransfer.files);
                }}
              >
                <input type="file" multiple accept={ACCEPT} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
                <Icon name="clip" className="i-sm" />
                &nbsp; Drop files or click to choose · up to 25 MB
              </label>
              {files.length > 0 && (
                <div className="chips">
                  {files.map((f, i) => (
                    <div key={`${f.name}-${i}`}>
                      <Icon name="file" className="i-sm" />
                      <span className="grow">{f.name}</span>
                      <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}>
                        <Icon name="x" className="i-sm" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {error && (
              <p className="auth-error" role="alert" style={{ marginTop: 0 }}>
                <Icon name="alert" className="i-sm" />
                {error}
              </p>
            )}
          </form>
          <div className="sheet-foot">
            <span className="c-3 t-12 grow">Ehab replies within two working days.</span>
            <button className="btn btn-ghost" type="button" onClick={close}>
              Cancel
            </button>
            <button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={() => void send()}>
              {busy ? (
                <>
                  <span className="spinner" />
                  {busy}
                </>
              ) : (
                <>
                  Send request<span className="kbd">↵</span>
                </>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
