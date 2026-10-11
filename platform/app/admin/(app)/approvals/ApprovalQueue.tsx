"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import type { IconName } from "@/app/components/icons";
import { eps } from "@/app/components/eps";
import { esc } from "@/lib/html";
import { clampSel, initialQueueState, queueKey, type QueueCommand } from "@/lib/queue-keys";
import {
  approveDraft, editAndApproveDraft, holdDraft, rejectDraft, releaseHeldDraft, undoDecision, type DeckResult,
} from "./actions";

export type Card = {
  id: string; kind: string; label: string; who: string; company: string; to: string; subject: string; thread: string;
  when: string; wedge: string; channel: string; theyWrote: string; ours: string; draft: string; edited: boolean;
  lint: { type: string; text: string }[]; held: boolean; heldReason: string; classifier: string; agent: string;
};
export type View = "all" | "cold" | "replies" | "held";
const TABS: [View, string][] = [["all", "All"], ["cold", "Cold email"], ["replies", "Replies"], ["held", "Held"]];
const UNDO_SECONDS = 10;

const ICON: Record<string, IconName> = { outbound: "send", reply: "mail", ack: "check", quote: "receipt", optout_confirm: "x" };
const inView = (v: View, c: Card) => (v === "held" ? c.held : c.held ? false : v === "cold" ? c.kind === "outbound" : v === "replies" ? c.kind !== "outbound" : true);
const SENT_MSG: Record<string, string> = {
  approved: "Approved · sends from the Mac outbox",
  edited_approved: "Edited and approved · sends from the Mac outbox",
  edited_pending_lint: "Approved · re-linted on the Mac, then sent",
};

function toast(msg: string, opts: Parameters<NonNullable<ReturnType<typeof eps>>["toast"]>[1] = {}) {
  const e = eps();
  if (e) e.toast(esc(msg), opts);
  else if (!opts.seconds) window.alert(msg);
}

