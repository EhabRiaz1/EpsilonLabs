import "server-only";
import { getStaff } from "@/lib/session";

/**
 * Admin server actions start here. A server action is a POST endpoint, so the (app) layout's guard does not run:
 * check the staff row and aal2 again (RLS and the RPCs check it a third time).
 */
export async function requireStaff() {
  const { supabase, claims, staff } = await getStaff();
  if (!claims || !staff || claims.aal !== "aal2") throw new Error("Staff with two-factor only.");
  return { supabase, claims, staff };
}
