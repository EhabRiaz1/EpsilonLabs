"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";

export type SettingsResult = { ok: boolean; error?: string; message?: string; errors?: Record<string, string>; changed?: string[] };

/** save_settings (migration 011): validation identical to the 8787 /settings form; one bad field saves nothing. */
export async function saveSettings(p: Record<string, string | string[]>): Promise<SettingsResult> {
  const { supabase } = await requireStaff();
  // only the form's own shape goes through: string or string[] values, a bounded number of fields
  const clean: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(p ?? {}).slice(0, 80)) {
    if (!/^[a-z0-9_]{1,40}$/.test(k)) continue;
    if (typeof v === "string") clean[k] = v.slice(0, 2000);
    else if (Array.isArray(v)) clean[k] = v.slice(0, 40).map((x) => String(x).slice(0, 40));
  }
  const { data, error } = await supabase.rpc("save_settings", { p: clean });
  if (error) {
    console.error("save_settings failed:", error.message);
    return { ok: false, error: "db_error", message: "Can't reach the database. Nothing was saved." };
  }
  revalidatePath("/settings");
  return data as SettingsResult;
}
