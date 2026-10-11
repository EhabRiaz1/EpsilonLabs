import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Claims = { sub: string; email?: string; aal?: string; user_metadata?: { full_name?: string; name?: string } };

/** The verified JWT claims of the signed-in user, or null. */
export async function getSession() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = (data?.claims ?? null) as Claims | null;
  return { supabase, claims: claims?.sub ? claims : null };
}

/** Staff row for the signed-in user. RLS lets a user read their own staff row at aal1, to route them to MFA. */
export async function getStaff() {
  const { supabase, claims } = await getSession();
  if (!claims) return { supabase, claims: null, staff: null };
  const { data, error } = await supabase.from("staff").select("email, scope").eq("user_id", claims.sub).maybeSingle();
  if (error) throw new Error(`staff lookup failed: ${error.message}`);
  return { supabase, claims, staff: data as { email: string; scope: "full" | "test" } | null };
}

export function displayName(claims: Claims): string {
  return claims.user_metadata?.full_name || claims.user_metadata?.name || (claims.email ?? "").split("@")[0] || "there";
}

export function firstName(claims: Claims): string {
  const n = displayName(claims);
  return n.split(/\s+/)[0].replace(/^./, (c) => c.toUpperCase());
}
