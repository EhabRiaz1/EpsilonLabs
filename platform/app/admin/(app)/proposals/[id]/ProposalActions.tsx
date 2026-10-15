"use client";

import { useState, useTransition } from "react";
import { ask } from "@/app/components/Confirm";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import type { ActionState } from "../actions";
import { approveAndSend, copyLink, newVersion, resendLink, voidProposal } from "../actions";

type Kind = "send" | "copy" | "resend" | "void" | "version";

/** The buttons on a proposal. "Approve & send" is the founder's approval (F13). */
export function ProposalActions({ id, status, email }: { id: string; status: string; email: string }) {
  const router = useRouter();
  const [state, setState] = useState<ActionState>(undefined);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [, startTransition] = useTransition();
  const live = status === "sent" || status === "viewed";
  const editable = status === "draft" || status === "approved";

  async function run(kind: Kind, fn: (id: string) => Promise<ActionState>, confirmText?: string) {
    if (confirmText && !(await ask({ title: confirmText, tone: kind === "void" ? "danger" : "primary" }))) return;
    setBusy(kind);
    setState(undefined);
    try {
      const r = await fn(id);
      setState(r);
      if (r?.url && (kind === "copy" || kind === "send")) {
        try {
          await navigator.clipboard.writeText(r.url);
        } catch {
          // clipboard blocked: the link is shown below to copy by hand
        }
      }
      startTransition(() => router.refresh());
    } catch (e) {
      // redirect() from newVersion lands here as a navigation; anything else is a real failure
      if (!(e instanceof Error && /NEXT_REDIRECT/.test(e.message))) setState({ error: "That didn't work. Reload and try again." });
      else throw e;
    } finally {
      setBusy(null);
    }
  }

  const spin = (k: Kind, label: string) => (busy === k ? <><span className="spinner" />{label}</> : null);
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="actions-bar">
        {editable && (
          <button className="btn btn-primary" type="button" disabled={!!busy} onClick={() => run("send", approveAndSend, `Approve this exact version and email the link to ${email}?`)}>
            {spin("send", "Sending") ?? (
              <>
                <Icon name="send" className="i-sm" />
                Approve &amp; send
              </>
            )}
          </button>
        )}
        {live && (
          <>
            <button className="btn btn-secondary" type="button" disabled={!!busy} onClick={() => run("copy", copyLink)}>
              {spin("copy", "Copying") ?? (
                <>
                  <Icon name="clip" className="i-sm" />
                  Copy link
                </>
              )}
            </button>
            <button className="btn btn-secondary" type="button" disabled={!!busy} onClick={() => run("resend", resendLink, `Email the link to ${email} again?`)}>
              {spin("resend", "Sending") ?? (
                <>
                  <Icon name="mail" className="i-sm" />
                  Email the link again
                </>
              )}
            </button>
          </>
        )}
        {status !== "accepted" && status !== "void" && status !== "declined" && (
          <button
            className="btn btn-danger"
            type="button"
            disabled={!!busy}
            onClick={() => run("void", voidProposal, live ? "Void this proposal? Its link stops working immediately." : "Void this draft?")}
          >
            {spin("void", "Voiding") ?? "Void"}
          </button>
        )}
        {!editable && status !== "accepted" && (
          <button className="btn btn-soft" type="button" disabled={!!busy} onClick={() => run("version", newVersion)}>
            {spin("version", "Creating") ?? (
              <>
                <Icon name="layers" className="i-sm" />
                New version
              </>
            )}
          </button>
        )}
      </div>
      {state?.error && (
        <p className="auth-error" role="alert" style={{ marginTop: 0 }}>
          <Icon name="alert" className="i-sm" />
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p className="ok-note" role="status">
          <Icon name="check" className="i-sm" />
          {state.ok}
        </p>
      )}
      {state?.url && (
        <input className="input mono" readOnly value={state.url} aria-label="Proposal link" onFocus={(e) => e.currentTarget.select()} />
      )}
    </div>
  );
}
