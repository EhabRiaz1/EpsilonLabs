"use client";

import { useState, useTransition } from "react";
import { ask } from "@/app/components/Confirm";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import { Note } from "@/app/components/Note";
import type { IntakeStatus } from "@/lib/intake";
import { convertToProposal, setIntakeStatus, type IntakeResult } from "./actions";

export function IntakeActions({ id, status, email }: { id: string; status: IntakeStatus; email: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [r, setR] = useState<IntakeResult>(undefined);

  async function run(kind: string, fn: () => Promise<IntakeResult>, confirmText?: string) {
    if (confirmText && !(await ask({ title: confirmText }))) return;
    setBusy(kind);
    start(async () => {
      try {
        const res = await fn();
        setR(res);
        router.refresh();
      } finally {
        setBusy(null);
      }
    });
  }
  const spin = (k: string) => (busy === k ? <span className="spinner" /> : null);

  return (
    <div className="stack gap-10">
      <div className="actions-bar">
        <button className="btn btn-primary" type="button" disabled={pending} onClick={() => run("convert", () => convertToProposal(id))}>
          {spin("convert") ?? <Icon name="file" className="i-sm" />}
          Convert to proposal
        </button>
        {status !== "contacted" && status !== "converted" && (
          <button className="btn btn-secondary" type="button" disabled={pending} onClick={() => run("contacted", () => setIntakeStatus(id, "contacted"))}>
            {spin("contacted") ?? <Icon name="check" className="i-sm" />}
            Mark contacted
          </button>
        )}
        <a className="btn btn-secondary" href={`mailto:${email}`}>
          <Icon name="mail" className="i-sm" />
          Reply by email
        </a>
        {status !== "new" && (
          <button className="btn btn-ghost" type="button" disabled={pending} onClick={() => run("new", () => setIntakeStatus(id, "new"))}>
            {spin("new") ?? <Icon name="undo" className="i-sm" />}
            Back to new
          </button>
        )}
        {status !== "spam" && (
          <button className="btn btn-danger" type="button" disabled={pending} onClick={() => run("spam", () => setIntakeStatus(id, "spam"), "Mark as spam? The lead this enquiry opened is closed as lost.")}>
            {spin("spam") ?? <Icon name="trash" className="i-sm" />}
            Spam
          </button>
        )}
      </div>
      {r?.error && <Note tone="error">{r.error}</Note>}
      {r?.ok && <Note tone="ok">{r.ok}</Note>}
    </div>
  );
}
