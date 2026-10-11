// Server-rendered dates in an explicit time zone, so server and client never disagree.

export function greeting(now: Date, timeZone: string): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(now));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function longDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone }).format(now);
}

const PKT = "Asia/Karachi";

/** "25 Oct" */
export function dayMonth(iso: string, timeZone = PKT): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone }).format(dateOf(iso));
}

/** "25 Oct 2026" */
export function dayMonthYear(iso: string, timeZone = PKT): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone }).format(dateOf(iso));
}

/** "11 Oct 2026, 14:32 PKT" */
export function stamp(iso: string, timeZone = PKT): string {
  const d = new Date(iso);
  const t = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(d);
  return `${dayMonthYear(iso, timeZone)}, ${t} ${timeZone === PKT ? "PKT" : timeZone}`;
}

/** Whole days from today (in the time zone) until a yyyy-mm-dd date; negative once it has passed. */
export function daysUntil(isoDate: string, now: Date, timeZone = PKT): number {
  const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(now);
  return Math.round((Date.parse(isoDate) - Date.parse(today)) / 86_400_000);
}

// a bare yyyy-mm-dd is a calendar date: pin it to noon UTC so no time zone moves it to another day
function dateOf(iso: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
}

/** yyyy-mm-dd, `days` from now in the time zone (default valid-until for a new proposal). */
export function isoDaysFromNow(days: number, timeZone = PKT, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(new Date(now.getTime() + days * 86_400_000));
}
