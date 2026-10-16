"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import { STATUSES, type TicketStatus } from "@/lib/tickets";

export type TicketResult = { ok?: string; error?: string } | undefined;
const UUID = /^[0-9a-f-]{36}$/i;

/** set_ticket_status (EN5 rulebook): the client sees the change and gets a notification; audited. */
export async function setTicketStatus(id: string, status: string): Promise<TicketResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(id) || !STATUSES.includes(status as TicketStatus)) return { error: "Unknown ticket or status." };
  const { error } = await supabase.rpc("set_ticket_status", { p_ticket_id: id, p_status: status });
  if (error) {
    console.error("set_ticket_status failed:", error.message);
    return { error: "The status didn't change. Reload and try again." };
  }
  revalidatePath("/tickets");
  revalidatePath(`/tickets/${id}`);
  return { ok: "Status changed. The client sees it now." };
}

/** F13: a reply the founder typed goes to the client when he sends it; an internal note never does. */
export async function replyToTicket(id: string, body: string, toClient: boolean): Promise<TicketResult> {
  const { supabase } = await requireStaff();
  const text = String(body ?? "").trim();
  if (!UUID.test(id)) return { error: "Unknown ticket." };
  if (!text) return { error: "Write something first." };
  if (text.length > 10000) return { error: "Keep it under 10,000 characters." };
  const { error } = await supabase.rpc("staff_ticket_reply", { p_ticket_id: id, p_body: text, p_to_client: toClient });
  if (error) {
    console.error("staff_ticket_reply failed:", error.message);
    return { error: "That didn't save. Reload and try again." };
  }
  revalidatePath(`/tickets/${id}`);
  revalidatePath("/tickets");
  return { ok: toClient ? "Sent to the client." : "Internal note saved. The client can't see it." };
}

export async function sendNoteToClient(ticketId: string, eventId: string): Promise<TicketResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(ticketId) || !UUID.test(eventId)) return { error: "Unknown note." };
  const { error } = await supabase.rpc("publish_ticket_event", { p_event_id: eventId });
  if (error) return { error: /internal/.test(error.message) ? "This ticket is internal. Share it with the client first." : "That note couldn't be sent." };
  revalidatePath(`/tickets/${ticketId}`);
  return { ok: "Sent to the client." };
}

/** 017: "Send as reply" on a Claude Code draft, optionally edited first. send_draft_reply publishes it through
 *  publish_ticket_event: the same client-visible reply, notification and email digest as any founder reply. */
export async function sendDraftReply(ticketId: string, eventId: string, body: string | null): Promise<TicketResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(ticketId) || !UUID.test(eventId)) return { error: "Unknown draft." };
  const text = body === null ? null : String(body).trim();
  if (text !== null && !text) return { error: "Write something first." };
  if (text !== null && text.length > 10000) return { error: "Keep it under 10,000 characters." };
  const { error } = await supabase.rpc("send_draft_reply", { p_event_id: eventId, p_body: text });
  if (error) {
    console.error("send_draft_reply failed:", error.message);
    if (/internal/.test(error.message)) return { error: "This ticket is internal. Share it with the client first." };
    return { error: "That draft couldn't be sent. Reload and try again." };
  }
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
  return { ok: "Sent to the client." };
}

/** 017: an internal ticket (opened from Claude Code) becomes visible to the client. One way. */
export async function shareTicket(ticketId: string): Promise<TicketResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(ticketId)) return { error: "Unknown ticket." };
  const { error } = await supabase.rpc("share_ticket_with_client", { p_ticket_id: ticketId });
  if (error) {
    console.error("share_ticket_with_client failed:", error.message);
    return { error: "The ticket couldn't be shared. Reload and try again." };
  }
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
  return { ok: "Shared. The client sees the ticket now." };
}
