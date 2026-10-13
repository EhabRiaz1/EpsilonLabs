"use client";

import { useEffect, useRef } from "react";
import { whenEps } from "./eps";

/** The design system's KPI sparkline (Eps.sparkline). Draws once motion.js is loaded, and again when data changes. */
export function Sparkline({ data, label }: { data: number[]; label: string }) {
  const el = useRef<HTMLDivElement>(null);
  const key = data.join(",");
  useEffect(() => {
    return whenEps((e) => {
      if (el.current && data.length > 1) e.sparkline(el.current, data);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <div className="spark" ref={el} role="img" aria-label={label} />;
}
