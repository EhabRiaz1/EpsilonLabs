// Retainer tiers (E6) and usage maths. Pure (unit-tested).
//
// The tiers live here, NOT in tools/offers.py (the founder's website source of truth). TODO(founder): add the retainer
// tiers to tools/offers.py when they are ready to be sold on epsilon-labs.co; keep the ids and hours in step.
// The database checks the same ids (retainers.tier in r10 | r20 | r40 | custom).

export type TierId = "r10" | "r20" | "r40" | "custom";
export const TIERS: readonly { id: TierId; label: string; hours: number | null; blurb: string }[] = [
  { id: "r10", label: "Retainer 10", hours: 10, blurb: "10 hours a month: fixes, small changes, questions" },
  { id: "r20", label: "Retainer 20", hours: 20, blurb: "20 hours a month: a steady stream of improvements" },
  { id: "r40", label: "Retainer 40", hours: 40, blurb: "40 hours a month: an embedded engineer, part-time" },
  { id: "custom", label: "Custom", hours: null, blurb: "Hours agreed separately" },
];

export const UPSELL_PCT = 85;

export type Period = { period: string; starts_on: string; current: boolean; included_minutes: number; used_minutes: number; pct: number };
export type Usage = {
  retainer: { id: string; tier: TierId; hours_included: number | string; period: string; starts_on: string; ends_on: string | null; status: string } | null;
  periods: Period[];
  over_85: number;
  upsell: boolean | null;
};

export function tierLabel(id: string): string {
  return TIERS.find((t) => t.id === id)?.label ?? id;
}

/** "8h 36m", "45m", "0h" */
export function hm(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return r ? `${r}m` : "0h";
  return r ? `${h}h ${String(r).padStart(2, "0")}m` : `${h}h`;
}

/** Same rule as retainer_usage(): above 85% in at least 2 of the last 3 periods (newest first). */
export function upsell(periods: Pick<Period, "pct">[]): boolean {
  return periods.slice(0, 3).filter((p) => p.pct > UPSELL_PCT).length >= 2;
}

/** Percent used, rounded to one decimal, and how much is left or over. Overage is shown, never billed. */
export function usageLine(p: Pick<Period, "used_minutes" | "included_minutes">): { pct: number; left: string; over: boolean } {
  const pct = p.included_minutes > 0 ? Math.round((p.used_minutes * 1000) / p.included_minutes) / 10 : 0;
  const diff = p.included_minutes - p.used_minutes;
  return { pct, left: diff >= 0 ? `${hm(diff)} left` : `${hm(-diff)} over`, over: diff < 0 };
}

/** Parses "1h 30m", "90", "1.5h", "45m" into minutes (1-1440), or null. */
export function parseMinutes(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  let m: RegExpExecArray | null;
  let v: number;
  if ((m = /^(\d{1,2})\s*h(?:\s*(\d{1,2})\s*m?)?$/.exec(s))) v = Number(m[1]) * 60 + Number(m[2] ?? 0);
  else if ((m = /^(\d{1,2}(?:\.\d{1,2})?)\s*h$/.exec(s))) v = Math.round(Number(m[1]) * 60);
  else if ((m = /^(\d{1,4})\s*m?$/.exec(s))) v = Number(m[1]);
  else return null;
  return v >= 1 && v <= 1440 ? v : null;
}
