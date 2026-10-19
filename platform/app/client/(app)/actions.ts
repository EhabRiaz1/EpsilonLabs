"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getSession, displayName } from "@/lib/session";
import { inDemo, myMemberships } from "@/lib/orgs";
import { DEMO_READ_ONLY } from "@/lib/demo";
import { ORG_COOKIE } from "@/lib/org-choice";
import { composeBody, type Priority } from "@/lib/tickets";
import { newInviteToken, inviteUrl } from "@/lib/invites";
import { sendMail } from "@/lib/mail";
import { inviteEmail } from "@/lib/mail-templates";
import { dayMonthYear } from "@/lib/dates";
import { publicUrl } from "@/lib/host";
import { hostOnly } from "@/lib/cookies";

// Client portal writes. Each one acts as the signed-in user through an RPC from migrations 008/010, which stamps
// the author and org from auth.uid() and checks membership again; nothing here is trusted for authorisation.

export type Result = { ok?: string; error?: string } | undefined;
const UUID = /^[0-9a-f-]{36}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TYPES = new Set(["bug", "change", "question", "new"]);
const PRIORITIES = new Set<Priority>(["low", "normal", "urgent"]);

async function session() {
  const s = await getSession();
  if (!s.claims) throw new Error("Signed out. Reload and sign in again.");
  return { supabase: s.supabase, claims: s.claims };
}

/** session() for a write: null for the demo login, whose writes the database refuses anyway (migration 016). */
async function writer() {
  const s = await session();
  return (await inDemo(s.supabase, s.claims.sub)) ? null : s;
}

export async function createTicket(input: {
  projectId: string;
  title: string;
  type: string;
  priority: string;
  description: string;
  where: string;
}): Promise<{ ok: true; id: string; ref: string } | { ok: false; error: string }> {
  const w = await writer();
  if (!w) return { ok: false, error: DEMO_READ_ONLY };
  const { supabase } = w;
  const title = String(input.title ?? "").trim();
  if (!UUID.test(input.projectId)) return { ok: false, error: "Pick the project this is about." };
  if (!title) return { ok: false, error: "Give the request a one-line title." };
  if (title.length > 200) return { ok: false, error: "Keep the title under 200 characters." };
  if (!TYPES.has(input.type)) return { ok: false, error: "Pick what kind of request this is." };
  if (!PRIORITIES.has(input.priority as Priority)) return { ok: false, error: "Pick how urgent it is." };
  const body = composeBody(String(input.description ?? ""), String(input.where ?? ""));
  if (body.length > 20000) return { ok: false, error: "The description is too long (20,000 characters at most)." };
  const { data, error } = await supabase.rpc("create_ticket", {
    p_project_id: input.projectId,
    p_title: title,
    p_body: body,
    p_type: input.type,
    p_priority: input.priority,
  });
  if (error) {
    console.error("create_ticket failed:", error.message);
    return { ok: false, error: /not accepting/.test(error.message) ? "This project isn't taking new requests." : "We couldn't create the request. Try again." };
  }
  revalidatePath("/", "layout");
  const t = data as { id: string; ref: string };
  return { ok: true, id: t.id, ref: t.ref };
}

export async function addComment(ticketId: string, body: string): Promise<Result> {
  const w = await writer();
  if (!w) return { error: DEMO_READ_ONLY };
  const { supabase } = w;
  const text = String(body ?? "").trim();
  if (!UUID.test(ticketId)) return { error: "Unknown ticket." };
  if (!text) return { error: "Write something first." };
  if (text.length > 10000) return { error: "Keep it under 10,000 characters." };
  const { error } = await supabase.rpc("add_ticket_comment", { p_ticket_id: ticketId, p_body: text });
  if (error) {
    console.error("add_ticket_comment failed:", error.message);
    return { error: /read-only/.test(error.message) ? "This ticket is read-only." : "We couldn't add your note. Try again." };
  }
  revalidatePath(`/tickets/${ticketId}`);
  return { ok: "Sent to Epsilon." };
}

export async function markRead(ids: string[] | null): Promise<void> {
  const w = await writer();
  if (!w) return;
  const { supabase } = w;
  const list = ids?.filter((x) => UUID.test(x)).slice(0, 100) ?? null;
  await supabase.rpc("mark_notifications_read", { p_ids: list });
  revalidatePath("/", "layout");
}

export async function switchOrg(orgId: string): Promise<Result> {
  const { supabase, claims } = await session();
  const all = await myMemberships(supabase, claims.sub);
  if (!all.some((m) => m.orgId === orgId)) return { error: "You aren't a member of that organisation." };
  const store = await cookies();
  store.set(ORG_COOKIE, orgId, { ...hostOnly({ httpOnly: true, maxAge: 60 * 60 * 24 * 365 }, process.env.NODE_ENV === "production") });
  revalidatePath("/", "layout");
  return { ok: "Switched." };
}

export async function updateName(_prev: Result, fd: FormData): Promise<Result> {
  const w = await writer();
  if (!w) return { error: DEMO_READ_ONLY };
  const { supabase } = w;
  const name = String(fd.get("name") ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 100) return { error: "Enter your name (2 to 100 characters)." };
  const { error } = await supabase.auth.updateUser({ data: { full_name: name } });
  if (error) return { error: "We couldn't save your name. Try again." };
  revalidatePath("/", "layout");
  return { ok: "Saved." };
}

async function clientOriginNow(): Promise<string> {
  const h = await headers();
  return publicUrl("/", { host: h.get("host"), forwardedHost: h.get("x-forwarded-host"), forwardedProto: h.get("x-forwarded-proto") }, "https:").origin;
}

