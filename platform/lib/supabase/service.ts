import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. A deliberate, documented narrowing of F11: the web app may hold the service role ONLY for
 * the public deal room (app/client/p/**: start/confirm acceptance, which must never be callable with the public
 * key) and the invoice PDF code (lib/invoice-pdf.ts: writes the private `invoices` bucket). Admin pages still act
 * as the signed-in staff user. eslint.config.mjs enforces where this module may be imported.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set (server-only; see platform/.env.example)");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
