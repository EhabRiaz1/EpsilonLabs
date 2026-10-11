"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";

export type RunResult = { ok: boolean; already?: boolean; error?: string; message?: string };

/** "Run now": queues a run_agent job (allow-list prospector | tenders | brief, enforced by queue_run_agent and a
 * CHECK). The Mac worker claims it within a minute and starts the launchd job; nothing runs on Vercel. */
export async function runAgentNow(agent: string): Promise<RunResult> {
  if (!["prospector", "tenders", "brief"].includes(agent)) return { ok: false, message: "That job can't be started from here." };
  const { supabase } = await requireStaff();
  const { data, error } = await supabase.rpc("queue_run_agent", { p_agent: agent });
  if (error) {
    console.error("queue_run_agent failed:", error.message);
    return { ok: false, message: "Can't reach the database. Nothing was queued." };
  }
  revalidatePath("/agents");
  return data as RunResult;
}
