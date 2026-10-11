import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/app/components/AuthFrame";
import { LoginForm } from "@/app/components/LoginForm";
import { sendMagicLink, signInWithPassword } from "@/lib/auth-actions";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; joined?: string }> }) {
  const { claims } = await getSession();
  if (claims) redirect("/");
  const { error, joined } = await searchParams;
  return (
    <AuthFrame host="client.epsilon-labs.co">
      <LoginForm
        title="Sign in to your portal"
        sub={joined ? "You've joined. Enter the email your invite went to and we'll send a one-time sign-in link." : "Use the email your Epsilon invite went to. We'll send a one-time sign-in link."}
        magicLink={sendMagicLink.bind(null, "client")}
        password={signInWithPassword.bind(null, "client")}
        linkError={error === "link"}
      />
    </AuthFrame>
  );
}
