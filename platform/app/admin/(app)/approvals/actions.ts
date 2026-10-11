"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";

/** The Deck rulebook's result (migration 011): same codes and messages as the 8787 cockpit. */
export type DeckResult = {
  ok: boolean;
  error?: string;
  message?: string;
  status?: string;
  already?: boolean;
  lint?: { type: string; text: string }[];
};
const UUID = /^[0-9a-f-]{36}$/i;
const DB_DOWN: DeckResult = { ok: false, error: "db_error", message: "Can't reach the database. Nothing was changed." };

async function deck(fn: string, args: Record<string, unknown>): Promise<DeckResult> {
  if (!UUID.test(String(args.p_id ?? ""))) return { ok: false, error: "not_found", message: "Draft not found." };
  const { supabase } = await requireStaff();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    console.error(`${fn} failed:`, error.message);
    return DB_DOWN;
  }
  revalidatePath("/approvals");
  return (data ?? DB_DOWN) as DeckResult;
}

/** Recorded at once; the Mac's outbox sends it after the undo window (OV1). */
export async function approveDraft(id: string, confirmLint: boolean): Promise<DeckResult> {
  return deck("approve_draft", { p_id: id, p_confirm_lint: Boolean(confirmLint) });
}

/** An edit made here goes to edited_pending_lint: the Mac lints it before the outbox may claim it (EN5). */
export async function editAndApproveDraft(id: string, body: string, confirmLint: boolean): Promise<DeckResult> {
  const text = String(body ?? "");
  if (!text.trim()) return { ok: false, error: "empty", message: "Draft is empty. Write something before sending." };
  if (text.length > 20000) return { ok: false, error: "too_long", message: "Draft is too long (20,000 characters at most)." };
  return deck("edit_and_approve_draft", { p_id: id, p_body: text, p_confirm_lint: Boolean(confirmLint) });
}

export async function undoDecision(id: string): Promise<DeckResult> {
  return deck("undo_decision", { p_id: id });
}

/** Called only when the 10 s undo toast runs out (the undo itself never reaches the server). */
export async function rejectDraft(id: string, reason: string): Promise<DeckResult> {
  return deck("reject_draft", { p_id: id, p_reason: String(reason ?? "").slice(0, 300) || null });
}

export async function holdDraft(id: string): Promise<DeckResult> {
  return deck("hold_draft", { p_id: id });
}

export async function releaseHeldDraft(id: string): Promise<DeckResult> {
  return deck("release_held_draft", { p_id: id });
}
