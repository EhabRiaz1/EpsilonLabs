import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./env";

/** The public (anon) role with no session: what a prospect holding only a proposal link is allowed to do. */
export function createAnonClient() {
  const { url, key } = supabaseEnv();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
