"use client";

import { useEffect, useState, type ReactNode } from "react";

/** The design system's half-circle gauge (.gauge, same geometry as Eps.gauge), rendered by React so it survives
 *  re-renders. The arc sweeps in once on mount (CSS transition; reduced motion makes it instant). `value` replaces
 *  the default "42%" in the middle (Today's goal shows the dollar amount). */
export function ArcGauge({ pct, label, value, className }: { pct: number; label: string; value?: ReactNode; className?: string }) {
  const r = 80;
  const C = Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(clamped)));
    return () => cancelAnimationFrame(id);
  }, [clamped]);
  const d = `M${100 - r} 95 A${r} ${r} 0 0 1 ${100 + r} 95`;
  return (
    <div className={`gauge${className ? ` ${className}` : ""}`} role="img" aria-label={`${Math.round(clamped * 10) / 10}% ${label}`}>
      <svg viewBox="0 0 200 110" aria-hidden="true">
        <path className="track" d={d} />
        <path className="bar accent" d={d} strokeDasharray={C} strokeDashoffset={C * (1 - shown / 100)} />
      </svg>
      <div className="val">
        <div className="big">
          {value ?? (
            <>
              {Math.round(clamped)}
              <span className="dec">%</span>
            </>
          )}
        </div>
        <div className="lbl">{label}</div>
      </div>
    </div>
  );
}
