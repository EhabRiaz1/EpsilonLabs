// CountUp maths (design review D10). Pure (unit-tested in count-up.test.ts); the component is app/components/CountUp.tsx.

export type CountFormat = { decimals?: number; prefix?: string; suffix?: string };

/** 1234.5 → "1,235" (or "$1,234.50" with { decimals: 2, prefix: "$" }). Negative values keep their sign. */
export function formatCount(n: number, f: CountFormat = {}): string {
  const d = f.decimals ?? 0;
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${n < 0 ? "−" : ""}${f.prefix ?? ""}${s}${f.suffix ?? ""}`;
}

/** Ease-out cubic value at time `t` of a `dur` ms count from `from` to `to`; exactly `to` at and after the end. */
export function countAt(from: number, to: number, t: number, dur: number): number {
  if (dur <= 0 || t >= dur) return to;
  const p = 1 - Math.pow(1 - Math.max(0, t) / dur, 3);
  return from + (to - from) * p;
}
