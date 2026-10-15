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

export type BulkResult = { ok: boolean; passed: number; failed: number; message: string };

/** "Pass all ineligible": decide_opportunity(…, 'pass') once per id (no bulk RPC exists), same rules and audit row as
 *  a single Pass. The page calls it only when its 8 s undo toast runs out, so Undo never reaches the server. */
export async function passOpportunities(ids: string[]): Promise<BulkResult> {
  const list = [...new Set((Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string" && UUID.test(x)))].slice(0, 500);
  if (!list.length) return { ok: false, passed: 0, failed: 0, message: "Nothing to pass." };
  const { supabase } = await requireStaff();
  let passed = 0;
  let failed = 0;
  for (const id of list) {
    const { data, error } = await supabase.rpc("decide_opportunity", { p_id: id, p_act: "pass", p_reason: null });
    if (error) {
      console.error("decide_opportunity (bulk pass) failed:", error.message);
      failed += 1;
    } else if ((data as OppResult | null)?.ok) passed += 1;
    else failed += 1;
  }
  revalidatePath("/opportunities");
  return {
    ok: failed === 0,
    passed,
    failed,
    message: failed ? `Passed ${passed}; ${failed} didn't change (already decided or the database didn't answer).` : `Passed ${passed}`,
  };
}
