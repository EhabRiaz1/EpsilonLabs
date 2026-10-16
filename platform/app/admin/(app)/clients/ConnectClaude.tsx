"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import { CopyButton } from "@/app/components/Forms";
import { Note } from "@/app/components/Note";
import { ask } from "@/app/components/Confirm";
import { dayMonth } from "@/lib/dates";
import { lastUsed } from "@/lib/claude-connect";
import { createProjectToken, revokeProjectToken } from "./token-actions";

export type ProjectToken = { id: string; project_id: string; label: string; created_at: string; last_used_at: string | null; revoked_at: string | null };

/** "Connect Claude Code" (017): a project token for the Epsilon MCP, shown once with the exact command to run in the
 *  project folder; the token list with last use and Revoke. The token reaches only this project. */
export function ConnectClaude({ orgId, projectId, folder, tokens, loadError }: { orgId: string; projectId: string; folder: string | null; tokens: ProjectToken[]; loadError: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(createProjectToken.bind(null, orgId, projectId, folder), undefined);
  const live = tokens.filter((t) => !t.revoked_at);
  const k = projectId;
  return (
    <div className="stack g-14 cc">
      <p className="c-2 t-13 m-0">
        A Claude Code session started in this project&apos;s folder can list its tickets, add internal notes, move status, log time and draft replies.
        Replies stay drafts for you to send unless you tell it to send. The token reaches only this project and acts as you; it can&apos;t approve anything.
      </p>
      {!folder && <Note tone="warn">No repo path on this project yet. The command works without it, but the session can&apos;t check it is in the right folder.</Note>}

      {state?.token && state.command ? (
        <div className="cc-once" role="status">
          <div className="row between wrap g-8">
            <span className="w-600">
              <Icon name="lock" className="i-sm" /> Shown once: copy it now
            </span>
            <CopyButton text={state.command} label="Copy command" />
          </div>
          <pre className="cc-cmd mono-ish">{state.command}</pre>
          <p className="hint m-0">
            Run it in Terminal on your Mac, then start <span className="mono">claude</span> there and say &quot;work the tickets&quot;. It uses the default local scope, so the token stays in your
            Claude Code config, never in the client&apos;s repo. Skill: run <span className="mono">epsilon-os/mcp/install.sh</span> once.
          </p>
        </div>
      ) : (
        <form action={action} className="row wrap g-8 ai-end">
          <div className="field flex-1 min-0">
            <label className="label" htmlFor={`cc-label-${k}`}>
              Label <span className="c-3">(which Mac or session)</span>
            </label>
            <input className="input" id={`cc-label-${k}`} name="label" maxLength={60} required placeholder="Ehab's MacBook" />
          </div>
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? <span className="spinner" /> : <Icon name="terminal" className="i-sm" />}
            Create token
          </button>
        </form>
      )}
      {state?.error && <Note>{state.error}</Note>}

      <div>
        <div className="row between cc-head">
          <span className="w-600 t-13">Tokens</span>
          <span className="c-3 t-12">{live.length} live · 600 calls / hour each</span>
        </div>
        {loadError ? (
          <Note retry>Couldn&apos;t load the tokens (is migration 017 applied?).</Note>
        ) : tokens.length === 0 ? (
          <p className="c-3 t-13 m-0">No tokens yet.</p>
        ) : (
          <div className="list-rows cc-list">
            {tokens.map((t) => (
              <div key={t.id} data-revoked={t.revoked_at ? "" : undefined}>
                <Icon name="terminal" className="i-sm c-3" />
                <span className="grow min-0">
                  <span className="truncate w-600 t-13">{t.label}</span>
                  <span className="c-3 t-12 cc-meta">
                    created {dayMonth(t.created_at)} · {t.revoked_at ? `revoked ${dayMonth(t.revoked_at)}` : lastUsed(t.last_used_at)}
                  </span>
                </span>
                {t.revoked_at ? (
                  <span className="pill">
                    <span className="dot" />
                    Revoked
                  </span>
                ) : (
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={async () => {
                      const ok = await ask({
                        title: `Revoke "${t.label}"?`,
                        body: "Claude Code sessions using it lose access on their next call. This can't be undone; make a new token to reconnect.",
                        confirm: "Revoke",
                        tone: "danger",
                        icon: "trash",
                        run: () => revokeProjectToken(orgId, t.id),
                      });
                      if (ok) router.refresh();
                    }}
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
