"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";
import { eps } from "./eps";
import { trapTab } from "./focus";

/** Opens / closes a Sheet by id (Eps.open/close: shared scrim, Esc closes the top overlay, body scroll locked). */
export function openSheet(id: string) {
  eps()?.open(id);
}
export function closeSheet(id: string) {
  eps()?.close(id);
}

/** The right slide-over (bottom sheet on phones) of the admin redesign, ported from the client RequestSheet shell:
 *  head with title, subtitle and close; scrolling body; footer with a Note slot on the left and the actions on the
 *  right. Tab stays inside while it is open; focus goes back to the opener when it closes. */
export function Sheet({
  id, title, sub, children, note, footer, onClose, wide,
}: {
  id: string;
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  /** footer message (a <Note>), shown left of the actions; an error keeps the sheet open */
  note?: ReactNode;
  footer?: ReactNode;
  /** called after the sheet closed, however it closed (button, Esc, scrim) */
  onClose?: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let back: HTMLElement | null = null;
    const mo = new MutationObserver(() => {
      if (el.hasAttribute("data-open")) {
        if (!back) back = document.activeElement as HTMLElement | null;
      } else if (back !== null) {
        const b = back;
        back = null;
        b.focus?.();
        closeRef.current?.();
      }
    });
    mo.observe(el, { attributes: true, attributeFilter: ["data-open"] });
    return () => mo.disconnect();
  }, []);
  return (
    <div className={`sheet${wide ? " sheet-wide" : ""}`} id={id} ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={(e) => trapTab(e, ref.current)}>
      <div className="sheet-head">
        <div className="grow">
          <h2 id={titleId}>{title}</h2>
          {sub && <div className="c-3 t-13">{sub}</div>}
        </div>
        <button className="btn btn-secondary btn-icon" type="button" aria-label="Close" onClick={() => closeSheet(id)}>
          <Icon name="x" />
        </button>
      </div>
      <div className="sheet-body">{children}</div>
      {(note || footer) && (
        <div className="sheet-foot">
          {/* not .grow: system.css hides `.sheet-foot > .grow` on phones, and the note must stay visible */}
          <div className="sheet-note">{note}</div>
          {footer}
        </div>
      )}
    </div>
  );
}
