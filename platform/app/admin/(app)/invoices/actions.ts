"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import { parseLines } from "@/lib/invoice-form";
import { ensureInvoicePdf } from "@/lib/invoice-pdf";
import type { FormResult } from "@/app/components/Forms";

// Invoices beyond the deposit (012): milestone / final from an accepted proposal's schedule, or ad-hoc; approve →
// issue (the numbering trigger assigns EL-YYYY-NNN, the org is notified at once) → PDF; mark paid; void a draft;
// credit notes against an issued invoice. Every step is an RPC (staff with aal2, audited).

const UUID = /^[0-9a-f-]{36}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function friendly(msg: string, fallback: string): string {
  const known = [
    /already invoiced/, /no such schedule stage/, /only an accepted proposal/, /name the tax/, /currency must be/, /bill-to company/,
    /tax rate/, /an invoice needs 1-30 lines/, /invalid invoice line/, /line amounts/, /approve the invoice first/, /only a draft/,
    /immutable/, /credit note/, /credit notes reference/, /paid date/, /give the reason/, /cannot exceed/, /total does not match/,
    /only an issued invoice/, /read-only/,
  ];
  return known.some((r) => r.test(msg)) ? msg.replace(/^ERROR:\s*/, "").replace(/\s*CONTEXT:.*$/s, "") : fallback;
}

function fields(fd: FormData): { ok: true; v: Record<string, unknown> } | { ok: false; error: string } {
  const lines = parseLines(String(fd.get("lines") ?? ""));
  if (!lines.ok) return { ok: false, error: lines.error };
  const rateRaw = s(fd, "tax_rate") || "0";
  const rate = Number(rateRaw);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return { ok: false, error: "The tax rate is 0-100." };
  const due = s(fd, "due_date");
  if (due && !DAY.test(due)) return { ok: false, error: "Pick a due date." };
  const currency = s(fd, "currency").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: "The currency is a 3-letter code (USD, PKR, EUR)." };
  return {
    ok: true,
    v: {
      p_bill_company: s(fd, "bill_company"), p_bill_contact: s(fd, "bill_contact"), p_project_label: s(fd, "project_label"),
      p_lines: lines.lines, p_tax_label: s(fd, "tax_label") || null, p_tax_rate: rate, p_currency: currency, p_due_date: due || null,
    },
  };
}

export async function createAdhocInvoice(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const { supabase } = await requireStaff();
  const org = s(fd, "org_id");
  if (!UUID.test(org)) return { error: "Pick the client." };
  const f = fields(fd);
  if (!f.ok) return { error: f.error };
  const { data, error } = await supabase.rpc("create_invoice_draft", { p_org_id: org, ...f.v });
  if (error) return { error: friendly(error.message, "Couldn't create the draft. Reload and try again.") };
  revalidatePath("/invoices");
  redirect(`/invoices/${data as string}`);
}

export async function createScheduleInvoice(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const { supabase } = await requireStaff();
  const [proposal, stageRaw] = s(fd, "stage").split(":");
  const due = s(fd, "due_date");
  if (!UUID.test(proposal ?? "") || !/^\d$/.test(stageRaw ?? "")) return { error: "Pick a proposal stage." };
  if (due && !DAY.test(due)) return { error: "Pick a due date." };
  const { data, error } = await supabase.rpc("invoice_from_schedule", { p_proposal_id: proposal, p_stage: Number(stageRaw), p_due_date: due || null });
  if (error) return { error: friendly(error.message, "Couldn't create the draft. Reload and try again.") };
  revalidatePath("/invoices");
  redirect(`/invoices/${data as string}`);
}

export async function saveInvoiceDraft(id: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(id)) return { error: "Unknown invoice." };
  const f = fields(fd);
  if (!f.ok) return { error: f.error };
  const { error } = await supabase.rpc("update_invoice_draft", { p_id: id, ...f.v });
  if (error) return { error: friendly(error.message, "That didn't save. Reload and try again.") };
  revalidatePath(`/invoices/${id}`);
  return { ok: "Saved as a draft. Approve it when it is right." };
}

export async function approveInvoice(id: string): Promise<FormResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(id)) return { error: "Unknown invoice." };
  const { error } = await supabase.rpc("approve_invoice", { p_id: id });
  if (error) return { error: friendly(error.message, "Couldn't approve. Reload and try again.") };
  revalidatePath(`/invoices/${id}`);
  return { ok: "Approved. Issue it to number it and notify the client." };
}

/** Issue: the number is assigned, the client's team is notified (emailed at once), and the PDF is stored once. */
export async function issueInvoice(id: string): Promise<FormResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(id)) return { error: "Unknown invoice." };
  const { data, error } = await supabase.rpc("issue_invoice", { p_id: id });
  if (error) return { error: friendly(error.message, "Couldn't issue. Reload and try again.") };
  const number = (data as { number?: string })?.number ?? "";
  const pdf = await ensureInvoicePdf(id);
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
  return { ok: `Issued as ${number}. The client is notified now.${pdf.ok ? " PDF stored." : " The PDF is rendered on the first download."}` };
}

export async function markInvoicePaid(id: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const { supabase } = await requireStaff();
  const on = s(fd, "paid_on");
  if (!UUID.test(id)) return { error: "Unknown invoice." };
  if (!DAY.test(on)) return { error: "Pick the date the payment arrived." };
  const { error } = await supabase.rpc("mark_invoice_paid", { p_id: id, p_paid_on: on });
  if (error) return { error: friendly(error.message, "Couldn't mark it paid. Reload and try again.") };
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
  return { ok: "Marked paid." };
}

export async function voidInvoice(id: string): Promise<FormResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(id)) return { error: "Unknown invoice." };
  const { error } = await supabase.rpc("void_invoice", { p_id: id });
  if (error) return { error: friendly(error.message, "Couldn't void it. Reload and try again.") };
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
  return { ok: "Voided. No number was used." };
}

export async function createCreditNote(id: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(id)) return { error: "Unknown invoice." };
  const lines = parseLines(String(fd.get("lines") ?? ""));
  if (!lines.ok) return { error: lines.error };
  const reason = s(fd, "reason");
  if (reason.length < 3 || reason.length > 500) return { error: "Give the reason for the credit (3-500 characters)." };
  const { data, error } = await supabase.rpc("create_credit_note", { p_invoice_id: id, p_lines: lines.lines, p_reason: reason });
  if (error) return { error: friendly(error.message, "Couldn't create the credit note. Reload and try again.") };
  revalidatePath("/invoices");
  redirect(`/invoices/${data as string}`);
}
