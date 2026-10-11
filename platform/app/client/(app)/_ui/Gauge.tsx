"use client";

import { useEffect, useState } from "react";

/** The arc gauge from the design system (Eps.gauge), rendered by React so it survives re-renders. */
export function Gauge({ pct, label }: { pct: number; label: string }) {
  const r = 80;
  const C = Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(clamped));
    return () => cancelAnimationFrame(id);
  }, [clamped]);
  const d = `M${100 - r} 95 A${r} ${r} 0 0 1 ${100 + r} 95`;
  return (
    <div className="gauge" role="img" aria-label={`${Math.round(clamped)}% ${label}`}>
      <svg viewBox="0 0 200 110" aria-hidden="true">
        <path className="track" d={d} />
        <path className="bar accent" d={d} strokeDasharray={C} strokeDashoffset={C * (1 - shown / 100)} />
      </svg>
      <div className="val">
        <div className="big">
          {Math.round(clamped)}
          <span className="dec">%</span>
        </div>
        <div className="lbl">{label}</div>
      </div>
    </div>
  );
}
