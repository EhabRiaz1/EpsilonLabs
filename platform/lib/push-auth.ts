// Bearer check for the push sender route (the Mac worker POSTs every minute; Vercel Hobby cron is daily only).
// Pure apart from node:crypto (unit-tested). Refuses when the secret is unset or short.
import { createHash, timingSafeEqual } from "node:crypto";

const MIN_SECRET = 32;

export function bearerOk(header: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || secret.length < MIN_SECRET) return false;
  const m = /^Bearer ([A-Za-z0-9._~+/=-]{1,512})$/.exec((header ?? "").trim());
  if (!m) return false;
  // compare fixed-length digests so neither length nor content leaks through timing
  const a = createHash("sha256").update(m[1]).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}
