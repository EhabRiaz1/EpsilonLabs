"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import { parseMinutes, TIERS } from "@/lib/retainers";
import type { FormResult } from "@/app/components/Forms";

// Retainers and time (E6). Time is logged by the founder only; clients see hours used vs included.

const UUID = /^[0-9a-f-]{36}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function saveRetainer(orgId: string, retainerId: string | null, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(orgId) || (retainerId && !UUID.test(retainerId))) return { error: "Unknown retainer." };
  const tier = s(fd, "tier");
  const t = TIERS.find((x) => x.id === tier);
  if (!t) return { error: "Pick a tier." };
  const hours = t.hours ?? Number(s(fd, "hours"));
  if (!Number.isFinite(hours) || hours <= 0 || hours > 744) return { error: "Hours included must be above 0." };
  const starts = s(fd, "starts_on");
  const ends = s(fd, "ends_on");
  if (!DAY.test(starts) || (ends && !DAY.test(ends))) return { error: "Pick the start (and optional end) date." };
  const status = s(fd, "status") || "active";
  const { error } = await supabase.rpc("save_retainer", {
    p_id: retainerId, p_org_id: orgId, p_tier: tier, p_hours_included: hours, p_starts_on: starts, p_ends_on: ends || null, p_status: status,
  });
  if (error) return { error: /already has an active retainer/.test(error.message) ? "This client already has an active retainer: end it first." : "Couldn't save the retainer. Reload and try again." };
  revalidatePath(`/clients/${orgId}`);
  return { ok: retainerId ? "Retainer saved." : "Retainer started. The client sees hours used vs included in their portal." };
}

export async function logTime(ticketId: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(ticketId)) return { error: "Unknown ticket." };
  const minutes = parseMinutes(s(fd, "time"));
  if (minutes === null) return { error: "Enter the time like 45m, 1h 30m or 1.5h (up to 24h)." };
  const on = s(fd, "worked_on");
  if (on && !DAY.test(on)) return { error: "Pick the day." };
  const note = s(fd, "note");
  if (note.length > 500) return { error: "The note is at most 500 characters." };
  const { error } = await supabase.rpc("log_time", {
    p_org_id: null, p_ticket_id: ticketId, p_minutes: minutes, p_note: note, p_billable: fd.get("billable") === "on", p_worked_on: on || null,
  });
  if (error) return { error: /future/.test(error.message) ? "Time can't be logged in the future." : "Couldn't log the time. Reload and try again." };
  revalidatePath(`/tickets/${ticketId}`);
  return { ok: `Logged ${minutes} min.` };
}

export async function deleteTime(ticketId: string, entryId: string): Promise<FormResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(entryId)) return { error: "Unknown entry." };
  const { error } = await supabase.rpc("delete_time_entry", { p_id: entryId });
  if (error) return { error: "Couldn't delete it." };
  revalidatePath(`/tickets/${ticketId}`);
  return { ok: "Deleted." };
}
