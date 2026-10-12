import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { sendMail } from "@/lib/mail";
import { notificationEmail } from "@/lib/mail-templates";
import { summarise, type MailJob } from "@/lib/digest";

// The portal mailer (012, F9). Runs as the service role: claim_email_batch / finish_email are service-only (they read
// every user's address and preference). Called only by app/admin/api/cron/digest (bearer secret), every 5 minutes by
// the Mac worker. A documented F11 narrowing, enforced by eslint.config.mjs like the push sender.
//
// The database decides what is due (urgent now; the rest in one digest per person per day at 10:00 local; preference;
// suppression; test orgs) and claims it, so overlapping calls never send the same row twice. A send that fails is
// returned to pending (3 attempts); a sender that dies leaves a claim that lapses after 10 minutes and is retried.

export type DigestCounts = { emails: number; items: number; digests: number; sent: number; failed: number; overdue: number };

export async function runDigest(): Promise<DigestCounts> {
  const db = createServiceClient();
  // overdue invoices ride on the same 5-minute clock (idempotent)
  const { data: overdue, error: odErr } = await db.rpc("mark_overdue_invoices", { p_today: null });
  if (odErr) console.error("digest: mark_overdue_invoices failed:", odErr.code ?? "error");

  // at most 25 people per call (every 5 minutes): bounded run time and a gentle rate on the Zoho mailbox
  const { data, error } = await db.rpc("claim_email_batch", { p_now: null, p_limit: 25 });
  if (error) throw new Error(`claim_email_batch: ${error.message}`);
  const batch = (data ?? { claim: null, emails: [] }) as { claim: string; emails: MailJob[] };
  const counts: DigestCounts = { ...summarise(batch.emails), sent: 0, failed: 0, overdue: Number(overdue ?? 0) };
  for (const job of batch.emails) {
    let ok = false;
    let err: string | null = null;
    try {
      await sendMail(job.to, notificationEmail({ name: job.name, items: job.items, mode: job.mode, timezone: job.timezone }));
      ok = true;
    } catch (e) {
      // the SMTP reply only (never the address): it is stored on the rows for the Health panel
      err = e instanceof Error ? e.message.slice(0, 200) : "send failed";
    }
    if (ok) counts.sent += 1;
    else counts.failed += 1;
    const { error: finErr } = await db.rpc("finish_email", { p_claim: batch.claim, p_user_id: job.user_id, p_ok: ok, p_error: err });
    if (finErr) console.error("digest: finish_email failed:", finErr.code ?? "error");
  }
  return counts;
}
