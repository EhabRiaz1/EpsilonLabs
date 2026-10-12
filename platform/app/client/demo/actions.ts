"use server";

import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { DEMO_EMAIL } from "@/lib/demo";

// "View demo" on client.epsilon-labs.co/demo. Signs this browser in as the one demo login, the same way an accepted
// invite signs a new client in: the Auth admin API makes a one-time link on the server and verifyOtp turns it into a
// session cookie here. The browser never sees a token. The demo login is a member of the demo org only, and migration
// 016 makes every write to that org fail, so the session is read-only whatever the visitor sends.

export type DemoState = { error?: string } | undefined;

const SORRY = "The demo isn't available just now. Try again in a minute.";

export async function startDemo(): Promise<DemoState> {
  const svc = createServiceClient();
  let prep = await svc.rpc("demo_prepare");
  if (prep.error) {
    console.error("demo_prepare failed:", prep.error.message);
    return { error: SORRY };
  }
  if ((prep.data as { ok: boolean }).ok !== true) {
    // first visit ever: create the demo login, then seed and seat it
    const made = await svc.auth.admin.createUser({ email: DEMO_EMAIL, email_confirm: true, user_metadata: { full_name: "Demo visitor" } });
    if (made.error && made.error.code !== "email_exists" && !/already/i.test(made.error.message)) {
      console.error("demo: createUser failed:", made.error.message);
      return { error: SORRY };
    }
    prep = await svc.rpc("demo_prepare");
    if (prep.error || (prep.data as { ok: boolean }).ok !== true) {
      console.error("demo_prepare after createUser failed:", prep.error?.message ?? JSON.stringify(prep.data));
      return { error: SORRY };
    }
  }

  const link = await svc.auth.admin.generateLink({ type: "magiclink", email: DEMO_EMAIL });
  const hashed = link.data?.properties?.hashed_token;
  if (link.error || !hashed) {
    console.error("demo: generateLink failed:", link.error?.message);
    return { error: SORRY };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: hashed, type: "magiclink" });
  if (error) {
    console.error("demo: sign-in failed:", error.message);
    return { error: SORRY };
  }
  redirect("/");
}
