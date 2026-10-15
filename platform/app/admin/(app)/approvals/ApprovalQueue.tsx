"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import { Tabs } from "@/app/components/Tabs";
import { Empty } from "@/app/components/Empty";
import { Note } from "@/app/components/Note";
import { usePageCommands } from "@/app/components/AdminPalette";
import type { IconName } from "@/app/components/icons";
import { eps } from "@/app/components/eps";
import { esc } from "@/lib/html";
import { clampSel, initialQueueState, queueKey, type QueueCommand } from "@/lib/queue-keys";
import {
  approveDraft, editAndApproveDraft, editPublishUpdateCard, holdDraft, publishUpdateCard, rejectDraft, releaseHeldDraft,
  skipUpdateCard, undoDecision, type DeckResult,
} from "./actions";

export type Card = {
  id: string; kind: string; label: string; who: string; company: string; to: string; subject: string; thread: string;
  when: string; wedge: string; channel: string; theyWrote: string; ours: string; draft: string; edited: boolean;
  lint: { type: string; text: string }[]; held: boolean; heldReason: string; classifier: string; agent: string;
  /** deck: an email in approval_queue (the Mac outbox sends it). update / report: client-portal drafts (012).
   *  brief / plan: project-agent steps waiting on the ticket page (015); like reports, they open their page. */
  source?: "deck" | "update" | "report" | "brief" | "plan"; href?: string;
};
export type View = "all" | "cold" | "replies" | "held";
/** What else waits, listed under All clear (design review D5). */
export type Handoff = { label: string; n: number; href: string; icon: IconName };
const TABS: [View, string][] = [["all", "All"], ["cold", "Cold email"], ["replies", "Replies"], ["held", "Held"]];
const UNDO_SECONDS = 8; // design review: 8 s undo (the Mac outbox waits longer before it sends)

const ICON: Record<string, IconName> = { outbound: "send", reply: "mail", ack: "check", quote: "receipt", optout_confirm: "x", referral: "users", update: "file", report: "chart", brief: "sparkle", plan: "cpu" };
/** Cards approved on their own page (the queue only opens it). */
const opens = (c: { source?: string }) => c.source === "report" || c.source === "brief" || c.source === "plan";
const inView = (v: View, c: Card) => (v === "held" ? c.held : c.held ? false : v === "cold" ? c.kind === "outbound" : v === "replies" ? c.kind !== "outbound" : true);
const SENT_MSG: Record<string, string> = {
  approved: "Approved · sends from the Mac outbox",
  edited_approved: "Edited and approved · sends from the Mac outbox",
  edited_pending_lint: "Approved · re-linted on the Mac, then sent",
};
const QUEUED_MSG = "Approved · queued, sends when the Mac is back";

function toast(msg: string, opts: Parameters<NonNullable<ReturnType<typeof eps>>["toast"]>[1] = {}) {
  const e = eps();
  if (e) e.toast(esc(msg), opts);
  else if (!opts.seconds) window.alert(msg);
}

/** The Superhuman-style approval queue (admin-queue.html): J/K/A/E/R/L, inline edit, 8 s undo, All clear. With the Mac
 *  worker offline, approving still records the decision; the button says "Approve · queued" and the toast says when it
 *  sends. The same commands are in ⌘K. */
