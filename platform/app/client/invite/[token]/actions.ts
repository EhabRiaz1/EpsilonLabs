"use server";

import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { isToken } from "@/lib/tokens";

// Accepting a portal invite. The invite link is the credential (sha256 stored, 7 days, single use), like a magic
// link. Needs the service role: the login is created with the Auth admin API, and accept_invite() / a fresh sign-in
// token can never be callable with the public key. The browser only sends the token.

export type JoinState = { error?: string } | undefined;

export async function acceptInvite(token: string): Promise<JoinState> {
  if (!isToken(token)) return { error: "This invite link is not valid." };
  const svc = createServiceClient();
  const { data: peek, error: pe } = await svc.rpc("peek_invite", { p_token: token });
  if (pe) {
    console.error("peek_invite failed:", pe.message);
    return { error: "Something went wrong on our side. Try again in a minute." };
  }
  const p = peek as { state: string; email?: string };
  if (p.state !== "open" || !p.email) return { error: stateMessage(p.state) };

  // the login (or the existing one), then the membership, then a one-time sign-in for this browser
  const created = await svc.auth.admin.createUser({ email: p.email, email_confirm: true });
  if (created.error && created.error.code !== "email_exists" && !/already/i.test(created.error.message)) {
    console.error("invite: createUser failed:", created.error.message);
    return { error: "We couldn't set up your login. Try again in a minute." };
  }
  const { data: acc, error: ae } = await svc.rpc("accept_invite", { p_token: token });
  if (ae) {
    console.error("accept_invite failed:", ae.message);
    return { error: "Something went wrong on our side. Try again in a minute." };
  }
  const a = acc as { state: string };
  if (a.state !== "accepted") return { error: stateMessage(a.state) };

  const link = await svc.auth.admin.generateLink({ type: "magiclink", email: p.email });
  const hashed = link.data?.properties?.hashed_token;
  if (link.error || !hashed) {
    console.error("invite: generateLink failed:", link.error?.message);
    redirect("/login?joined=1");
  }
  const supabase = await createClient();
  const { error: ve } = await supabase.auth.verifyOtp({ token_hash: hashed, type: "magiclink" });
  if (ve) {
    console.error("invite: sign-in failed:", ve.message);
    redirect("/login?joined=1");
  }
  redirect("/");
}

function stateMessage(state: string): string {
  switch (state) {
    case "used":
      return "This invite has already been used. Sign in with your email address instead.";
    case "expired":
      return "This invite has expired. Ask whoever invited you to send a new one.";
    case "revoked":
      return "This invite was withdrawn. Ask whoever invited you if you still need access.";
    default:
      return "This invite link is not valid.";
  }
}
