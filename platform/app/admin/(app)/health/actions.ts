"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import type { FormResult } from "@/app/components/Forms";

/** Usage guard (015): settings agent.daily_token_budget and the agent.enabled kill switch, through save_agent_settings. */
export async function saveAgentBudget(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const { supabase } = await requireStaff();
  const raw = String(fd.get("budget") ?? "").replace(/[,_\s]/g, "");
  if (!/^\d{1,9}$/.test(raw)) return { error: "Enter a whole number of tokens." };
  const budget = Number(raw);
  if (budget < 10_000 || budget > 100_000_000) return { error: "The daily budget is 10,000 to 100,000,000 tokens." };
  const { error } = await supabase.rpc("save_agent_settings", { p_daily_token_budget: budget, p_enabled: fd.get("enabled") === "on" });
  if (error) {
    console.error("save_agent_settings failed:", error.message);
    return { error: "That didn't save. Reload and try again." };
  }
  revalidatePath("/health");
  return { ok: "Saved. The Mac checks it before every brief, plan and agent run." };
}