export function ApprovalQueue({ ready, held, initialView, decidedToday, online = true, handoff = [], lastBeat = null }: {
  ready: Card[]; held: Card[]; initialView: View; decidedToday: number; online?: boolean; handoff?: Handoff[]; lastBeat?: string | null;
}) {
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
    toast(online ? (SENT_MSG[r.status ?? ""] ?? "Approved") : QUEUED_MSG, {
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

  /** Client updates: publish (or skip) when the undo toast runs out; Undo never reaches the server. */
  function commitLater(c: Card, msg: string, icon: "check" | "x", dir: "right" | "left", commit: () => Promise<DeckResult>) {
    setKs((s) => ({ ...s, editing: false }));
    leave(c.id, dir);
    toast(msg, {
      icon,
      seconds: UNDO_SECONDS,
      action: "Undo",
      onUndo: () => unhide(c.id),
      onCommit: async () => {
        const r = await safe(commit());
        if (!r.ok) {
          unhide(c.id);
          toast(r.message ?? "That didn't save.", { icon: "alert" });
        }
        router.refresh();
      },
    });
  }

  async function approve(c: Card) {
    if (opens(c)) return router.push(c.href ?? "/reports");
    if (c.source === "update") return commitLater(c, "Publishing to the client's portal", "check", "right", () => publishUpdateCard(c.id));
    if (c.held) return toast("This draft is held. Release it to the deck first.", { icon: "alert" });
    setBusy(true);
    const r = await safe(approveDraft(c.id, confirm?.id === c.id));
    setBusy(false);
    afterApprove(c, r);
  }

  async function save(c: Card) {
    if (c.source === "update") {
      const body = text;
      return commitLater(c, "Edited · publishing to the client's portal", "check", "right", () => editPublishUpdateCard(c.id, c.subject, body));
    }
    setBusy(true);
    const r = await safe(editAndApproveDraft(c.id, text, confirm?.id === c.id));
    setBusy(false);
    afterApprove(c, r);
  }

  function reject(c: Card) {
    const why = reason;
    setReason("");
    if (opens(c)) return router.push(c.href ?? "/reports");
    if (c.source === "update") return commitLater(c, "Skipped · nothing is sent", "x", "left", () => skipUpdateCard(c.id, why));
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
    if (opens(c)) return router.push(c.href ?? "/reports");
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
    else if (command === "hold" && c.source && c.source !== "deck") toast("Client updates aren't held: publish, edit or skip.", { icon: "alert" });
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

  // ⌘K: the same commands as the keys (the reducer above handles the keys themselves)
  const step = (d: number) => {
    if (!visible.length) return;
    setKs((s) => ({ ...s, editing: false, sel: (clampSel(s.sel, visible.length) + d + visible.length) % visible.length }));
    setConfirm(null);
  };
  usePageCommands(
    "Approvals",
    [
      { label: "Approve", icon: "check", keys: "A", run: () => run("approve", cur) },
      { label: "Edit the draft", icon: "pencil", keys: "E", run: () => run("edit", cur) },
      { label: "Reject", icon: "x", keys: "R", run: () => run("reject", cur) },
      { label: "Hold · release a held draft", icon: "pause", keys: "H", run: () => run("hold", cur) },
      { label: "Later · move to the end", icon: "clock", keys: "L", run: () => run("hold", cur) },
      { label: "Next item", icon: "chevD", keys: "J", run: () => step(1) },
      { label: "Previous item", icon: "chevR", keys: "K", run: () => step(-1) },
    ],
    "approvals",
  );

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
          {c.source === "update" ? "Save and publish" : confirm?.id === c.id ? "Save and send anyway" : "Save and approve"}
          {withKeys && <span className="kbd">⌘↵</span>}
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => run("cancel", c)}>
          Cancel
        </button>
      </>
    ) : (
      <>
        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => run("approve", c)}>
          {opens(c) ? "Open to review" : c.source === "update" ? "Publish" : confirm?.id === c.id ? "Send anyway" : online ? "Approve" : "Approve · queued"}
          {withKeys && <span className="kbd">A</span>}
        </button>
        <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => run("edit", c)}>
          Edit{withKeys && <span className="kbd">E</span>}
        </button>
        <button className="btn btn-danger" type="button" disabled={busy} onClick={() => run("reject", c)}>
          {c.source === "update" ? "Skip" : "Reject"}{withKeys && <span className="kbd">R</span>}
        </button>
        {withKeys && (!c.source || c.source === "deck") && (
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
        <Tabs label="Filter" value={view} onChange={(v) => tab(v as View)} items={TABS.map(([v, label]) => ({ key: v, label, count: count(v) }))} />
        {!online && (
          <span className="pill pill-warn" title={lastBeat ? `Last heartbeat ${lastBeat}` : "The Mac worker has not reported"}>
            <span className="dot" />
            Mac offline · approvals queue
          </span>
        )}
        <div className="keys" aria-hidden="true">
          <span><span className="kbd-group"><span className="kbd">J</span><span className="kbd">K</span></span>move</span>
          <span><span className="kbd">A</span>approve</span>
          <span><span className="kbd">E</span>edit</span>
          <span><span className="kbd">R</span>reject</span>
          <span><span className="kbd">L</span>later</span>
        </div>
      </div>

      {!cur ? (
        <Empty title="All clear" action={<HandoffList items={handoff} />}>
          <p className="c-2">
            {view === "held" ? "No held drafts." : `Nothing waits on you here. ${decidedToday} decided today.`}
            {view !== "all" && waiting ? ` ${waiting} waiting in other tabs.` : ""}
          </p>
        </Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th className="th-kind" aria-label="Kind" />
              <th>Item</th>
              <th className="hide-m">Who</th>
              <th>Status</th>
              <th className="hide-m ta-r">When</th>
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
                              <div className="stack g-10 min-0">
                                {c.held && <Note tone="warn">Held: {c.heldReason || "needs a look"}</Note>}
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
                                <div className={c.source === "brief" || c.source === "plan" ? "draft brief" : "draft"}>
                                  {(c.source === "brief" || c.source === "plan") && (
                                    <div className="tag">
                                      <Icon name="sparkle" className="i-sm" />
                                      {c.source === "brief" ? "AI brief · you approve the wording" : "Read-only plan · you approve the files and steps"}
                                    </div>
                                  )}
                                  <div className="to"><Icon name={c.source && c.source !== "deck" ? "users" : "mail"} className="i-sm" />{c.source && c.source !== "deck" ? c.to : `To ${c.to || "(no address)"}`}</div>
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
                                      <p className="c-3 t-12 mt-8">{c.source === "update" ? "Published to the client's portal when the undo runs out. Esc cancels." : "Re-linted on the Mac before sending. Esc cancels."}</p>
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
                                  <dt>{c.source && c.source !== "deck" ? "Goes to" : "Sends"}</dt><dd>{c.source === "update" ? `client portal + digest, ${UNDO_SECONDS} s undo` : c.source === "report" ? "client portal + PDF, from the report page" : c.source === "brief" || c.source === "plan" ? "nothing reaches the client: approve on the ticket page" : `from the Mac outbox, ${UNDO_SECONDS} s undo`}</dd>
                                </dl>
                                {!ks.editing && !opens(c) && (
                                  <input
                                    className="input"
                                    type="text"
                                    maxLength={300}
                                    placeholder={c.source === "update" ? "Skip reason (optional)" : "Reject reason (optional)"}
                                    aria-label={c.source === "update" ? "Skip reason" : "Reject reason"}
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                  />
                                )}
                              </div>
                              <div className="detail-actions" onClick={(e) => e.stopPropagation()}>
                                {actionButtons(c, true)}
                                <span className="c-3 t-12 ml-auto">{i + 1} of {visible.length}</span>
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

/** Under All clear: the other places that wait on the founder (only the non-zero ones). */
function HandoffList({ items }: { items: Handoff[] }) {
  const open = items.filter((x) => x.n > 0);
  if (!open.length) return <p className="c-3 t-12 mono">Nothing else waits either. New drafts arrive from the Mac agents.</p>;
  return (
    <div className="handoff">
      <div className="handoff-h">Also waiting</div>
      <div className="rows">
        {open.map((x) => (
          <Link key={x.label} href={x.href}>
            <span className="ic">
              <Icon name={x.icon} className="i-sm" />
            </span>
            <span className="grow">
              <span className="t">{x.label}</span>
            </span>
            <span className="when">
              <strong>{x.n}</strong>
            </span>
            <Icon name="chevR" className="i-sm c-3" />
          </Link>
        ))}
      </div>
    </div>
  );
}
