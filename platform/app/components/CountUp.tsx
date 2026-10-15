"use client";

import { useEffect, useRef, useState } from "react";
import { countAt, formatCount, type CountFormat } from "@/lib/count-up";
import { eps } from "./eps";

const DURATION = 700;

/** Counts up from 0 once per mount (design review D10: Needs-you numbers and the Deal-won card only). An auto-refresh
 *  keeps the component mounted, so a new value shows straight away and is never counted again. Reduced motion (the OS
 *  setting or Eps.reduced()) shows the value at once. The server renders the final value. */
export function CountUp({ value, className, decimals, prefix, suffix }: { value: number; className?: string } & CountFormat) {
  const [shown, setShown] = useState<number | null>(null);
  const counted = useRef(false);
  const target = useRef(value);
  useEffect(() => {
    target.current = value;
  }, [value]);
  useEffect(() => {
    if (counted.current) return;
    counted.current = true;
    const to = target.current;
    const reduced = eps()?.reduced() ?? window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || to === 0) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      if (t - t0 >= DURATION) return setShown(null);
      setShown(countAt(0, to, t - t0, DURATION));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      setShown(null);
    };
  }, []);
  return <span className={className}>{formatCount(shown ?? value, { decimals, prefix, suffix })}</span>;
}
