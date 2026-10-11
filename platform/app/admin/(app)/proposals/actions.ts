"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff";
import { priceLines, type LineInput } from "@/lib/packages";
import { scheduleError, type Stage } from "@/lib/money";
import { proposalLink } from "@/lib/proposal-link";
import { clientOrigin } from "@/lib/host";
import { sendMail } from "@/lib/mail";
import { proposalLinkEmail } from "@/lib/mail-templates";
import { dayMonthYear, isoDaysFromNow } from "@/lib/dates";

export type ActionState = { error?: string; ok?: string; url?: string } | undefined;

type Fields = {
  p_title: string;
  p_client_company: string;
  p_contact_name: string;
  p_contact_email: string;
  p_summary: string;
  p_scope_md: string;
  p_timeline_md: string;
  p_changes_md: string;
  p_lines: ReturnType<typeof priceLines>;
  p_schedule: Stage[];
  p_valid_until: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Reads the proposal form. Prices come from the catalogue here, whatever the browser sent. */
function readForm(fd: FormData): { fields: Fields } | { error: string } {
  const s = (k: string) => String(fd.get(k) ?? "");
  let raw: unknown;
  let schedule: Stage[];
  try {
    raw = JSON.parse(s("lines") || "[]");
    schedule = (JSON.parse(s("schedule") || "[]") as Stage[]).map((x) => ({ label: String(x.label ?? "").trim(), pct: Number(x.pct) }));
  } catch {
    return { error: "The price lines or schedule couldn't be read. Reload and try again." };
  }
  if (!Array.isArray(raw)) return { error: "The price lines couldn't be read." };
  let lines;
  try {
    lines = priceLines(
      (raw as Partial<LineInput>[]).map((l) => ({ slug: String(l.slug ?? ""), qty: Number(l.qty), description: String(l.description ?? "") })),
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Invalid price lines." };
  }
  const schedErr = scheduleError(schedule);
  if (schedErr) return { error: schedErr };
  const email = s("contact_email").trim().toLowerCase();
  if (!EMAIL.test(email)) return { error: "Enter the client contact's email address." };
  const validUntil = s("valid_until");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) return { error: "Pick a valid-until date." };
  for (const [k, label] of [["title", "a title"], ["client_company", "the client company"], ["contact_name", "the contact's name"]] as const) {
    if (!s(k).trim()) return { error: `Enter ${label}.` };
  }
  return {
    fields: {
      p_title: s("title").trim(),
      p_client_company: s("client_company").trim(),
      p_contact_name: s("contact_name").trim(),
      p_contact_email: email,
      p_summary: s("summary"),
      p_scope_md: s("scope_md"),
      p_timeline_md: s("timeline_md"),
      p_changes_md: s("changes_md"),
      p_lines: lines,
      p_schedule: schedule,
      p_valid_until: validUntil,
    },
  };
}

export async function createProposal(dealId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const { supabase } = await requireStaff();
  const r = readForm(fd);
  if ("error" in r) return { error: r.error };
  const { data, error } = await supabase.rpc("create_proposal", { p_deal_id: dealId, ...r.fields, p_terms_version: null });
  if (error) return { error: error.message };
  redirect(`/proposals/${data as string}`);
}

export async function saveDraft(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const { supabase } = await requireStaff();
  const r = readForm(fd);
  if ("error" in r) return { error: r.error };
  const { error } = await supabase.rpc("update_proposal_draft", { p_id: id, ...r.fields });
  if (error) return { error: error.message };
  return { ok: "Draft saved." };
}

async function origin(): Promise<string> {
  const h = await headers();
  return clientOrigin({ host: h.get("host"), forwardedHost: h.get("x-forwarded-host"), forwardedProto: h.get("x-forwarded-proto") });
}

type SentRow = { title: string; contact_name: string; contact_email: string; valid_until: string; version: number; token_hash: string | null; status: string };

async function sentRow(id: string) {
  const { supabase } = await requireStaff();
  const { data } = await supabase
    .from("proposals")
    .select("title, contact_name, contact_email, valid_until, version, token_hash, status")
    .eq("id", id)
    .maybeSingle();
  return { supabase, row: data as SentRow | null };
}

async function emailLink(row: SentRow, url: string): Promise<string | null> {
  try {
    await sendMail(row.contact_email, proposalLinkEmail({ contactName: row.contact_name, title: row.title, link: url, validUntil: dayMonthYear(row.valid_until), version: row.version }));
    return null;
  } catch (e) {
    console.error("proposal link mail failed:", e instanceof Error ? e.message : e);
    return "The proposal is marked sent, but the email failed. Copy the link and send it yourself, or try “Email the link again”.";
  }
}

/** F13: the founder's click is the approval. Approve, freeze and link the exact content, then email the client. */
export async function approveAndSend(id: string): Promise<ActionState> {
  const { supabase } = await requireStaff();
  const a = await supabase.rpc("approve_proposal", { p_id: id });
  if (a.error) return { error: a.error.message };
  let link;
  try {
    link = proposalLink(id, await origin());
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't create the link." };
  }
  const s = await supabase.rpc("mark_proposal_sent", { p_id: id, p_token_hash: link.hash });
  if (s.error) return { error: s.error.message };
  const { row } = await sentRow(id);
  if (!row) return { error: "Sent, but the proposal couldn't be re-read. Reload the page." };
  const mailError = await emailLink(row, link.url);
  return mailError ? { error: mailError, url: link.url } : { ok: `Sent to ${row.contact_email}.`, url: link.url };
}

/** The live link again. Refuses if it doesn't match the stored hash (e.g. the link secret was rotated). */
async function liveLink(id: string): Promise<{ url: string; row: SentRow } | { error: string }> {
  const { row } = await sentRow(id);
  if (!row || !row.token_hash) return { error: "This proposal has no link yet." };
  if (row.status !== "sent" && row.status !== "viewed") return { error: `The link is no longer active (${row.status}).` };
  let link;
  try {
    link = proposalLink(id, await origin());
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't create the link." };
  }
  if (link.hash !== row.token_hash) return { error: "The link can't be re-created (the link secret changed). Send a new version instead." };
  return { url: link.url, row };
}

export async function copyLink(id: string): Promise<ActionState> {
  const r = await liveLink(id);
  return "error" in r ? { error: r.error } : { ok: "Link copied.", url: r.url };
}

export async function resendLink(id: string): Promise<ActionState> {
  const r = await liveLink(id);
  if ("error" in r) return { error: r.error };
  const mailError = await emailLink(r.row, r.url);
  return mailError ? { error: mailError, url: r.url } : { ok: `Emailed to ${r.row.contact_email} again.`, url: r.url };
}

export async function voidProposal(id: string): Promise<ActionState> {
  const { supabase } = await requireStaff();
  const { error } = await supabase.rpc("void_proposal", { p_id: id });
  return error ? { error: error.message } : { ok: "Voided. The link no longer works." };
}

/** A new version copies this one into a draft (version + 1). Sending it voids this version's link. */
export async function newVersion(id: string): Promise<ActionState> {
  const { supabase } = await requireStaff();
  const { data: p, error } = await supabase
    .from("proposals")
    .select("deal_id, title, client_company, contact_name, contact_email, summary, scope_md, timeline_md, lines, schedule, valid_until, terms_version")
    .eq("id", id)
    .maybeSingle();
  if (error || !p) return { error: "Proposal not found." };
  const valid = p.valid_until && p.valid_until > isoDaysFromNow(0) ? p.valid_until : isoDaysFromNow(30);
  let lines;
  try {
    // re-priced from today's catalogue, so a new version never carries a stale price
    lines = priceLines((p.lines as { slug: string; qty: number; description: string }[]).map((l) => ({ slug: l.slug, qty: l.qty, description: l.description })));
  } catch (e) {
    return { error: `${e instanceof Error ? e.message : "Invalid price lines"}. Create the new version from scratch.` };
  }
  const { data, error: e2 } = await supabase.rpc("create_proposal", {
    p_deal_id: p.deal_id,
    p_title: p.title,
    p_client_company: p.client_company,
    p_contact_name: p.contact_name,
    p_contact_email: p.contact_email,
    p_summary: p.summary,
    p_scope_md: p.scope_md,
    p_timeline_md: p.timeline_md,
    p_changes_md: "",
    p_lines: lines,
    p_schedule: p.schedule,
    p_valid_until: valid,
    p_terms_version: null,
  });
  if (e2) return { error: e2.message };
  redirect(`/proposals/${data as string}`);
}
