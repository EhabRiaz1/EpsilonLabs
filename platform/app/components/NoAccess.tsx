import { signOut } from "@/lib/auth-actions";
import { AuthFrame } from "./AuthFrame";

/** Signed in, but not staff. Says nothing about which accounts are staff. */
export function NoAccess({ email }: { email?: string }) {
  return (
    <AuthFrame host="admin.epsilon-labs.co">
      <h1 className="auth-title">No admin access</h1>
      <p className="auth-sub">
        {email ? <span className="mono">{email}</span> : "This account"} can&apos;t open Epsilon admin. If you are a client, use
        client.epsilon-labs.co.
      </p>
      <form action={signOut} className="mt-20">
        <button className="btn btn-secondary btn-lg btn-block" type="submit">
          Sign out
        </button>
      </form>
    </AuthFrame>
  );
}
