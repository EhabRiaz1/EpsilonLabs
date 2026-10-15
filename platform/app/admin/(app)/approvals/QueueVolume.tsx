import { TrendChart } from "@/app/components/TrendChart";
import { Note } from "@/app/components/Note";
import { getSession } from "@/lib/session";
import { pktMidnight } from "@/lib/admin-ops";
import { dayLabels, lastDays, perDay } from "@/lib/series";

/** Approval queue volume, last 14 PKT days: items received and decided per day. Moved from Approvals to Health by
 *  design review D5 (Approvals leads with the queue itself). */
export async function QueueVolume() {
  const { supabase } = await getSession();
  const now = new Date();
  const since14 = pktMidnight(now, 13);
  const days = lastDays(now, 14);
  const [created14, decided14] = await Promise.all([
    supabase.from("approval_queue").select("created_at").gte("created_at", since14).limit(1000),
    supabase.from("approval_queue").select("decided_at").gte("decided_at", since14).limit(1000),
  ]);
  const received = perDay(((created14.data ?? []) as { created_at: string }[]).map((r) => r.created_at), days);
  const done = perDay(((decided14.data ?? []) as { decided_at: string | null }[]).map((r) => r.decided_at), days);
  return (
    <section className="panel chart-panel queue-volume" aria-label="Approval queue volume">
      <div className="row between">
        <h2 className="t-16">Approval queue · last 14 days</h2>
        <span className="c-3 t-12 mono">
          {received[13]} in · {done[13]} decided today
        </span>
      </div>
      {created14.error || decided14.error ? (
        <Note tone="error" retry>
          Couldn&apos;t read the queue history.
        </Note>
      ) : (
        <TrendChart labels={dayLabels(days)} series={[{ name: "Received", data: received }, { name: "Decided", data: done }]} aria="Queue items received and decided per day, last 14 days" />
      )}
    </section>
  );
}
