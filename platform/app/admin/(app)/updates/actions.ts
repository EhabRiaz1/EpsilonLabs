"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import type { FormResult } from "@/app/components/Forms";

// Weekly / manual updates (E2). Every write is an RPC from migration 012 (staff with aal2, audited). Publishing is the
// only path for AI-drafted wording to reach a client (F13).

const UUID = /^[0-9a-f-]{36}$/i;
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function refresh() {
  revalidatePath("/updates");
  revalidatePath("/approvals");
}

function friendly(msg: string, fallback: string): string {
  if (/only a draft|published update|skipped update/.test(msg)) return "This update was already published or skipped. Reload.";
  if (/empty/.test(msg)) return "The update is empty.";
  if (/title 1-200/.test(msg)) return "The title is 1-200 characters and the body at most 20,000.";
  return fallback;
}

export async function saveUpdate(id: string, title: string, body: string): Promise<FormResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(id)) return { error: "Unknown update." };
  const { error } = await supabase.rpc("edit_update", { p_id: id, p_title: String(title ?? "").trim(), p_body_md: String(body ?? "") });
  if (error) return { error: friendly(error.message, "That didn't save. Reload and try again.") };
  refresh();
  return { ok: "Saved. Still a draft: the client sees it only when you publish." };
}

export async function publishUpdate(id: string): Promise<FormResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(id)) return { error: "Unknown update." };
  const { data, error } = await supabase.rpc("publish_update", { p_id: id });
  if (error) return { error: friendly(error.message, "Couldn't publish. Reload and try again.") };
  refresh();
  return { ok: (data as { already?: boolean })?.already ? "Already published." : "Published to the client's portal. Their team is notified in the next digest." };
}

export async function editAndPublishUpdate(id: string, title: string, body: string): Promise<FormResult> {
  const saved = await saveUpdate(id, title, body);
  if (saved?.error) return saved;
  return publishUpdate(id);
}

export async function skipUpdate(id: string, reason: string): Promise<FormResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(id)) return { error: "Unknown update." };
  const { error } = await supabase.rpc("skip_update", { p_id: id, p_reason: String(reason ?? "").slice(0, 300) || null });
  if (error) return { error: friendly(error.message, "Couldn't skip. Reload and try again.") };
  refresh();
  return { ok: "Skipped. Nothing was sent." };
}

/** "Draft now": a weekly_update job for this week; the Mac drafts it (queued until the Mac is back). */
export async function queueWeekly(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const { supabase } = await requireStaff();
  const project = s(fd, "project_id");
  const notes = s(fd, "notes");
  if (!UUID.test(project)) return { error: "Pick a project." };
  if (notes.length > 2000) return { error: "Notes are at most 2,000 characters." };
  const { data, error } = await supabase.rpc("queue_weekly_update", { p_project_id: project, p_notes: notes || null });
  if (error) {
    console.error("queue_weekly_update failed:", error.message);
    return { error: "Couldn't queue the draft. Reload and try again." };
  }
  refresh();
  return { ok: (data as { already?: boolean })?.already ? "Already queued for this week; the Mac drafts it shortly." : "Queued. The Mac drafts it within a few minutes; it lands in Approvals." };
}

/** A post written by the founder (no AI): saved as a draft, published from the list. */
export async function createManualUpdate(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const { supabase } = await requireStaff();
  const project = s(fd, "project_id");
  const title = s(fd, "title");
  const body = String(fd.get("body") ?? "");
  if (!UUID.test(project)) return { error: "Pick a project." };
  if (!title || title.length > 200) return { error: "Give it a title (1-200 characters)." };
  if (!body.trim()) return { error: "Write the update." };
  const { error } = await supabase.rpc("save_update_draft", { p_project_id: project, p_title: title, p_body_md: body, p_source: "manual" });
  if (error) return { error: friendly(error.message, "Couldn't save the draft. Reload and try again.") };
  refresh();
  return { ok: "Saved as a draft below. Publish it when it reads right." };
}
