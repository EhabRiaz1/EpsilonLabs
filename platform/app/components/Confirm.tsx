"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { esc } from "@/lib/html";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { Note } from "./Note";
import { eps } from "./eps";
import { trapTab } from "./focus";

// The confirmation dialog of the admin redesign (replaces the browser confirm prompt everywhere). One .modal from system.css, opened
// and closed with Eps.open/close so it shares the scrim, Esc and body-scroll rules with sheets. It focuses its primary
// button, keeps Tab inside, and returns focus to where it was. With `run`, the dialog runs the action itself: it stays
// open with the error on failure and closes with a toast on success.

type Result = { ok?: string; error?: string } | undefined | void;
export type ConfirmOptions = {
  title: ReactNode;
  body?: ReactNode;
  /** primary button label (default "Confirm") */
  confirm?: string;
  cancel?: string;
  tone?: "primary" | "danger";
  icon?: IconName;
  /** runs on confirm; an { error } keeps the dialog open and shows it */
  run?: () => Promise<Result>;
};

export function Confirm({
  id, open, title, body, confirm = "Confirm", cancel = "Cancel", tone = "primary", icon, busy, error, onConfirm, onCancel,
}: Omit<ConfirmOptions, "run"> & { id: string; open: boolean; busy?: boolean; error?: string | null; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const cancelRef = useRef(onCancel);
  const busyRef = useRef(busy);
  useEffect(() => {
    cancelRef.current = onCancel;
    busyRef.current = busy;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || !open) return;
    const back = document.activeElement as HTMLElement | null;
    const e = eps();
    if (e) e.open(id);
    else el.setAttribute("data-open", "");
    // motion.js focuses the first button after 120 ms; the primary action wins
    const t = window.setTimeout(() => primary.current?.focus(), e?.reduced() ? 0 : 140);
    // Esc and the scrim close the overlay through motion.js: treat that as Cancel (or reopen while the action runs)
    const mo = new MutationObserver(() => {
      if (el.hasAttribute("data-open")) return;
      if (busyRef.current) eps()?.open(id);
      else cancelRef.current();
    });
    mo.observe(el, { attributes: true, attributeFilter: ["data-open"] });
    return () => {
      window.clearTimeout(t);
      mo.disconnect();
      if (el.hasAttribute("data-open")) {
        if (e) e.close(id);
        else el.removeAttribute("data-open");
      }
      back?.focus?.();
    };
  }, [open, id]);

  return (
    <div className="modal" id={id} ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} hidden={!open} onKeyDown={(e) => trapTab(e, ref.current)}>
      <div className="modal-card confirm">
        <h2 id={titleId}>
          {icon && <Icon name={icon} className={tone === "danger" ? "c-bad" : "c-accent"} />}
          {title}
        </h2>
        {body && <div className="confirm-body">{body}</div>}
        {error && <Note tone="error">{error}</Note>}
        <div className="foot">
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={onCancel}>
            {cancel}
          </button>
          <button ref={primary} className={`btn ${tone === "danger" ? "btn-danger" : "btn-primary"}`} type="button" disabled={busy} onClick={onConfirm}>
            {busy && <span className="spinner" />}
            {confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- ask(): the promise-based form used in place of the browser confirm prompt ----

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };
let show: ((p: Pending) => void) | null = null;
let waiting: Pending | null = null;
let root: Root | null = null;

/** Opens the dialog and resolves true when confirmed (and, with `run`, when the action succeeded), false on cancel. */
export function ask(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const p = { ...opts, resolve };
    if (show) return show(p);
    waiting?.resolve(false);
    waiting = p;
    if (!root) {
      const host = document.createElement("div");
      host.setAttribute("data-confirm-host", "");
      document.body.appendChild(host);
      root = createRoot(host);
      root.render(<ConfirmHost />);
    }
  });
}

function ConfirmHost() {
  const [cur, setCur] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    show = (p) => {
      setCur((old) => {
        old?.resolve(false);
        return p;
      });
      setError(null);
      setBusy(false);
    };
    if (waiting) {
      show(waiting);
      waiting = null;
    }
    return () => {
      show = null;
    };
  }, []);

  function finish(ok: boolean) {
    cur?.resolve(ok);
    setCur(null);
    setBusy(false);
    setError(null);
  }
  async function confirm() {
    if (!cur) return;
    if (!cur.run) return finish(true);
    setBusy(true);
    setError(null);
    let r: Result;
    try {
      r = await cur.run();
    } catch {
      r = { error: "Couldn't reach admin. Nothing was changed; try again." };
    }
    setBusy(false);
    if (r && r.error) return setError(r.error);
    if (r && r.ok) eps()?.toast(esc(r.ok), { icon: "check" });
    finish(true);
  }

  return (
    <Confirm
      id="eps-confirm"
      open={Boolean(cur)}
      title={cur?.title ?? ""}
      body={cur?.body}
      confirm={cur?.confirm}
      cancel={cur?.cancel}
      tone={cur?.tone}
      icon={cur?.icon}
      busy={busy}
      error={error}
      onConfirm={() => void confirm()}
      onCancel={() => finish(false)}
    />
  );
}
