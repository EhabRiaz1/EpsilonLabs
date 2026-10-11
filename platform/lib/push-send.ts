import "server-only";
import webpush from "web-push";
import { createServiceClient } from "@/lib/supabase/service";
import { sendMail } from "@/lib/mail";
import { founderNotice } from "@/lib/mail-templates";
import { buildPushPayload, isGoneStatus, pushOptions, urgentMailFields, type PushRow } from "@/lib/push-payload";

// The push sender (E5). Runs as the service role: claim_push_batch / finish_push are service-only, and it reads every
// staff user's subscriptions. Called only by app/admin/api/cron/push (bearer secret). A documented F11 narrowing,
// enforced by eslint.config.mjs like the deal room.

type QueueRow = PushRow & { user_id: string; emailed_at: string | null };
type Sub = { id: string; user_id: string; endpoint: string; keys: { p256dh: string; auth: string } };
export type SendCounts = { claimed: number; sent: number; failed: number; removed: number; emailed: number };

function vapid(): boolean {
  const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: subject } = process.env;
  if (!pub || !priv || !subject) return false;
  webpush.setVapidDetails(subject, pub, priv);
  return true;
}

function statusOf(e: unknown): number | undefined {
  return typeof e === "object" && e && "statusCode" in e ? Number((e as { statusCode: unknown }).statusCode) : undefined;
}

export async function sendPushBatch(limit = 50): Promise<SendCounts> {
  const db = createServiceClient();
  const counts: SendCounts = { claimed: 0, sent: 0, failed: 0, removed: 0, emailed: 0 };
  const { data: claimed, error } = await db.rpc("claim_push_batch", { p_limit: limit });
  if (error) throw new Error(`claim_push_batch: ${error.message}`);
  const rows = (claimed ?? []) as QueueRow[];
  counts.claimed = rows.length;
  if (!rows.length) return counts;

  const users = [...new Set(rows.map((r) => r.user_id))];
  const [{ data: subsData, error: subErr }, { data: staffData, error: staffErr }] = await Promise.all([
    db.from("push_subscriptions").select("id, user_id, endpoint, keys").in("user_id", users),
    db.from("staff").select("user_id, email").in("user_id", users),
  ]);
  if (subErr) throw new Error(`push_subscriptions: ${subErr.message}`);
  if (staffErr) throw new Error(`staff: ${staffErr.message}`);
  const subs = (subsData ?? []) as Sub[];
  const emailOf = new Map(((staffData ?? []) as { user_id: string; email: string }[]).map((s) => [s.user_id, s.email]));
  const canPush = vapid();
  const gone = new Set<string>();

  for (const row of rows) {
    const mine = subs.filter((s) => s.user_id === row.user_id && !gone.has(s.id));
    const payload = JSON.stringify(buildPushPayload(row));
    let delivered = 0;
    let lastError = canPush ? (mine.length ? "" : "no subscription") : "VAPID keys not set";
    if (canPush) {
      for (const s of mine) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, pushOptions(row));
          delivered += 1;
        } catch (e) {
          const st = statusOf(e);
          if (isGoneStatus(st)) {
            gone.add(s.id);
            const { error: delErr } = await db.from("push_subscriptions").delete().eq("id", s.id);
            if (!delErr) counts.removed += 1;
            lastError = `subscription gone (${st})`;
          } else {
            lastError = `push failed${st ? ` (${st})` : ""}`;
          }
        }
      }
    }
    // urgent: email is the backstop, whatever happened to the push (Reliability baseline)
    let emailed = false;
    const to = emailOf.get(row.user_id);
    if (row.urgent && !row.emailed_at && to) {
      try {
        await sendMail(to, founderNotice(urgentMailFields(row)));
        emailed = true;
        counts.emailed += 1;
      } catch (e) {
        console.error("push: urgent email failed:", e instanceof Error ? e.name : "error");
      }
    }
    const ok = delivered > 0;
    if (ok) counts.sent += 1;
    else counts.failed += 1;
    const { error: finErr } = await db.rpc("finish_push", { p_id: row.id, p_sent: ok, p_error: ok ? null : lastError, p_emailed: emailed });
    if (finErr) console.error("push: finish_push failed:", finErr.code ?? "error");
  }
  return counts;
}
