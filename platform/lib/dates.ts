// Server-rendered dates in an explicit time zone, so server and client never disagree.

export function greeting(now: Date, timeZone: string): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(now));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function longDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone }).format(now);
}
