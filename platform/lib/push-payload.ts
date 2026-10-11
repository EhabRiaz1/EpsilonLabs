// Web Push payload for a push_queue row (E5). Pure (unit-tested). The payload carries a short fixed title, an
// optional fixed body, a same-origin path and a tag, and nothing else: never a client's words.

export type PushRow = {
  id: string;
  title: string;
  body: string | null;
  url: string | null;
  kind: string;
  urgent: boolean;
};

export type PushPayload = { title: string; body?: string; url: string; tag: string };

const KINDS = new Set(["draft", "reply", "intake", "ticket", "proposal", "invoice", "agent_error", "test"]);
const PATH = /^\/[A-Za-z0-9/_.?=&-]*$/;

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Only a same-origin path ("/approvals"); anything else ("//evil", "https://…", "javascript:") becomes "/". */
export function safePath(url: string | null | undefined): string {
  const u = (url ?? "").trim();
  if (!PATH.test(u) || u.startsWith("//") || u.includes("..") || u.length > 300) return "/";
  return u;
}

export function buildPushPayload(row: PushRow): PushPayload {
  const kind = KINDS.has(row.kind) ? row.kind : "other";
  const title = clip(row.title || "", 120) || "Epsilon Admin";
  const body = row.body ? clip(row.body, 200) : "";
  // drafts and agent errors replace each other on the lock screen; everything else stacks per item
  const tag = kind === "draft" || kind === "agent_error" ? kind : `${kind}:${row.id}`;
  return { title, ...(body ? { body } : {}), url: safePath(row.url), tag };
}

/** web-push options: high urgency for urgent rows; a day to live (claim_push_batch expires older rows anyway). */
export function pushOptions(row: Pick<PushRow, "urgent">): { TTL: number; urgency: "high" | "normal" } {
  return { TTL: 24 * 60 * 60, urgency: row.urgent ? "high" : "normal" };
}

/** Subscription errors that mean "this device is gone": delete the subscription. */
export function isGoneStatus(status: number | undefined): boolean {
  return status === 404 || status === 410;
}

export const ADMIN_ORIGIN = "https://admin.epsilon-labs.co";

/** The email backstop for an urgent row (push is best-effort): same fixed title, a link into admin, nothing else. */
export function urgentMailFields(row: Pick<PushRow, "title" | "body" | "url">): { subject: string; lines: string[]; link: string } {
  const subject = clip(row.title || "", 120) || "Epsilon Admin alert";
  const lines = [row.body ? clip(row.body, 200) : "", "Also sent as a push notification to your devices."].filter(Boolean);
  return { subject, lines, link: `${ADMIN_ORIGIN}${safePath(row.url)}` };
}
