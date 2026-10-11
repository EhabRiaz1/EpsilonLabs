// Proposal links and accept codes. Pure (unit-tested); the secret is passed in by server-only callers.
import { createHash, createHmac } from "node:crypto";

/** Shape of a proposal link token (base64url). Matches proposal_by_token() in migration 009. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * The link token for a proposal: HMAC-SHA256(secret, id). Only sha256(token) is stored, so the database alone can
 * never produce a working link; with the server secret, admin can show "Copy link" again at any time.
 */
export function proposalToken(secret: string, proposalId: string): string {
  if (!secret || secret.length < 32) throw new Error("PROPOSAL_LINK_SECRET must be at least 32 characters");
  if (!/^[0-9a-f-]{36}$/i.test(proposalId)) throw new Error("invalid proposal id");
  return createHmac("sha256", secret).update(`proposal-link:v1:${proposalId.toLowerCase()}`).digest("base64url");
}

export function isToken(s: unknown): s is string {
  return typeof s === "string" && TOKEN_RE.test(s);
}

/** A 6-digit accept code, after stripping spaces and dashes people paste in. */
export function normaliseCode(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const d = s.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(d) ? d : null;
}

/** "3f9a…c21e": a fingerprint short enough to read aloud. */
export function shortHash(h: string | null | undefined): string {
  return h && h.length >= 8 ? `${h.slice(0, 4)}…${h.slice(-4)}` : "";
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]+(%\w+)?$/i;

/** The client IP from the platform's forwarding headers (first hop), or null if it isn't a plain IP. */
export function clientIp(get: (name: string) => string | null): string | null {
  const raw = (get("x-forwarded-for") ?? "").split(",")[0].trim() || (get("x-real-ip") ?? "").trim();
  if (IPV4.test(raw)) return raw;
  if (raw.includes(":") && IPV6.test(raw) && raw.length <= 45) return raw;
  return null;
}
