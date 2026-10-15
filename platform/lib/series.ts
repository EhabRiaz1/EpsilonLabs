// Per-day series for KPI sparklines and trend charts (design review D10). Pure (unit-tested in series.test.ts).
// Days are Asia/Karachi calendar days, the founder's clock, the same as every other admin count.
import { pktDate } from "./admin-ops";
import { dayMonth } from "./dates";

/** The last `n` PKT days as yyyy-mm-dd, oldest first; the last one is today. */
export function lastDays(now: Date, n = 14): string[] {
  return Array.from({ length: n }, (_, i) => pktDate(new Date(now.getTime() - (n - 1 - i) * 86_400_000)));
}

/** How many timestamps fall on each day of `days` (nulls, bad dates and days outside the window are ignored). */
export function perDay(stamps: (string | null | undefined)[], days: string[]): number[] {
  const at = new Map(days.map((d, i) => [d, i]));
  const out = days.map(() => 0);
  for (const s of stamps) {
    if (!s) continue;
    const t = Date.parse(s);
    if (Number.isNaN(t)) continue;
    const i = at.get(pktDate(new Date(t)));
    if (i !== undefined) out[i] += 1;
  }
  return out;
}

/** D10: a sparkline is drawn only when it has signal, at least `min` non-zero points. */
export function hasSignal(series: number[] | null | undefined, min = 3): boolean {
  return (series ?? []).filter((v) => v !== 0).length >= min;
}

/** Chart axis labels: the first day, the middle one and "Today" (the rest blank). */
export function dayLabels(days: string[]): string[] {
  const mid = Math.floor(days.length / 2);
  return days.map((d, i) => (i === days.length - 1 ? "Today" : i === 0 || i === mid ? dayMonth(`${d}T12:00:00+05:00`) : ""));
}

/** The last 7 days against the 7 before ("+3 vs last week"). Null when both weeks are empty or the series is short. */
export function weekDelta(series: number[]): { text: string; dir: "up" | "down" | "flat" } | null {
  if (series.length < 14) return null;
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const now = sum(series.slice(-7));
  const before = sum(series.slice(-14, -7));
  if (!now && !before) return null;
  const d = now - before;
  return d === 0 ? { text: "same as last week", dir: "flat" } : { text: `${d > 0 ? "+" : "−"}${Math.abs(d)} vs last week`, dir: d > 0 ? "up" : "down" };
}
