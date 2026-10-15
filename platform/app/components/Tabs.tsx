"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type TabItem = { key: string; label: ReactNode; count?: number; content?: ReactNode };

// useLayoutEffect warns during the server render; the ink is client-only anyway
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Tabs with the sliding ink of the design system (.tabs-ink). Uncontrolled with panels (items carry `content`), or
 *  controlled (`value` + `onChange`) as a filter. Arrow keys move between tabs (roving tabindex). */
export function Tabs({
  items, value, defaultValue, onChange, label, className,
}: {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (key: string) => void;
  label: string;
  className?: string;
}) {
  const [own, setOwn] = useState(defaultValue ?? items[0]?.key ?? "");
  const cur = value ?? own;
  const list = useRef<HTMLDivElement>(null);
  const ink = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const base = useId();

  const move = useCallback(() => {
    const el = list.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    const bar = ink.current;
    if (!el || !bar) return;
    if (!placed.current) bar.style.transition = "none";
    bar.style.left = `${el.offsetLeft}px`;
    bar.style.width = `${el.offsetWidth}px`;
    bar.style.opacity = "1";
    if (!placed.current) {
      placed.current = true;
      requestAnimationFrame(() => (bar.style.transition = ""));
    }
  }, []);
  useIsoLayoutEffect(move, [cur, items.length, move]);
  useEffect(() => {
    window.addEventListener("resize", move);
    void document.fonts?.ready.then(move);
    return () => window.removeEventListener("resize", move);
  }, [move]);

  function select(k: string) {
    if (value === undefined) setOwn(k);
    onChange?.(k);
  }
  function onKey(e: KeyboardEvent, i: number) {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = items[(i + d + items.length) % items.length];
    select(next.key);
    document.getElementById(`${base}-t-${next.key}`)?.focus();
  }
  const hasPanels = items.some((t) => t.content !== undefined);

  return (
    <>
      <div ref={list} className={`tabs${className ? ` ${className}` : ""}`} data-ink="" role="tablist" aria-label={label}>
        {items.map((t, i) => (
          <button
            key={t.key}
            id={`${base}-t-${t.key}`}
            className="tab"
            role="tab"
            type="button"
            aria-selected={t.key === cur}
            aria-controls={hasPanels ? `${base}-p-${t.key}` : undefined}
            tabIndex={t.key === cur ? 0 : -1}
            onClick={() => select(t.key)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
            {t.count !== undefined && <span className="n">{t.count}</span>}
          </button>
        ))}
        <span ref={ink} className="tabs-ink" aria-hidden="true" />
      </div>
      {hasPanels &&
        items.map((t) => (
          <div key={t.key} id={`${base}-p-${t.key}`} role="tabpanel" aria-labelledby={`${base}-t-${t.key}`} hidden={t.key !== cur}>
            {t.content}
          </div>
        ))}
    </>
  );
}
