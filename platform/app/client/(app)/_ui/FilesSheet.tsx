"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import { eps } from "@/app/components/eps";
import { ACCEPT, ALLOWED_TEXT, prettySize } from "@/lib/files";
import { uploadAll } from "@/lib/upload-client";

export type SheetFile = { id: string; name: string; size: number; when: string; where: string; ticket: boolean };
export type SheetInvoice = { id: string; number: string; label: string; when: string; hasPdf: boolean };

type Cat = "invoices" | "attachments" | "project";

/** Files slide-over (client-home.html): category cards, then a list; uploads go to the chosen project. */
export function FilesSheet({ files, invoices, projects }: { files: SheetFile[]; invoices: SheetInvoice[]; projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const [cat, setCat] = useState<Cat | null>(null);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);

  const attachments = files.filter((f) => f.ticket);
  const projectFiles = files.filter((f) => !f.ticket);
  const total = files.length + invoices.filter((i) => i.hasPdf).length;

  async function upload(list: FileList | null) {
    if (!list?.length || !projectId) return;
    setMsg(null);
    setBusy(`Uploading ${list.length}`);
    try {
      const res = await uploadAll(Array.from(list), { projectId });
      const bad = res.filter((r) => !r.ok);
      const good = res.length - bad.length;
      setMsg(bad.length ? { error: bad.map((b) => (b.ok ? "" : b.error)).join(" ") } : { ok: `${good} file${good > 1 ? "s" : ""} shared with Epsilon.` });
      if (good) {
        setCat("project");
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  const cards: { k: Cat; title: string; sub: string; preview?: boolean }[] = [
    { k: "invoices", title: "Invoices", sub: invoices.length ? `${invoices.length} issued${invoices.length > 1 ? ` · ${invoices[invoices.length - 1].number} to ${invoices[0].number}` : ` · ${invoices[0].number}`}` : "None issued yet", preview: invoices.length > 0 },
    { k: "attachments", title: "Attachments", sub: attachments.length ? `${attachments.length} file${attachments.length > 1 ? "s" : ""} · from tickets` : "Files added to tickets show here" },
    { k: "project", title: "Project files", sub: projectFiles.length ? `${projectFiles.length} file${projectFiles.length > 1 ? "s" : ""} · shared with Epsilon` : "Specs, photos, exports you share" },
  ];

  const list = cat === "attachments" ? attachments : cat === "project" ? projectFiles : [];

  return (
    <div className="sheet" id="sheet-files" role="dialog" aria-modal="true" aria-labelledby="files-title">
      <div className="sheet-head">
        {cat && (
          <button className="btn btn-ghost btn-icon" type="button" aria-label="Back to categories" onClick={() => setCat(null)}>
            <Icon name="chevL" />
          </button>
        )}
        <div className="grow">
          <h2 id="files-title">{cat ? cards.find((c) => c.k === cat)?.title : "Files"}</h2>
          <div className="c-3 t-13">{cat ? "Downloads are signed links that expire after a minute." : `Everything shared across your projects · ${total} file${total === 1 ? "" : "s"}`}</div>
        </div>
        <button className="btn btn-secondary btn-icon" type="button" aria-label="Close" onClick={() => eps()?.close("sheet-files")}>
          <Icon name="x" />
        </button>
      </div>
      <div className="sheet-body">
        {!cat && (
          <div className="cat">
            {cards.map((c) => (
              <button key={c.k} className={`catcard${c.preview ? " has-preview" : ""}`} type="button" style={{ border: 0, textAlign: "left", font: "inherit", color: "inherit" }} onClick={() => setCat(c.k)}>
                {c.preview && (
                  <div className="preview" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </div>
                )}
                <div>
                  <strong>{c.title}</strong>
                  <span>{c.sub}</span>
                </div>
                <Icon name="chevR" />
              </button>
            ))}
          </div>
        )}
        {cat === "invoices" &&
          (invoices.length ? (
            <div className="list-rows">
              {invoices.map((i) => (
                <a key={i.id} href={`/invoices/${i.id}`}>
                  <span className="avatar avatar-soft" aria-hidden="true">
                    <Icon name="receipt" className="i-sm" />
                  </span>
                  <span className="grow">
                    <span className="w-600 mono">{i.number}</span>
                    <span className="c-3 t-12" style={{ display: "block" }}>
                      {i.label} · issued {i.when}
                    </span>
                  </span>
                  <Icon name="chevR" className="i-sm c-3" />
                </a>
              ))}
            </div>
          ) : (
            <Empty icon="receipt" title="No invoices yet" body="Issued invoices appear here with their PDF." />
          ))}
        {(cat === "attachments" || cat === "project") &&
          (list.length ? (
            <div className="list-rows">
              {list.map((f) => (
                <a key={f.id} href={`/files/${f.id}`} download>
                  <span className="avatar avatar-soft" aria-hidden="true">
                    <Icon name="file" className="i-sm" />
                  </span>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="w-600 truncate" style={{ display: "block" }}>
                      {f.name}
                    </span>
                    <span className="c-3 t-12">
                      {f.where} · {prettySize(f.size)} · {f.when}
                    </span>
                  </span>
                  <Icon name="download" className="i-sm c-3" />
                </a>
              ))}
            </div>
          ) : (
            <Empty icon="layers" title={cat === "attachments" ? "No attachments yet" : "Nothing shared yet"} body={cat === "attachments" ? "Files you add to a request or a ticket thread land here." : `Upload a spec, a photo or an export. ${ALLOWED_TEXT}.`} />
          ))}
        {msg?.error && (
          <p className="auth-error" role="alert">
            <Icon name="alert" className="i-sm" />
            {msg.error}
          </p>
        )}
        {msg?.ok && (
          <p className="ok-note" role="status">
            <Icon name="check" className="i-sm" />
            {msg.ok}
          </p>
        )}
      </div>
      <div className="sheet-foot">
        {projects.length > 1 && (
          <select className="select" aria-label="Upload to project" value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ maxWidth: 200, height: 40 }}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <span className="c-3 t-12 grow">{projects.length ? "Up to 25 MB each." : "Uploads open once your first project starts."}</span>
        <label className={`btn btn-secondary${!projects.length || busy ? " disabled" : ""}`} aria-disabled={!projects.length || Boolean(busy)} style={{ position: "relative" }}>
          {busy ? <span className="spinner" /> : <Icon name="upload" />}
          {busy ?? "Upload"}
          <input type="file" multiple accept={ACCEPT} disabled={!projects.length || Boolean(busy)} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
        </label>
      </div>
    </div>
  );
}

function Empty({ icon, title, body }: { icon: "receipt" | "layers"; title: string; body: string }) {
  return (
    <div className="empty" style={{ padding: "40px 12px" }}>
      <div className="orb">
        <span className="wave" />
        <span className="wave" />
        <span className="core">
          <Icon name={icon} className="i-lg" />
        </span>
      </div>
      <h2 className="display">{title}</h2>
      <p className="c-2" style={{ maxWidth: "36ch" }}>
        {body}
      </p>
    </div>
  );
}
