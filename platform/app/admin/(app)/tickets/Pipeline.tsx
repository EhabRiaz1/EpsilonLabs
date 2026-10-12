"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import type { IconName } from "@/app/components/icons";
import { eps } from "@/app/components/eps";
import { Note, type FormResult } from "@/app/components/Forms";
import { baseName, diffTotals, highlight, langFor, parseUnifiedDiff, type DiffFile } from "@/lib/diff";
import type { Step } from "@/lib/pipeline";

// The ticket pipeline (ticket.html prototype): stepper, brief / plan cards with approve or edit, the mode choice, the
// agent's diff with file tabs and syntax colours, the collapsible test log, and Merge / Push / Send back / Discard.

export type Brief = { title?: string; problem?: string; change?: string[]; not_in_scope?: string[]; acceptance?: string[]; questions_for_client?: string[]; notes?: string; screened?: string[]; edited?: boolean };
export type Plan = { summary?: string; files?: { path: string; change: string }[]; steps?: string[]; risks?: string[]; tests_to_add?: string[]; estimate_hours?: { low: number; high: number }; questions_for_client?: string[]; notes?: string; edited?: boolean };
export type TestResult = { ok?: boolean | null; exit_code?: number | null; timed_out?: boolean; duration_ms?: number; log_tail?: string; command?: string | null; skipped?: string };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [r, setR] = useState<FormResult>(undefined);
  const go = (fn: () => Promise<FormResult>, icon: IconName = "check") =>
    start(async () => {
      let res: FormResult;
      try {
        res = await fn();
      } catch {
        res = { error: "Couldn't reach admin. Nothing was changed; try again." };
      }
      setR(res);
      if (res?.ok) eps()?.toast(res.ok, { icon });
      router.refresh();
    });
  return { pending, r, go };
}

export function Stepper({ steps }: { steps: Step[] }) {
  return (
    <div className="pipeline" aria-label="Ticket pipeline">
      {steps.map((s) => (
        <div key={s.key} className="step" data-state={s.state === "failed" ? "current" : s.state}>
          <span className="step-dot">{s.state === "done" ? <Icon name="check" /> : s.state === "failed" ? <Icon name="alert" /> : null}</span>
          <span className="step-label">{s.label}</span>
          <span className={`step-meta${s.state === "failed" ? " c-bad" : ""}`}>{s.meta || " "}</span>
        </div>
      ))}
    </div>
  );
}

/** One button for a bound server action, with an optional confirm. */
export function Act({ action, label, icon, cls = "btn btn-secondary", confirmText, kbd }: { action: () => Promise<FormResult>; label: string; icon?: IconName; cls?: string; confirmText?: string; kbd?: string }) {
  const { pending, r, go } = useRun();
  return (
    <>
      <button
        className={cls}
        type="button"
        disabled={pending}
        onClick={() => {
          if (confirmText && !window.confirm(confirmText)) return;
          go(action, icon ?? "check");
        }}
      >
        {pending ? <span className="spinner" /> : icon ? <Icon name={icon} className="i-sm" /> : null}
        {label}
        {kbd && <span className="kbd">{kbd}</span>}
      </button>
      {r?.error && (
        <span className="c-bad t-12" role="alert">
          <Icon name="alert" className="i-sm" /> {r.error}
        </span>
      )}
    </>
  );
}

function List({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <>
      <h4>{title}</h4>
      <ul className="plan-list">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </>
  );
}

const joinLines = (xs?: string[]) => (xs ?? []).join("\n");

