"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";

export type OppResult = { ok: boolean; error?: string; message?: string; status?: string };
const UUID = /^[0-9a-f-]{36}$/i;
const ACTS = ["bid", "pass", "submitted", "won", "lost"];

/** decide_opportunity (migration 011, = dashboard/actions.opp_decide). Records the decision only; nothing bids. */
export async function decideOpportunity(id: string, act: string, reason: string): Promise<OppResult> {
  if (!UUID.test(id)) return { ok: false, error: "not_found", message: "No such opportunity." };
  if (!ACTS.includes(act)) return { ok: false, error: "unknown_action", message: "Unknown action." };
  const { supabase } = await requireStaff();
  const { data, error } = await supabase.rpc("decide_opportunity", { p_id: id, p_act: act, p_reason: String(reason ?? "").slice(0, 1000) || null });
  if (error) {
    console.error("decide_opportunity failed:", error.message);
    return { ok: false, error: "db_error", message: "Can't reach the database. Nothing was changed." };
  }
  revalidatePath("/opportunities");
  return data as OppResult;
}
