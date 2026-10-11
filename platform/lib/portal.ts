import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Reads for the client portal. Every query runs as the signed-in user, so RLS decides what comes back; the org
// filter only picks which of the user's organisations is on screen.

export type Project = {
  id: string;
  name: string;
  status: string;
  summary: string | null;
  progress: number | null;
  next_milestone: string | null;
  next_milestone_on: string | null;
  created_at: string;
};

export type Ticket = {
  id: string;
  ref: string;
  number: number;
  project_id: string;
  author_id: string | null;
  title: string;
  body: string;
  type: string;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type Invoice = { id: string; number: string | null; total: number | string; currency: string; due_date: string | null; status: string; issued_at: string | null; project_label: string; kind: string; pdf_path: string | null };

export type FileRow = { id: string; name: string; size: number; mime: string; ticket_id: string | null; project_id: string | null; created_at: string; uploaded_by: string | null };

export type Notification = { id: string; kind: string; title: string; link: string | null; urgent: boolean; read_at: string | null; created_at: string };

export type Person = { id: string; name: string; staff: boolean };

export const PROJECT_COLUMNS = "id, name, status, summary, progress, next_milestone, next_milestone_on, created_at";
export const TICKET_COLUMNS = "id, ref, number, project_id, author_id, title, body, type, priority, status, created_at, updated_at";
const INVOICE_COLUMNS = "id, number, total, currency, due_date, status, issued_at, project_label, kind, pdf_path";
const FILE_COLUMNS = "id, name, size, mime, ticket_id, project_id, created_at, uploaded_by";

export async function projectsOf(supabase: SupabaseClient, orgId: string): Promise<Project[]> {
  const { data, error } = await supabase.from("projects").select(PROJECT_COLUMNS).eq("org_id", orgId).neq("status", "archived").order("created_at");
  if (error) throw new Error(`projects: ${error.message}`);
  return (data ?? []) as Project[];
}

export async function ticketsOf(supabase: SupabaseClient, orgId: string, limit = 200): Promise<Ticket[]> {
  const { data, error } = await supabase.from("tickets").select(TICKET_COLUMNS).eq("org_id", orgId).order("updated_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`tickets: ${error.message}`);
  return (data ?? []) as Ticket[];
}

/** Issued invoices (drafts are staff-only work in progress and never shown). */
export async function invoicesOf(supabase: SupabaseClient, orgId: string): Promise<Invoice[]> {
  const { data, error } = await supabase
    .from("invoices")
    .select(INVOICE_COLUMNS)
    .eq("org_id", orgId)
    .in("status", ["sent", "overdue", "paid"])
    .order("issued_at", { ascending: false });
  if (error) throw new Error(`invoices: ${error.message}`);
  return (data ?? []) as Invoice[];
}

export async function filesOf(supabase: SupabaseClient, orgId: string): Promise<FileRow[]> {
  const { data, error } = await supabase.from("files").select(FILE_COLUMNS).eq("org_id", orgId).eq("status", "ready").order("created_at", { ascending: false }).limit(300);
  if (error) throw new Error(`files: ${error.message}`);
  return (data ?? []) as FileRow[];
}

export async function notificationsOf(supabase: SupabaseClient, orgId: string): Promise<Notification[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("id, kind, title, link, urgent, read_at, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) throw new Error(`notifications: ${error.message}`);
  return (data ?? []) as Notification[];
}

/** Last client-visible comment per ticket (for the expanding rows). */
export async function lastComments(supabase: SupabaseClient, ticketIds: string[]): Promise<Map<string, { body: string; actor: string | null; created_at: string }>> {
  const out = new Map<string, { body: string; actor: string | null; created_at: string }>();
  if (!ticketIds.length) return out;
  const { data } = await supabase
    .from("ticket_events")
    .select("ticket_id, body, actor, created_at")
    .in("ticket_id", ticketIds.slice(0, 100))
    .eq("kind", "comment")
    .order("created_at", { ascending: false })
    .limit(400);
  for (const e of (data ?? []) as { ticket_id: string; body: string; actor: string | null; created_at: string }[]) {
    if (!out.has(e.ticket_id)) out.set(e.ticket_id, { body: e.body, actor: e.actor, created_at: e.created_at });
  }
  return out;
}

/** Display names (people() returns only co-members and staff). */
export async function peopleById(supabase: SupabaseClient, ids: (string | null | undefined)[]): Promise<Map<string, Person>> {
  const uniq = [...new Set(ids.filter((x): x is string => Boolean(x)))].slice(0, 200);
  const map = new Map<string, Person>();
  if (!uniq.length) return map;
  const { data } = await supabase.rpc("people", { p_ids: uniq });
  for (const p of (data ?? []) as Person[]) map.set(p.id, p);
  return map;
}

export function personName(map: Map<string, Person>, id: string | null | undefined, me?: string): string {
  if (!id) return "Someone";
  if (id === me) return "You";
  const p = map.get(id);
  return p ? (p.staff ? `${p.name.split(/\s+/)[0]} · Epsilon` : p.name) : "Someone";
}
