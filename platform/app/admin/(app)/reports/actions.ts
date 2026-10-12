"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import { checkReport, type ReportContent } from "@/lib/report-content";
import { textToReport } from "@/lib/report-text";
import { publishReport } from "@/lib/report-pdf";
import type { FormResult } from "@/app/components/Forms";

// Delivery reports. Draft → (edit) → Approve & publish: approve_report freezes the content as the staff user (aal2,
// audited), then the server renders the R2 PDF once and the service role marks it published (F15).

const UUID = /^[0-9a-f-]{36}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function queueReport(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const { supabase } = await requireStaff();
  const project = s(fd, "project_id");
  const from = s(fd, "period_start");
  const to = s(fd, "period_end");
  const notes = s(fd, "notes");
  if (!UUID.test(project)) return { error: "Pick a project." };
  if (!DAY.test(from) || !DAY.test(to) || to < from) return { error: "Pick the period (start before end)." };
  if (notes.length > 4000) return { error: "Notes are at most 4,000 characters." };
  const { data, error } = await supabase.rpc("queue_report_draft", { p_project_id: project, p_period_start: from, p_period_end: to, p_notes: notes || null });
  if (error) {
    console.error("queue_report_draft failed:", error.message);
    return { error: /400 days/.test(error.message) ? "Pick a period of at most 400 days." : "Couldn't queue the draft. Reload and try again." };
  }
  revalidatePath("/reports");
  return { ok: (data as { already?: boolean })?.already ? "A draft for this project is already being written." : "Queued. The Mac drafts it (a few minutes); you get a push when it is ready." };
}

const BLANK = (title: string): ReportContent => ({
  title,
  subtitle: "",
  summary: ["Write the executive summary here."],
  kpis: [],
  measures: [],
  sections: [{ title: "Work delivered", intro: "", callout: null, rows: [] }],
  verification: [],
  outstanding: [],
});

export async function createBlankReport(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const { supabase } = await requireStaff();
  const project = s(fd, "project_id");
  const title = s(fd, "title");
  if (!UUID.test(project)) return { error: "Pick a project." };
  if (!title || title.length > 120) return { error: "Give it a title (the product or project name)." };
  const { data, error } = await supabase.rpc("save_report_draft", { p_id: null, p_project_id: project, p_title: title, p_period_label: s(fd, "period_label").slice(0, 80), p_content: BLANK(title) });
  if (error) return { error: "Couldn't create the report. Reload and try again." };
  revalidatePath("/reports");
  redirect(`/reports/${data as string}`);
}

export async function saveReport(id: string, periodLabel: string, text: string): Promise<FormResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(id)) return { error: "Unknown report." };
  const parsed = textToReport(text);
  if (!parsed.ok) return { error: parsed.error };
  const checked = checkReport(parsed.content);
  if (!checked.ok) return { error: checked.error };
  const label = String(periodLabel ?? "").trim();
  if (label.length > 80) return { error: "The period label is at most 80 characters." };
  const { error } = await supabase.rpc("save_report_draft", {
    p_id: id, p_project_id: null, p_title: checked.content.title.slice(0, 200), p_period_label: label, p_content: checked.content,
  });
  if (error) {
    console.error("save_report_draft failed:", error.message);
    return { error: /frozen/.test(error.message) ? "A published report can't change. Void it and draft a new one." : "That didn't save. Reload and try again." };
  }
  revalidatePath(`/reports/${id}`);
  return { ok: "Saved as a draft." };
}

export async function approveAndPublish(id: string): Promise<FormResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(id)) return { error: "Unknown report." };
  const { error } = await supabase.rpc("approve_report", { p_id: id });
  if (error) {
    return { error: /summary and sections/.test(error.message) ? "The report needs a summary and at least one section." : /only a draft/.test(error.message) ? "This report was voided." : "Couldn't approve. Reload and try again." };
  }
  const r = await publishReport(id);
  revalidatePath(`/reports/${id}`);
  revalidatePath("/reports");
  if (!r.ok) {
    console.error(`report ${id}: publish failed: ${r.error}`);
    return { error: `Approved, but the PDF couldn't be stored (${r.error.slice(0, 160)}). Nothing reached the client; press Publish again.` };
  }
  return { ok: r.already ? "Already published." : "Published. The PDF is stored and the client's team is emailed now." };
}

export async function voidReport(id: string): Promise<FormResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(id)) return { error: "Unknown report." };
  const { error } = await supabase.rpc("void_report", { p_id: id });
  if (error) return { error: "Couldn't void it. Reload and try again." };
  revalidatePath(`/reports/${id}`);
  revalidatePath("/reports");
  return { ok: "Voided. The client no longer sees it." };
}
