"use client";

import { useState, useTransition } from "react";
import { ask } from "@/app/components/Confirm";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import { eps } from "@/app/components/eps";
import { Note, type FormResult } from "@/app/components/Forms";
import { approveAndPublish, saveReport, voidReport } from "../actions";

/** The report in the editor's text format (lib/report-text.ts), plus Save / Approve & publish / Void. */
export function ReportEditor({ id, status, text, periodLabel }: { id: string; status: string; text: string; periodLabel: string }) {
  const router = useRouter();
  const [t, setT] = useState(text);
  const [label, setLabel] = useState(periodLabel);
  const [r, setR] = useState<FormResult>(undefined);
  const [pending, start] = useTransition();
  const editable = status === "draft" || status === "approved";
  const dirty = t !== text || label !== periodLabel;
  const run = (fn: () => Promise<FormResult>) =>
    start(async () => {
      let res: FormResult;
      try {
        res = await fn();
      } catch {
        res = { error: "Couldn't reach admin (a PDF render can take up to a minute). Reload to see whether it went through." };
      }
      setR(res);
      if (res?.ok) eps()?.toast(res.ok, { icon: "check" });
      router.refresh();
    });
  return (
    <div className="stack" style={{ gap: 10 }}>
      {editable ? (
        <>
          <div className="field">
            <label className="label" htmlFor="rep-label">Period label</label>
            <input className="input" id="rep-label" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <textarea className="textarea mono-ish" aria-label="Report" value={t} rows={28} spellCheck onChange={(e) => setT(e.target.value)} style={{ fontSize: 13, lineHeight: 1.55 }} />
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn btn-secondary" type="button" disabled={pending || !dirty} onClick={() => run(() => saveReport(id, label, t))}>
              Save draft
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={pending}
              onClick={async () => {
                if (!(await ask({ title: "Publish this report?", body: "The PDF is stored once and the client's team is emailed now. It can't be edited afterwards.", confirm: "Publish" }))) return;
                run(async () => {
                  if (dirty) {
                    const saved = await saveReport(id, label, t);
                    if (saved?.error) return saved;
                  }
                  return approveAndPublish(id);
                });
              }}
            >
              {pending ? <span className="spinner" /> : <Icon name="send" className="i-sm" />}
              {status === "approved" ? "Retry publish" : dirty ? "Save, approve & publish" : "Approve & publish"}
            </button>
            <button className="btn btn-ghost" type="button" disabled={pending} onClick={async () => { if (await ask({ title: "Void this report?", confirm: "Void", tone: "danger" })) run(() => voidReport(id)); }}>
              Void
            </button>
          </div>
          <p className="hint">
            Format: <code># Title</code>, <code>&gt; Subtitle</code>, <code>## Summary</code> (paragraphs), <code>## KPIs</code> (value | label), <code>## Measures</code> (measure | before | after),
            <code>## Section: Name</code> (intro lines, <code>! Root cause | text</code>, <code>item | outcome</code>, <code>+ item | outcome</code> for New), <code>## Verification</code> (claim | proof), <code>## Outstanding</code> (item | action).
          </p>
        </>
      ) : (
        <div className="row wrap" style={{ gap: 8 }}>
          {status === "published" && (
            <>
              <a className="btn btn-primary" href={`/reports/${id}/pdf`}><Icon name="download" className="i-sm" />Download PDF</a>
              <button className="btn btn-ghost" type="button" disabled={pending} onClick={async () => { if (await ask({ title: "Void this published report?", body: "The client stops seeing it.", confirm: "Void", tone: "danger" })) run(() => voidReport(id)); }}>
                Void
              </button>
            </>
          )}
        </div>
      )}
      <Note r={r} />
    </div>
  );
}
