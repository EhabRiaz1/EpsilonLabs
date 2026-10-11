import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Membership = { orgId: string; role: "owner" | "member"; name: string; slug: string };

/** The signed-in user's organisations (RLS returns only their own memberships' orgs). */
export async function myMemberships(supabase: SupabaseClient, userId: string): Promise<Membership[]> {
  const { data, error } = await supabase
    .from("memberships")
    .select("org_id, role, organizations(name, slug)")
    .eq("user_id", userId)
    .order("created_at");
  if (error) throw new Error(`membership lookup failed: ${error.message}`);
  return (data ?? []).map((m) => {
    const org = (Array.isArray(m.organizations) ? m.organizations[0] : m.organizations) as { name: string; slug: string } | null;
    return { orgId: m.org_id as string, role: m.role as Membership["role"], name: org?.name ?? "Organisation", slug: org?.slug ?? "" };
  });
}
