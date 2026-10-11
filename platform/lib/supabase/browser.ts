"use client";
import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

/** Browser client (used for MFA enrol/verify). Cookies are host-only: no domain is ever set. */
export function createClient() {
  const { url, key } = supabaseEnv();
  return createBrowserClient(url, key, {
    cookieOptions: { path: "/", sameSite: "lax", secure: location.protocol === "https:" },
  });
}
