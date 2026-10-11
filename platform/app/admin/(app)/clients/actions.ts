"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import { displayName } from "@/lib/session";
import { SLUG_RE, slugify } from "@/lib/slug";
import { newInviteToken, inviteUrl } from "@/lib/invites";
import { clientOrigin } from "@/lib/host";
import { sendMail } from "@/lib/mail";
import { inviteEmail } from "@/lib/mail-templates";
import { dayMonthYear } from "@/lib/dates";

export type ClientsResult = { ok?: string; error?: string } | undefined;
const UUID = /^[0-9a-f-]{36}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function createOrg(_prev: ClientsResult, fd: FormData): Promise<ClientsResult> {
  const { supabase } = await requireStaff();
  const name = s(fd, "name");
  const slug = s(fd, "slug") || slugify(name);
  const domain = s(fd, "domain").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const company = s(fd, "company_id");
  if (!name) return { error: "Enter the organisation's name." };
  if (!SLUG_RE.test(slug)) return { error: "The slug takes lowercase letters, digits and dashes." };
  if (company && !UUID.test(company)) return { error: "Pick a company from the list." };
  const { data, error } = await supabase.rpc("create_org", { p_name: name, p_slug: slug, p_domain: domain || null, p_company_id: company || null });
  if (error) {
    if (/taken/.test(error.message)) return { error: `The slug "${slug}" is taken. Pick another.` };
    if (/domain/.test(error.message)) return { error: "That domain doesn't look right (e.g. masterpaints.com)." };
    console.error("create_org failed:", error.message);
    return { error: "Couldn't create the organisation. Reload and try again." };
  }
  revalidatePath("/clients");
  redirect(`/clients/${data as string}`);
}

export async function inviteToOrg(orgId: string, _prev: ClientsResult, fd: FormData): Promise<ClientsResult> {
  const { supabase, claims } = await requireStaff();
  const email = s(fd, "email").toLowerCase();
  const role = s(fd, "role") === "owner" ? "owner" : "member";
  if (!UUID.test(orgId)) return { error: "Unknown organisation." };
  if (!EMAIL.test(email) || email.length > 254) return { error: "Enter a valid email address." };
  const { token, hash } = newInviteToken();
  const { data, error } = await supabase.rpc("create_invite", { p_org_id: orgId, p_email: email, p_role: role, p_token_hash: hash });
  if (error) {
    if (/already a member/.test(error.message)) return { error: `${email} is already a member.` };
    if (/read-only/.test(error.message)) return { error: "This organisation is archived or a demo." };
    console.error("create_invite failed:", error.message);
    return { error: "Couldn't create the invite. Reload and try again." };
  }
  const inv = data as { id: string; org_name: string; expires_at: string };
  const h = await headers();
  const origin = clientOrigin({ host: h.get("host"), forwardedHost: h.get("x-forwarded-host"), forwardedProto: h.get("x-forwarded-proto") });
  try {
    await sendMail(email, inviteEmail({ orgName: inv.org_name, inviter: displayName(claims), link: inviteUrl(origin, token), expiresOn: dayMonthYear(inv.expires_at), role }));
  } catch (e) {
    console.error("invite mail failed:", e instanceof Error ? e.message : e);
    await supabase.rpc("revoke_invite", { p_id: inv.id });
    revalidatePath(`/clients/${orgId}`);
    return { error: "The invite email couldn't be sent (SMTP). Nothing was left pending; try again." };
  }
  revalidatePath(`/clients/${orgId}`);
  return { ok: `Invite sent to ${email} as ${role}. The link works once, for 7 days.` };
}

export async function revokeInviteAdmin(orgId: string, inviteId: string): Promise<ClientsResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(inviteId)) return { error: "Unknown invite." };
  const { error } = await supabase.rpc("revoke_invite", { p_id: inviteId });
  if (error) return { error: /accepted/.test(error.message) ? "Already accepted: remove the member instead." : "Couldn't revoke." };
  revalidatePath(`/clients/${orgId}`);
  return { ok: "Revoked." };
}

export async function removeMemberAdmin(orgId: string, userId: string): Promise<ClientsResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(orgId) || !UUID.test(userId)) return { error: "Unknown member." };
  const { error } = await supabase.rpc("remove_member", { p_org_id: orgId, p_user_id: userId });
  if (error) return { error: /at least one owner/.test(error.message) ? "The last owner can't be removed." : "Couldn't remove." };
  revalidatePath(`/clients/${orgId}`);
  return { ok: "Removed." };
}

export async function saveProject(orgId: string, projectId: string | null, _prev: ClientsResult, fd: FormData): Promise<ClientsResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(orgId) || (projectId && !UUID.test(projectId))) return { error: "Unknown project." };
  const name = s(fd, "name");
  const progressRaw = s(fd, "progress");
  const progress = progressRaw === "" ? null : Number(progressRaw);
  const on = s(fd, "next_milestone_on");
  if (!name) return { error: "Enter the project's name." };
  if (progress !== null && (!Number.isInteger(progress) || progress < 0 || progress > 100)) return { error: "Progress is a whole number from 0 to 100." };
  if (on && !/^\d{4}-\d{2}-\d{2}$/.test(on)) return { error: "Pick a milestone date." };
  const { error } = await supabase.rpc("save_project", {
    p_id: projectId,
    p_org_id: orgId,
    p_name: name,
    p_status: s(fd, "status") || "active",
    p_summary: s(fd, "summary"),
    p_repo_path: s(fd, "repo_path"),
    p_progress: progress,
    p_next_milestone: s(fd, "next_milestone"),
    p_next_milestone_on: on || null,
  });
  if (error) {
    console.error("save_project failed:", error.message);
    return { error: /too long/.test(error.message) ? "A field is too long." : "Couldn't save the project. Reload and try again." };
  }
  revalidatePath(`/clients/${orgId}`);
  return { ok: projectId ? "Saved." : "Project created." };
}
