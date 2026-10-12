"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import type { FormResult } from "@/app/components/Forms";

const UUID = /^[0-9a-f-]{36}$/i;
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** Asks the client's team (notification + their Testimonial page). Optional wording the founder suggests. */
export async function requestTestimonial(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const { supabase } = await requireStaff();
  const org = s(fd, "org_id");
  const project = s(fd, "project_id");
  const suggested = s(fd, "suggested");
  if (!UUID.test(org)) return { error: "Pick the client." };
  if (project && !UUID.test(project)) return { error: "Pick a project or none." };
  if (suggested.length > 1200) return { error: "Suggested wording is at most 1,200 characters." };
  const { error } = await supabase.rpc("request_testimonial", { p_org_id: org, p_project_id: project || null, p_suggested: suggested || null });
  if (error) return { error: /already an open request/.test(error.message) ? "There is already an open request for this client." : "Couldn't send the request. Reload and try again." };
  revalidatePath("/testimonials");
  return { ok: "Requested. The client's team sees it in their portal and in their next digest." };
}

/** Bookkeeping only: you pasted it into the site source yourself. */
export async function markTestimonialPublished(id: string): Promise<FormResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(id)) return { error: "Unknown testimonial." };
  const { error } = await supabase.rpc("mark_testimonial_published", { p_id: id });
  if (error) return { error: "Only a client-approved testimonial can be marked published." };
  revalidatePath("/testimonials");
  return { ok: "Marked as on the website." };
}

export async function withdrawTestimonialAdmin(id: string): Promise<FormResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(id)) return { error: "Unknown testimonial." };
  const { error } = await supabase.rpc("withdraw_testimonial", { p_id: id });
  if (error) return { error: "Couldn't withdraw it." };
  revalidatePath("/testimonials");
  return { ok: "Withdrawn." };
}
