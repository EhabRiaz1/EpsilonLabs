"use client";

import { useEffect, useRef } from "react";
import { eps, whenEps } from "./eps";

// Palette validated for the approved prototype (dataviz validate_palette): light #2F6FD6 + #D9532F, dark #4F86DC + #E06E52.
// admin.* uses the website's two practices instead (design review D13): signal + copper on light, ink + signal on dark.
const COLORS = { light: ["#2F6FD6", "#D9532F"], dark: ["#4F86DC", "#E06E52"] };
const ADMIN_COLORS = { light: ["#16697A", "#9A4E1C"], dark: ["#EDF0F1", "#5FC6D6"] };

/** Eps.lines trend chart (up to two series) that redraws on theme change. */
export function TrendChart(props: { labels: string[]; series: { name: string; data: number[] }[]; aria: string; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const legend = useRef<HTMLDivElement>(null);
  const key = JSON.stringify(props);
  useEffect(() => {
    const draw = () => {
      const e = eps();
      if (!e || !el.current) return;
      const pal = document.documentElement.dataset.site === "admin" ? ADMIN_COLORS : COLORS;
      const c = pal[e.theme.get() === "dark" ? "dark" : "light"];
      e.lines(el.current, {
        labels: props.labels,
        series: props.series.map((s, i) => ({ ...s, color: c[i % 2] })),
        badge: "Today",
        aria: props.aria,
      });
      legend.current?.querySelectorAll("i").forEach((n, i) => ((n as HTMLElement).style.background = c[i % 2]));
    };
    const off = whenEps(draw);
    document.addEventListener("eps:theme", draw);
    return () => {
      off();
      document.removeEventListener("eps:theme", draw);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <>
      <div className="legend" ref={legend}>
        {props.series.map((s) => (
          <span key={s.name}>
            <i />
            {s.name}
          </span>
        ))}
      </div>
      <div className="chart" ref={el} style={{ height: props.height ?? 150 }} />
    </>
  );
}