/** The Superhuman-style approval queue (admin-queue.html): J/K/A/E/R/L, inline edit, 10 s undo, All clear. */
export function ApprovalQueue({ ready, held, initialView, decidedToday }: { ready: Card[]; held: Card[]; initialView: View; decidedToday: number }) {
  const router = useRouter();
  const [view, setView] = useState<View>(initialView);
  const [ks, setKs] = useState(initialQueueState);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [leaving, setLeaving] = useState<{ id: string; dir: "right" | "left" } | null>(null);
  const [text, setText] = useState("");
  const [confirm, setConfirm] = useState<{ id: string; lint: { type: string; text: string }[] } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  const all = [...ready, ...held].filter((c) => !gone.has(c.id));
  const visible = all.filter((c) => inView(view, c));
  const sel = clampSel(ks.sel, visible.length);
  const cur = visible[sel] as Card | undefined;
  const count = (v: View) => all.filter((c) => inView(v, c)).length;
  const waiting = all.filter((c) => !c.held).length;

  const hide = (id: string) => setGone((g) => new Set(g).add(id));
  const unhide = (id: string) => setGone((g) => {
    const n = new Set(g);
    n.delete(id);
    return n;
  });
  function leave(id: string, dir: "right" | "left") {
    setLeaving({ id, dir });
    window.setTimeout(() => {
      hide(id);
      setLeaving(null);
    }, eps()?.reduced() ? 0 : 320);
  }
  async function safe(p: Promise<DeckResult>): Promise<DeckResult> {
    try {
      return await p;
    } catch {
      return { ok: false, error: "network", message: "Couldn't reach admin. Nothing was changed; try again." };
    }
  }

  function afterApprove(c: Card, r: DeckResult) {
    if (!r.ok) {
      if (r.error === "lint_confirm_required") {
        setConfirm({ id: c.id, lint: r.lint ?? [] });
        toast("Lint warnings. Check them, then approve again to send anyway.", { icon: "alert" });
      } else toast(r.message ?? "That didn't work.", { icon: "alert" });
      return;
    }
    setConfirm(null);
    setKs((s) => ({ ...s, editing: false }));
    leave(c.id, "right");
    toast(SENT_MSG[r.status ?? ""] ?? "Approved", {
      icon: "check",
      seconds: UNDO_SECONDS,
      action: "Undo",
      onUndo: async () => {
        const u = await safe(undoDecision(c.id));
        if (u.ok) {
          unhide(c.id);
          toast("Back in the queue", { icon: "undo" });
        } else toast(u.message ?? "Too late, already sending.", { icon: "alert" });
        router.refresh();
      },
      onCommit: () => router.refresh(),
    });
  }

  async function approve(c: Card) {
    if (c.held) return toast("This draft is held. Release it to the deck first.", { icon: "alert" });
    setBusy(true);
    const r = await safe(approveDraft(c.id, confirm?.id === c.id));
    setBusy(false);
    afterApprove(c, r);
  }

  async function save(c: Card) {
    setBusy(true);
    const r = await safe(editAndApproveDraft(c.id, text, confirm?.id === c.id));
    setBusy(false);
    afterApprove(c, r);
  }

  function reject(c: Card) {
    const why = reason;
    setReason("");
    setKs((s) => ({ ...s, editing: false }));
    leave(c.id, "left");
    // committed only when the toast runs out; Undo never reaches the server
    toast("Rejected · draft discarded", {
      icon: "x",
      seconds: UNDO_SECONDS,
      action: "Undo",
      onUndo: () => unhide(c.id),
      onCommit: async () => {
        const r = await safe(rejectDraft(c.id, why));
        if (!r.ok) {
          unhide(c.id);
          toast(r.message ?? "The reject didn't save.", { icon: "alert" });
        }
        router.refresh();
      },
    });
  }

  async function simple(c: Card, fn: (id: string) => Promise<DeckResult>, msg: string) {
    setBusy(true);
    const r = await safe(fn(c.id));
    setBusy(false);
    if (!r.ok) return toast(r.message ?? "That didn't work.", { icon: "alert" });
    toast(msg, { icon: "check" });
    router.refresh();
  }

  function startEdit(c: Card) {
    if (c.held) return toast("Release the draft first, then edit it.", { icon: "alert" });
    setText(c.draft);
    setKs((s) => ({ ...s, editing: true }));
    window.setTimeout(() => area.current?.focus(), 30);
  }

  function run(command: QueueCommand, c: Card | undefined) {
    if (!c || busy) return;
    if (command === "approve") void approve(c);
    else if (command === "edit") startEdit(c);
    else if (command === "save") void save(c);
    else if (command === "cancel") setKs((s) => ({ ...s, editing: false }));
    else if (command === "reject") reject(c);
    else if (command === "hold") void (c.held ? simple(c, releaseHeldDraft, "Released to the deck") : simple(c, holdDraft, "Later · moved to the end of the queue"));
  }

  // one listener; it reads the latest render through a ref
  const handler = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    handler.current = (e: KeyboardEvent) => {
      if (document.querySelector(".cmdk[data-open], .sheet[data-open], .sidebar[data-open]")) return;
      const t = e.target as HTMLElement | null;
      const typing = Boolean(t && t.closest("input, textarea, select, [contenteditable]"));
      const r = queueKey({ ...ks, sel }, { key: e.key, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, typing, at: e.timeStamp }, visible.length);
      if (r.handled) e.preventDefault();
      if (r.command === "edit") {
        run("edit", visible[r.state.sel]);
        return;
      }
      setKs(r.state);
      if (r.command) run(r.command, visible[r.state.sel]);
      if (!r.command && r.handled) {
        document.querySelector(`tr.q-row[data-i="${r.state.sel}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    };
  });
  useEffect(() => {
    const on = (e: KeyboardEvent) => handler.current(e);
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, []);

  function pick(i: number) {
    if (i !== sel) {
      setKs((s) => ({ ...s, sel: i, editing: false }));
      setConfirm(null);
    }
  }
  function tab(v: View) {
    setView(v);
    setKs(initialQueueState);
    window.history.replaceState(null, "", v === "all" ? "/approvals" : `/approvals?view=${v}`);
  }

  const actionButtons = (c: Card, withKeys: boolean) =>
    c.held ? (
      <>
        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => run("hold", c)}>
          Release to deck{withKeys && <span className="kbd">L</span>}
        </button>
        <button className="btn btn-danger" type="button" disabled={busy} onClick={() => run("reject", c)}>
          Reject{withKeys && <span className="kbd">R</span>}
        </button>
      </>
    ) : ks.editing ? (
      <>
        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => run("save", c)}>
          {confirm?.id === c.id ? "Save and send anyway" : "Save and approve"}
          {withKeys && <span className="kbd">⌘↵</span>}
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => run("cancel", c)}>
          Cancel
        </button>
      </>
    ) : (
      <>
        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => run("approve", c)}>
          {confirm?.id === c.id ? "Send anyway" : "Approve"}
          {withKeys && <span className="kbd">A</span>}
        </button>
        <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => run("edit", c)}>
          Edit{withKeys && <span className="kbd">E</span>}
        </button>
        <button className="btn btn-danger" type="button" disabled={busy} onClick={() => run("reject", c)}>
          Reject{withKeys && <span className="kbd">R</span>}
        </button>
        {withKeys && (
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => run("hold", c)}>
            Later<span className="kbd">L</span>
          </button>
        )}
      </>
    );

  return (
    <section className="panel q-panel" aria-label="Approvals">
      <div className="q-head">
        <h2>Queue</h2>
        <div className="tabs" role="tablist" aria-label="Filter">
          {TABS.map(([v, label]) => (
            <button key={v} className="tab" role="tab" type="button" aria-selected={view === v} onClick={() => tab(v)}>
              {label} <span className="c-3">{count(v)}</span>
            </button>
          ))}
        </div>
        <div className="keys" aria-hidden="true">
          <span><span className="kbd-group"><span className="kbd">J</span><span className="kbd">K</span></span>move</span>
          <span><span className="kbd">A</span>approve</span>
          <span><span className="kbd">E</span>edit</span>
          <span><span className="kbd">R</span>reject</span>
          <span><span className="kbd">L</span>later</span>
        </div>
      </div>

      {!cur ? (
        <div className="empty">
          <div className="orb">
            <span className="wave" />
            <span className="wave" />
            <span className="core"><Icon name="check" className="i-lg" /></span>
          </div>
          <h2 className="display" style={{ fontSize: "var(--t-28)" }}>All clear</h2>
          <p className="c-2" style={{ maxWidth: "36ch" }}>
            {view === "held" ? "No held drafts." : `Nothing waits on you. ${decidedToday} decided today.`}
            {view !== "all" && waiting ? ` ${waiting} waiting in other tabs.` : ""}
          </p>
          <p className="c-3 t-12">New drafts arrive from the Mac agents; this page refreshes every 30 s.</p>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 52 }} aria-label="Kind" />
              <th>Item</th>
              <th className="hide-m">Who</th>
              <th>Status</th>
              <th className="hide-m" style={{ textAlign: "right" }}>When</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c, i) => {
              const open = i === sel;
              const out = leaving?.id === c.id ? (leaving.dir === "right" ? " out-right" : " out-left") : "";
              return (
                <Fragment key={c.id}>
                  <tr className={`rowx q-row${out ? " leaving" : ""}`} data-i={i} aria-expanded={open} onClick={() => pick(i)}>
                    <td><span className="ic"><Icon name={c.held ? "alert" : (ICON[c.kind] ?? "mail")} /></span></td>
                    <td>
                      <div className="t">{c.subject || c.thread || "(no subject)"}</div>
                      <div className="m">
                        {c.label}
                        <span className="show-s"> · {c.who}</span>
                        {c.lint.length > 0 && <span className="c-warn"> · {c.lint.length} lint</span>}
                        {c.edited && <span className="c-accent"> · edited</span>}
                      </div>
                    </td>
                    <td className="hide-m c-2">{c.company ? `${c.company} · ${c.who}` : c.who}</td>
                    <td>
                      <span className={`pill ${c.held ? "pill-bad" : c.lint.length ? "pill-warn" : "pill-accent"}`}>
                        <span className="dot" />
                        {c.held ? "Held" : c.lint.length ? "Check lint" : "Ready"}
                      </span>
                    </td>
                    <td className="hide-m tm">{c.when}</td>
                  </tr>
                  <tr className="detail">
                    <td colSpan={5}>
                      <div className="collapse" data-open={open ? "" : undefined}>
                        <div>
                          {open && (
                            <div className={`detail-body q-card${out}`} id="card">
                              <div className="stack" style={{ gap: 10, minWidth: 0 }}>
                                {c.held && (
                                  <div className="auth-error" style={{ marginTop: 0 }}>
                                    <Icon name="alert" className="i-sm" />
                                    Held: {c.heldReason || "needs a look"}
                                  </div>
                                )}
                                {c.theyWrote && (
                                  <div className="untrusted">
                                    <div className="untrusted-tag"><Icon name="alert" className="i-sm" />{c.kind === "outbound" ? "Research notes · untrusted" : `${c.who} wrote · untrusted`}</div>
                                    <div className="pre">{c.theyWrote}</div>
                                  </div>
                                )}
                                {c.ours && (
                                  <details className="ours">
                                    <summary className="c-3 t-12">Our earlier email</summary>
                                    <div className="pre t-13 c-2">{c.ours}</div>
                                  </details>
                                )}
                                <div className="draft">
                                  <div className="to"><Icon name="mail" className="i-sm" />To {c.to || "(no address)"}</div>
                                  {c.thread && <div className="subj">{c.thread}</div>}
                                  {ks.editing ? (
                                    <>
                                      <textarea
                                        ref={area}
                                        className="textarea"
                                        aria-label="Edit draft"
                                        value={text}
                                        onChange={(e) => setText(e.target.value)}
                                        rows={Math.min(18, Math.max(6, text.split("\n").length + 1))}
                                      />
                                      <p className="c-3 t-12" style={{ marginTop: 8 }}>Re-linted on the Mac before sending. Esc cancels.</p>
                                    </>
                                  ) : (
                                    <div className="pre">{c.draft}</div>
                                  )}
                                </div>
                                {(confirm?.id === c.id ? confirm.lint : c.lint).length > 0 && (
                                  <div className="lint-list" role={confirm?.id === c.id ? "alert" : undefined}>
                                    {(confirm?.id === c.id ? confirm.lint : c.lint).map((h, k) => (
                                      <span key={k} className="pill pill-warn"><span className="dot" />{h.type}: {h.text.slice(0, 60)}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div className="side">
                                <dl className="fields">
                                  <dt>Kind</dt><dd>{c.label}</dd>
                                  {c.company && (<><dt>Company</dt><dd>{c.company}</dd></>)}
                                  {c.classifier && (<><dt>Classifier</dt><dd>{c.classifier}</dd></>)}
                                  {(c.wedge || c.channel) && (<><dt>Deal</dt><dd>{[c.wedge, c.channel].filter(Boolean).join(" · ")}</dd></>)}
                                  <dt>Lint</dt><dd>{c.lint.length ? `${c.lint.length} warning${c.lint.length > 1 ? "s" : ""}` : "ok"}</dd>
                                  <dt>Drafted by</dt><dd>{c.agent}</dd>
                                  <dt>Sends</dt><dd>from the Mac outbox, {UNDO_SECONDS} s undo</dd>
                                </dl>
                                {!ks.editing && (
                                  <input
                                    className="input"
                                    type="text"
                                    maxLength={300}
                                    placeholder="Reject reason (optional)"
                                    aria-label="Reject reason"
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                  />
                                )}
                              </div>
                              <div className="detail-actions" onClick={(e) => e.stopPropagation()}>
                                {actionButtons(c, true)}
                                <span className="c-3 t-12" style={{ marginLeft: "auto" }}>{i + 1} of {visible.length}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      {cur && <div className="q-bar">{actionButtons(cur, false)}</div>}
    </section>
  );
}
