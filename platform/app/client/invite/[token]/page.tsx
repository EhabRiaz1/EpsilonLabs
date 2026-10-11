import type { Metadata } from "next";
import Link from "next/link";
import { AuthFrame } from "@/app/components/AuthFrame";
import { createServiceClient } from "@/lib/supabase/service";
import { isToken } from "@/lib/tokens";
import { JoinForm } from "./JoinForm";

export const metadata: Metadata = { title: "Join your portal" };
export const dynamic = "force-dynamic";

// Public: the token is the credential. Opening the page changes nothing (mail scanners prefetch links); joining
// takes a click, which runs acceptInvite().
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let state = "not_found";
  let org = "";
  let masked = "";
  if (isToken(token)) {
    const { data, error } = await createServiceClient().rpc("peek_invite", { p_token: token });
    if (error) {
      console.error("peek_invite failed:", error.message);
      state = "error";
    } else {
      const p = data as { state: string; org_name?: string; email_masked?: string };
      state = p.state;
      org = p.org_name ?? "";
      masked = p.email_masked ?? "";
    }
  }
  return (
    <AuthFrame host="client.epsilon-labs.co">
      {state === "open" ? (
        <>
          <h1 className="auth-title">Join {org}</h1>
          <p className="auth-sub">
            You were invited to the {org} portal on Epsilon Labs as <span className="mono">{masked}</span>. Joining signs you in on
            this device; next time, sign in with that email address.
          </p>
          <JoinForm token={token} orgName={org} />
        </>
      ) : (
        <>
          <h1 className="auth-title">{state === "used" ? "Invite already used" : state === "expired" ? "Invite expired" : state === "revoked" ? "Invite withdrawn" : state === "error" ? "Something went wrong" : "Invite not found"}</h1>
          <p className="auth-sub">
            {state === "used"
              ? "This link has done its job. Sign in with your email address to open the portal."
              : state === "expired"
                ? "Invites last 7 days. Ask whoever invited you to send a new one."
                : state === "error"
                  ? "We couldn't check this invite. Try again in a minute."
                  : "Ask whoever invited you to send a new link, or email er@epsilon-labs.co."}
          </p>
          <Link className="btn btn-secondary btn-lg btn-block" href="/login" style={{ marginTop: 22 }}>
            Go to sign in
          </Link>
        </>
      )}
    </AuthFrame>
  );
}