export function BriefCard({ brief, approve, edit, redraft, editable }: {
  brief: Brief; approve?: () => Promise<FormResult>; edit?: (prev: FormResult, fd: FormData) => Promise<FormResult>; redraft?: () => Promise<FormResult>; editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [state, act, pending] = useActionState(async (prev: FormResult, fd: FormData) => {
    const res = await edit!(prev, fd);
    if (res?.ok) setEditing(false);
    return res;
  }, undefined);
  if (editing && edit)
    return (
      <form action={act} className="stack" style={{ gap: 10 }}>
        <label className="field"><span>Title</span><input className="input" name="title" maxLength={120} defaultValue={brief.title ?? ""} /></label>
        <label className="field"><span>Problem</span><textarea className="textarea" name="problem" maxLength={1200} defaultValue={brief.problem ?? ""} /></label>
        <label className="field"><span>Change (one per line)</span><textarea className="textarea" name="change" defaultValue={joinLines(brief.change)} /></label>
        <label className="field"><span>Not in scope</span><textarea className="textarea" name="not_in_scope" defaultValue={joinLines(brief.not_in_scope)} /></label>
        <label className="field"><span>Acceptance</span><textarea className="textarea" name="acceptance" defaultValue={joinLines(brief.acceptance)} /></label>
        <label className="field"><span>Questions for the client</span><textarea className="textarea" name="questions_for_client" defaultValue={joinLines(brief.questions_for_client)} /></label>
        <input type="hidden" name="notes" value={brief.notes ?? ""} />
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn btn-primary btn-sm" type="submit" disabled={pending}>{pending ? <span className="spinner" /> : <Icon name="check" className="i-sm" />}Save brief</button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setEditing(false)}>Cancel</button>
        </div>
        <Note r={state} />
        <p className="hint">Only the approved brief reaches the plan and the agent. The client&apos;s raw words never do.</p>
      </form>
    );
  return (
    <div className="brief-view">
      {brief.title && <h3 className="t-16 w-600" style={{ marginBottom: 6 }}>{brief.title}</h3>}
      <h4>Problem</h4>
      <p>{brief.problem}</p>
      <List title="Change" items={brief.change} />
      <List title="Not in scope" items={brief.not_in_scope} />
      <List title="Acceptance" items={brief.acceptance} />
      <List title="Questions for the client" items={brief.questions_for_client} />
      {brief.notes && (<><h4>AI notes for you</h4><p className="c-2">{brief.notes}</p></>)}
      {brief.screened && brief.screened.length > 0 && (
        <div className="untrusted" style={{ marginTop: 12 }}>
          <div className="untrusted-tag"><Icon name="shield" className="i-sm" />Removed by the screen · {brief.screened.length} line(s) asked for things outside the project</div>
          <ul className="plan-list">{brief.screened.map((s, i) => <li key={i} style={{ overflowWrap: "anywhere" }}>{s}</li>)}</ul>
        </div>
      )}
      {editable && (
        <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
          {approve && <Act action={approve} label="Approve brief" icon="check" cls="btn btn-primary btn-sm" />}
          {edit && <button className="btn btn-secondary btn-sm" type="button" onClick={() => setEditing(true)}><Icon name="pencil" className="i-sm" />Edit</button>}
          {redraft && <Act action={redraft} label="Redraft" icon="undo" cls="btn btn-ghost btn-sm" confirmText="Draft a new brief? This one is set aside." />}
        </div>
      )}
    </div>
  );
}

export function PlanCard({ plan, approve, edit, redo, editable, touched }: {
  plan: Plan; approve?: () => Promise<FormResult>; edit?: (prev: FormResult, fd: FormData) => Promise<FormResult>; redo?: () => Promise<FormResult>; editable: boolean; touched?: Set<string>;
}) {
  const [editing, setEditing] = useState(false);
  const [state, act, pending] = useActionState(async (prev: FormResult, fd: FormData) => {
    const res = await edit!(prev, fd);
    if (res?.ok) setEditing(false);
    return res;
  }, undefined);
  if (editing && edit)
    return (
      <form action={act} className="stack" style={{ gap: 10 }}>
        <label className="field"><span>Summary</span><textarea className="textarea" name="summary" maxLength={1200} defaultValue={plan.summary ?? ""} /></label>
        <label className="field"><span>Files (path: change, one per line)</span><textarea className="textarea mono-ish" name="files" defaultValue={(plan.files ?? []).map((f) => `${f.path}: ${f.change}`).join("\n")} /></label>
        <label className="field"><span>Steps</span><textarea className="textarea" name="steps" defaultValue={joinLines(plan.steps)} /></label>
        <label className="field"><span>Tests to add</span><textarea className="textarea" name="tests_to_add" defaultValue={joinLines(plan.tests_to_add)} /></label>
        <label className="field"><span>Risks</span><textarea className="textarea" name="risks" defaultValue={joinLines(plan.risks)} /></label>
        <div className="row" style={{ gap: 8 }}>
          <label className="field" style={{ flex: 1 }}><span>Hours, low</span><input className="input" name="low" type="number" min={0} step="0.5" defaultValue={plan.estimate_hours?.low ?? 0} /></label>
          <label className="field" style={{ flex: 1 }}><span>Hours, high</span><input className="input" name="high" type="number" min={0} step="0.5" defaultValue={plan.estimate_hours?.high ?? 0} /></label>
        </div>
        <input type="hidden" name="questions_for_client" value={joinLines(plan.questions_for_client)} />
        <input type="hidden" name="notes" value={plan.notes ?? ""} />
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn btn-primary btn-sm" type="submit" disabled={pending}>{pending ? <span className="spinner" /> : <Icon name="check" className="i-sm" />}Save plan</button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setEditing(false)}>Cancel</button>
        </div>
        <Note r={state} />
      </form>
    );
  return (
    <div className="brief-view">
      <p>{plan.summary}</p>
      {plan.files && plan.files.length > 0 && (
        <>
          <h4>Files likely touched</h4>
          <div className="plan-files">
            {plan.files.map((f) => (
              <div key={f.path}>
                <span className="mono">{f.path}</span>
                <span className="c-3">{f.change}</span>
                {touched && <span className={`pill${touched.has(f.path) ? " pill-good" : ""}`}>{touched.has(f.path) ? "touched" : "untouched"}</span>}
              </div>
            ))}
          </div>
        </>
      )}
      <List title="Steps" items={plan.steps} />
      <List title="Tests to add" items={plan.tests_to_add} />
      <List title="Risks the plan named" items={plan.risks} />
      {plan.estimate_hours && <><h4>Estimate</h4><p>{plan.estimate_hours.low} to {plan.estimate_hours.high} hours of agent time</p></>}
      <List title="Questions for the client" items={plan.questions_for_client} />
      {plan.notes && (<><h4>Notes</h4><p className="c-2">{plan.notes}</p></>)}
      <h4>Denied to the plan agent</h4>
      <div className="denied">Edit · Write · Bash · WebFetch · WebSearch<br />**/.env*  **/*secret*  **/*cred*  *.rtf  *.pem  *.key  ~/.ssh  ~/Library</div>
      {editable && (
        <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
          {approve && <Act action={approve} label="Approve plan" icon="check" cls="btn btn-primary btn-sm" />}
          {edit && <button className="btn btn-secondary btn-sm" type="button" onClick={() => setEditing(true)}><Icon name="pencil" className="i-sm" />Edit</button>}
          {redo && <Act action={redo} label="Re-plan" icon="undo" cls="btn btn-ghost btn-sm" confirmText="Run the read-only plan again? This plan is set aside." />}
        </div>
      )}
    </div>
  );
}

export function ModePicker({ agent, manual, agentOk, agentReason }: { agent: () => Promise<FormResult>; manual: () => Promise<FormResult>; agentOk: boolean; agentReason: string }) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        {agentOk ? (
          <Act action={agent} label="Agent" icon="cpu" cls="btn btn-primary" />
        ) : (
          <button className="btn btn-primary" type="button" disabled title={agentReason}><Icon name="cpu" className="i-sm" />Agent</button>
        )}
        <Act action={manual} label="Manual" icon="pencil" cls="btn btn-secondary" confirmText={'Work on it yourself? The client sees "In progress".'} />
      </div>
      <p className="hint">{agentOk ? `Agent edits only in a git worktree on ticket/EL-n. ${agentReason}.` : agentReason} Manual: commits that mention the ticket are added to the timeline every 10 min.</p>
    </div>
  );
}

