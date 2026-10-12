"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import { eps } from "@/app/components/eps";
import { Note, type FormResult } from "@/app/components/Forms";
import { publishUpdate, saveUpdate, skipUpdate } from "./actions";

/** One draft update: edit in place, then Publish (the only way it reaches the client), Save, or Skip. */
export function UpdateDraft({ id, title, body }: { id: string; title: string; body: string }) {
  const router = useRouter();
  const [t, setT] = useState(title);
  const [b, setB] = useState(body);
  const [reason, setReason] = useState("");
  const [r, setR] = useState<FormResult>(undefined);
  const [pending, start] = useTransition();
  const dirty = t !== title || b !== body;
  const run = (fn: () => Promise<FormResult>) =>
    start(async () => {
      let res: FormResult;
      try {
        res = await fn();
      } catch {
        res = { error: "Couldn't reach admin. Nothing was changed; try again." };
      }
      setR(res);
      if (res?.ok) eps()?.toast(res.ok, { icon: "check" });
      router.refresh();
    });
  return (
    <div className="stack" style={{ gap: 10 }}>
      <input className="input" aria-label="Title" value={t} maxLength={200} onChange={(e) => setT(e.target.value)} />
      <textarea className="textarea" aria-label="Update" value={b} rows={Math.min(18, Math.max(8, b.split("\n").length + 1))} onChange={(e) => setB(e.target.value)} />
      <div className="row wrap" style={{ gap: 8 }}>
        <button
          className="btn btn-primary"
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Publish this update to the client's portal? Their team is notified.")) return;
            run(async () => {
              if (dirty) {
                const saved = await saveUpdate(id, t, b);
                if (saved?.error) return saved;
              }
              return publishUpdate(id);
            });
          }}
        >
          {pending ? <span className="spinner" /> : <Icon name="send" className="i-sm" />}
          {dirty ? "Save and publish" : "Publish"}
        </button>
        <button className="btn btn-secondary" type="button" disabled={pending || !dirty} onClick={() => run(() => saveUpdate(id, t, b))}>
          Save draft
        </button>
        <input className="input" style={{ maxWidth: 220 }} aria-label="Skip reason" placeholder="Skip reason (optional)" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="btn btn-danger" type="button" disabled={pending} onClick={() => run(() => skipUpdate(id, reason))}>
          Skip
        </button>
      </div>
      <p className="hint">Sections: ## Done this week · ## Next · ## Needs your input. Lines starting with &quot;- &quot; are bullets; **bold** works.</p>
      <Note r={r} />
    </div>
  );
}
