"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import { AUDIT_PAGE, auditSince } from "@/lib/health";
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

export type AuditRow = { id: string; at: string; agent: string; action: string; target_table: string | null; cost_usd: number | null };
export type AuditQuery = { agent: string; action: string; window: "24h" | "7d"; page: number };
export type AuditResult = { rows: AuditRow[]; more: boolean; error?: string };

/** One page of the audit log (the actions table) for the Health sheet: optional actor and kind filters, last 24 h or
 *  last 7 days, newest first. */
export async function loadAudit(q: AuditQuery): Promise<AuditResult> {
  const { supabase } = await requireStaff();
  const page = Math.max(0, Math.min(1000, Math.floor(Number(q.page) || 0)));
  let s = supabase
    .from("actions")
    .select("id, at, agent, action, target_table, cost_usd")
    .gte("at", auditSince(q.window, new Date()))
    .order("at", { ascending: false })
    // one extra row tells whether there is a next page
    .range(page * AUDIT_PAGE, page * AUDIT_PAGE + AUDIT_PAGE);
  if (q.agent) s = s.eq("agent", String(q.agent));
  if (q.action) s = s.eq("action", String(q.action));
  const { data, error } = await s;
  if (error) {
    console.error("audit log read failed:", error.message);
    return { rows: [], more: false, error: "Couldn't read the audit log." };
  }
  const rows = (data ?? []) as AuditRow[];
  return { rows: rows.slice(0, AUDIT_PAGE), more: rows.length > AUDIT_PAGE };
}