export function StartRun({ start }: { start: (notes: string) => Promise<FormResult> }) {
  const [notes, setNotes] = useState("");
  const { pending, r, go } = useRun();
  return (
    <div className="stack" style={{ gap: 10 }}>
      <textarea className="textarea" placeholder="Optional notes for the agent (it already has the approved brief and plan)." maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn btn-primary" type="button" disabled={pending} onClick={() => go(() => start(notes), "play")}>
          {pending ? <span className="spinner" /> : <Icon name="play" className="i-sm" />}Start agent run
        </button>
      </div>
      <Note r={r} />
    </div>
  );
}

function DiffBody({ f }: { f: DiffFile }) {
  const lang = langFor(f.path);
  if (f.binary) return <div className="diff-body"><div className="hunk">Binary file changed</div></div>;
  if (!f.hunks.length) return <div className="diff-body"><div className="hunk">{f.status === "renamed" ? `Renamed from ${f.oldPath}` : "No line changes"}</div></div>;
  return (
    <div className="diff-body">
      {f.hunks.map((h, i) => (
        <div key={i}>
          <div className="hunk">{h.header}</div>
          {h.lines.map((l, j) => (
            <div key={j} className={`dl${l.type === "add" ? " add" : l.type === "del" ? " del" : ""}`}>
              <span className="ln">{l.old ?? ""}</span>
              <span className="ln">{l.new ?? ""}</span>
              <span className="c">
                {l.text
                  ? highlight(l.text, lang).map((tk, k) => (tk.t ? <span key={k} className={tk.t}>{tk.s}</span> : <span key={k}>{tk.s}</span>))
                  : " "}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function DiffViewer({ diff, truncated }: { diff: string; truncated?: boolean }) {
  const files = useMemo(() => parseUnifiedDiff(diff), [diff]);
  const [sel, setSel] = useState(0);
  const tot = diffTotals(files);
  if (!files.length) return <div className="diff"><div className="diff-head"><span className="c-3 t-13">No changes on the branch.</span></div></div>;
  const f = files[Math.min(sel, files.length - 1)];
  return (
    <div className="diff">
      <div className="diff-head">
        <div className="tabs" role="tablist" aria-label="Changed files">
          {files.map((x, i) => (
            <button key={`${x.path}-${i}`} className="tab" role="tab" type="button" aria-selected={i === sel} title={x.path} onClick={() => setSel(i)}>
              {baseName(x.path)}
            </button>
          ))}
        </div>
        <span className="diff-stat">
          <span>{tot.files} file{tot.files === 1 ? "" : "s"}</span>
          <span className="plus">+{tot.added}</span>
          <span className="minus">−{tot.removed}</span>
        </span>
      </div>
      <div className="diff-path mono c-3 t-12">{f.status !== "modified" ? `${f.status} · ` : ""}{f.path}</div>
      <DiffBody f={f} />
      {truncated && <div className="diff-path c-warn t-12">The diff is over 200 KB and was cut. Review the rest in the worktree.</div>}
    </div>
  );
}

export function TestLog({ result }: { result: TestResult | null }) {
  const [open, setOpen] = useState(false);
  if (!result) return null;
  const state = result.ok === true ? ["pill-good", "Passing"] : result.ok === false ? ["pill-bad", result.timed_out ? "Timed out" : "Failing"] : ["", "Not run"];
  const passed = /Tests:\s+(?:\d+ failed, )?(\d+) passed/.exec(result.log_tail ?? "")?.[1] ?? /(\d+) passed/.exec(result.log_tail ?? "")?.[1];
  return (
    <div className="panel tests">
      <div className="sum">
        <span className={`pill ${state[0]}`}><span className="dot" />{state[1]}</span>
        {passed && <span className="n big">{passed}</span>}
        <span className="d">
          {result.skipped ? result.skipped : <>{result.command ? <span className="mono">{result.command}</span> : null} · exit {result.exit_code ?? "–"} · {((result.duration_ms ?? 0) / 1000).toFixed(2)} s</>}
        </span>
        {result.log_tail && (
          <button className="btn btn-secondary btn-sm" type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            Log<Icon name="chevD" className="i-sm" />
          </button>
        )}
      </div>
      {result.log_tail && (
        <div className="collapse" data-open={open ? "" : undefined}>
          <div>
            <div className="log">{result.log_tail}{"\n"}<span className="dim">node_modules symlinked from the real folder · .env not copied unless you set a test env file</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ReviewActions({ branch, merge, push, discard, sendBack, attach, pushed, pushError, previewUrl, pushRequested, clientName }: {
  branch: string; merge: () => Promise<FormResult>; push: () => Promise<FormResult>; discard: () => Promise<FormResult>;
  sendBack: (notes: string) => Promise<FormResult>; attach: (url: string, toClient: boolean) => Promise<FormResult>;
  pushed: boolean; pushError: string | null; previewUrl: string | null; pushRequested: boolean; clientName: string;
}) {
  const [back, setBack] = useState(false);
  const [notes, setNotes] = useState("");
  const [url, setUrl] = useState(previewUrl ?? "");
  const [toClient, setToClient] = useState(false);
  const b = useRun();
  const a = useRun();
  return (
    <div className="panel" id="action-card">
      <div className="actions">
        <Act action={merge} label="I merged it" icon="merge" cls="btn btn-primary" kbd="M"
          confirmText={`Mark ${branch} as merged? Merge it yourself on your Mac first (nothing merges automatically). The ticket becomes Done and ${clientName} sees it.`} />
        <Act action={push} label={pushed ? "Push again" : pushRequested ? "Push queued" : "Push branch for preview"} icon="upload" cls="btn btn-secondary" kbd="P"
          confirmText={`The Mac will run: git push origin ${branch}. Nothing else is pushed. Continue?`} />
        <button className="btn btn-ghost" type="button" onClick={() => setBack((x) => !x)}><Icon name="undo" className="i-sm" />Send back with notes<span className="kbd">N</span></button>
        <span className="spacer" />
        <Act action={discard} label="Discard worktree" icon="trash" cls="btn btn-danger" confirmText={`Discard this run? The Mac deletes the worktree and ${branch}.`} />
        <span className="note">Merge is done by you, on your Mac. Push runs plain <span className="mono">git push origin {branch}</span> from the worker. The AI never pushes or deploys.</span>
      </div>
      {back && (
        <div className="composer" style={{ paddingTop: 0 }}>
          <textarea className="textarea" placeholder="What should change? The agent continues on the same branch." maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-primary btn-sm" type="button" disabled={b.pending || !notes.trim()} onClick={() => b.go(() => sendBack(notes), "undo")}>
              {b.pending ? <span className="spinner" /> : <Icon name="send" className="i-sm" />}Send back
            </button>
          </div>
          <Note r={b.r} />
        </div>
      )}
      {pushError && <div className="preview" data-show=""><Icon name="alert" className="i-sm c-bad" /><span className="grow c-bad">Push failed: {pushError}</span></div>}
      {pushed && (
        <div className="preview" data-show="">
          <Icon name="globe" className="i-sm c-3" />
          <span className="grow">Branch pushed. Paste the preview URL:</span>
          <input className="input" style={{ maxWidth: 280, height: 36 }} placeholder="https://…vercel.app" value={url} onChange={(e) => setUrl(e.target.value)} />
          <label className="row t-12" style={{ gap: 6 }}><input type="checkbox" checked={toClient} onChange={(e) => setToClient(e.target.checked)} />Send to {clientName}</label>
          <button className="btn btn-secondary btn-sm" type="button" disabled={a.pending || !url.trim()} onClick={() => {
            if (toClient && !window.confirm(`Send this preview link to ${clientName}? They see it in the portal.`)) return;
            a.go(() => attach(url, toClient), "globe");
          }}>{a.pending ? <span className="spinner" /> : null}Attach</button>
          <Note r={a.r} />
        </div>
      )}
    </div>
  );
}
