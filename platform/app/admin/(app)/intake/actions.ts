"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import { INTAKE_STATUSES, type IntakeStatus } from "@/lib/intake";

export type IntakeResult = { ok?: string; error?: string } | undefined;
const UUID = /^[0-9a-f-]{36}$/i;

export async function setIntakeStatus(id: string, status: IntakeStatus): Promise<IntakeResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(id) || !INTAKE_STATUSES.includes(status)) return { error: "Unknown enquiry or status." };
  const { error } = await supabase.rpc("set_intake_status", { p_id: id, p_status: status });
  if (error) {
    console.error("set_intake_status failed:", error.message);
    return { error: "That didn't save. Reload and try again." };
  }
  revalidatePath("/intake");
  revalidatePath(`/intake/${id}`);
  return { ok: status === "spam" ? "Marked as spam; the lead it opened is closed." : `Marked ${status}.` };
}

/** Marks the enquiry converted and opens a proposal draft prefilled from it (the founder edits before sending). */
export async function convertToProposal(id: string): Promise<IntakeResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(id)) return { error: "Unknown enquiry." };
  const { data } = await supabase.from("intake").select("deal_id").eq("id", id).maybeSingle();
  if (!data?.deal_id) return { error: "This enquiry has no deal to propose against." };
  const { error } = await supabase.rpc("set_intake_status", { p_id: id, p_status: "converted" });
  if (error) return { error: "That didn't save. Reload and try again." };
  revalidatePath("/intake");
  redirect(`/proposals/new?deal=${data.deal_id}&intake=${id}`);
}
