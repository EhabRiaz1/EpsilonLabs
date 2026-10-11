import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { publicUrl, type Site } from "@/lib/host";

const OTP_TYPES: ReadonlySet<string> = new Set(["magiclink", "email", "invite", "recovery", "signup", "email_change"]);

/**
 * Magic-link landing (GET /auth/confirm). Supports the PKCE `?code=` redirect and the `?token_hash=&type=`
 * email-template form. Always redirects to a fixed path on the same host, never to a caller-supplied URL.
 */
export async function confirm(site: Site, request: NextRequest): Promise<NextResponse> {
  const q = request.nextUrl.searchParams;
  const supabase = await createClient();
  let ok = false;
  const code = q.get("code");
  const tokenHash = q.get("token_hash");
  const type = q.get("type");
  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && type && OTP_TYPES.has(type)) {
    ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType })).error;
  }
  // Build the target from the public Host header: after the proxy's rewrite, nextUrl is the internal route.
  const to = publicUrl(ok ? (site === "admin" ? "/mfa" : "/") : "/login?error=link", {
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
  }, request.nextUrl.protocol);
  return NextResponse.redirect(to);
}
