// Publishable values only (F11). The web app has no service_role key.
export function supabaseEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set (see platform/.env.example)");
  }
  if (/^sb_secret_/.test(key) || /service_role/.test(key)) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY must be the publishable key, never a secret key");
  }
  return { url, key };
}