/** Owners invite colleagues as members (create_invite enforces owner + role). The link is emailed from notifications@. */
export async function inviteMember(orgId: string, _prev: Result, fd: FormData): Promise<Result> {
  const w = await writer();
  if (!w) return { error: DEMO_READ_ONLY };
  const { supabase, claims } = w;
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (!UUID.test(orgId)) return { error: "Unknown organisation." };
  if (!EMAIL.test(email) || email.length > 254) return { error: "Enter a valid email address." };
  const { token, hash } = newInviteToken();
  const { data, error } = await supabase.rpc("create_invite", { p_org_id: orgId, p_email: email, p_role: "member", p_token_hash: hash });
  if (error) {
    if (/already a member/.test(error.message)) return { error: `${email} is already in your team.` };
    if (/not allowed|owners/.test(error.message)) return { error: "Only owners can invite people." };
    if (/too many/.test(error.message)) return { error: "That's a lot of invites for one day. Try again tomorrow." };
    console.error("create_invite failed:", error.message);
    return { error: "We couldn't create the invite. Try again." };
  }
  const inv = data as { id: string; org_name: string; expires_at: string };
  try {
    await sendMail(
      email,
      inviteEmail({ orgName: inv.org_name, inviter: displayName(claims), link: inviteUrl(await clientOriginNow(), token), expiresOn: dayMonthYear(inv.expires_at), role: "member" }),
    );
  } catch (e) {
    console.error("invite mail failed:", e instanceof Error ? e.message : e);
    await supabase.rpc("revoke_invite", { p_id: inv.id });
    revalidatePath("/account");
    return { error: "We couldn't send the invite email just now. Try again in a minute." };
  }
  revalidatePath("/account");
  return { ok: `Invite sent to ${email}. It works for 7 days.` };
}

export async function revokeInvite(inviteId: string): Promise<Result> {
  const w = await writer();
  if (!w) return { error: DEMO_READ_ONLY };
  const { supabase } = w;
  if (!UUID.test(inviteId)) return { error: "Unknown invite." };
  const { error } = await supabase.rpc("revoke_invite", { p_id: inviteId });
  if (error) return { error: "We couldn't revoke that invite." };
  revalidatePath("/account");
  return { ok: "Invite revoked." };
}

export async function removeMember(orgId: string, userId: string): Promise<Result> {
  const w = await writer();
  if (!w) return { error: DEMO_READ_ONLY };
  const { supabase } = w;
  if (!UUID.test(orgId) || !UUID.test(userId)) return { error: "Unknown member." };
  const { error } = await supabase.rpc("remove_member", { p_org_id: orgId, p_user_id: userId });
  if (error) return { error: /at least one owner/.test(error.message) ? "An organisation keeps at least one owner." : "We couldn't remove that person." };
  revalidatePath("/account");
  return { ok: "Removed. They no longer see this organisation." };
}

// ---- 012: email preferences, testimonials ----------------------------------------------------------------------

const PREFS = new Set(["immediate", "daily", "off"]);

export async function savePrefs(_prev: Result, fd: FormData): Promise<Result> {
  const w = await writer();
  if (!w) return { error: DEMO_READ_ONLY };
  const { supabase } = w;
  const pref = String(fd.get("email_pref") ?? "");
  const tz = String(fd.get("timezone") ?? "").trim();
  if (!PREFS.has(pref)) return { error: "Pick how often we email you." };
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) return { error: "Pick your timezone." };
  const { error } = await supabase.rpc("save_my_prefs", { p_timezone: tz, p_email_pref: pref });
  if (error) return { error: /timezone/.test(error.message) ? "We don't know that timezone. Pick one from the list." : "We couldn't save that. Try again." };
  revalidatePath("/account");
  return {
    ok: pref === "off" ? "Saved. We won't email you; everything stays in the portal's bell." : pref === "immediate" ? "Saved. We email you as things happen." : "Saved. Urgent items arrive at once; the rest in one email a day at 10:00 your time.",
  };
}

export async function submitTestimonial(id: string | null, orgId: string, _prev: Result, fd: FormData): Promise<Result> {
  const w = await writer();
  if (!w) return { error: DEMO_READ_ONLY };
  const { supabase } = w;
  if ((id && !UUID.test(id)) || !UUID.test(orgId)) return { error: "Unknown testimonial." };
  const quote = String(fd.get("quote") ?? "").replace(/\s+/g, " ").trim();
  const name = String(fd.get("author_name") ?? "").trim();
  const role = String(fd.get("author_role") ?? "").trim();
  if (fd.get("consent") !== "on") return { error: "Tick the box to let Epsilon Labs quote it." };
  if (quote.length < 10 || quote.length > 1200) return { error: "Write 10 to 1,200 characters." };
  if (name.length < 2 || name.length > 120 || role.length > 120) return { error: "Give your name (and optionally your role)." };
  const { error } = await supabase.rpc("submit_testimonial", { p_id: id, p_org_id: orgId, p_quote: quote, p_author_name: name, p_author_role: role });
  if (error) {
    console.error("submit_testimonial failed:", error.message);
    return { error: /no longer be changed/.test(error.message) ? "This one can no longer be changed." : /read-only/.test(error.message) ? "This organisation is read-only." : "We couldn't save it. Try again." };
  }
  revalidatePath("/testimonial");
  return { ok: "Thank you. Epsilon will be in touch before it appears anywhere." };
}

export async function withdrawTestimonial(id: string): Promise<Result> {
  const w = await writer();
  if (!w) return { error: DEMO_READ_ONLY };
  const { supabase } = w;
  if (!UUID.test(id)) return { error: "Unknown testimonial." };
  const { error } = await supabase.rpc("withdraw_testimonial", { p_id: id });
  if (error) return { error: "We couldn't withdraw it. Try again." };
  revalidatePath("/testimonial");
  return { ok: "Withdrawn. Epsilon is told so it comes off the website." };
}
