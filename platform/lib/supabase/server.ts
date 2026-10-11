import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { hostOnly } from "@/lib/cookies";
import { supabaseEnv } from "./env";

/** Supabase client for Server Components, Server Actions and Route Handlers, acting as the signed-in user. */
export async function createClient() {
  const store = await cookies();
  const { url, key } = supabaseEnv();
  const secure = process.env.NODE_ENV === "production";
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(toSet) {
        try {
          toSet.forEach(({ name, value, options }) => store.set(name, value, hostOnly(options, secure)));
        } catch {
          // Server Components cannot set cookies. The proxy refreshes the session on every request, so a
          // refreshed token written here is only needed in Actions and Route Handlers, where set() works.
        }
      },
    },
  });
}
