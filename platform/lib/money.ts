// Money and payment-schedule maths, shared by the deal room, admin and the invoice sheet. Pure (unit-tested).
// Amounts are handled in integer cents so a schedule always adds back up to the total.

export type Stage = { label: string; pct: number };

export const DEFAULT_SCHEDULE: readonly Stage[] = [
  { label: "On signature", pct: 40 },
  { label: "Milestone 2", pct: 40 },
  { label: "On acceptance", pct: 20 },
];

const SYMBOL: Readonly<Record<string, string>> = { USD: "$", EUR: "€", GBP: "£" };

export function toCents(amount: number | string): number {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) throw new Error(`not an amount: ${String(amount)}`);
  return Math.round(n * 100);
}

/** "$7,200" + ".00": the decimals are rendered greyed (design system: big numbers with greyed decimals). */
export function splitMoney(amount: number | string, currency = "USD"): { whole: string; dec: string } {
  const cents = toCents(amount);
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const prefix = SYMBOL[currency] ?? `${currency} `;
  return { whole: `${cents < 0 ? "-" : ""}${prefix}${whole}`, dec: `.${String(abs % 100).padStart(2, "0")}` };
}

export function formatMoney(amount: number | string, currency = "USD"): string {
  const { whole, dec } = splitMoney(amount, currency);
  return whole + dec;
}

/** Plain "18,000.00" (no symbol), as printed on the invoice sheet. */
export function plainAmount(amount: number | string): string {
  const cents = toCents(amount);
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

/** Why a schedule is invalid, or null. Same rules as deal_room_check_schedule() in migration 009. */
export function scheduleError(schedule: readonly Stage[]): string | null {
  if (!Array.isArray(schedule) || schedule.length < 1 || schedule.length > 6) return "A schedule has 1 to 6 stages.";
  for (const s of schedule) {
    const label = typeof s?.label === "string" ? s.label.trim() : "";
    if (!label || label.length > 80) return "Every stage needs a label (up to 80 characters).";
    if (!Number.isInteger(s.pct) || s.pct < 1 || s.pct > 100) return "Percentages are whole numbers from 1 to 100.";
  }
  const sum = schedule.reduce((a, s) => a + s.pct, 0);
  return sum === 100 ? null : `Percentages add up to ${sum}, not 100.`;
}

/**
 * The amount due at each stage. Every stage but the last is round(total × pct), exactly as the database computes
 * the deposit; the last stage takes the remainder, so the stages always add up to the total.
 */
export function scheduleAmounts(total: number | string, schedule: readonly Stage[]): number[] {
  const err = scheduleError(schedule);
  if (err) throw new Error(err);
  const cents = toCents(total);
  const out: number[] = [];
  let used = 0;
  schedule.forEach((s, i) => {
    const c = i === schedule.length - 1 ? cents - used : Math.round((cents * s.pct) / 100);
    used += c;
    out.push(c / 100);
  });
  return out;
}
