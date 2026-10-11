import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/app/components/AuthFrame";
import { LoginForm } from "@/app/components/LoginForm";
import { sendMagicLink, signInWithPassword } from "@/lib/auth-actions";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { claims } = await getSession();
  if (claims) redirect("/mfa");
  const { error } = await searchParams;
  return (
    <AuthFrame host="admin.epsilon-labs.co">
      <LoginForm
        title="Epsilon admin"
        sub="Staff only. Sign in, then confirm with your authenticator app."
        magicLink={sendMagicLink.bind(null, "admin")}
        password={signInWithPassword.bind(null, "admin")}
        linkError={error === "link"}
      />
    </AuthFrame>
  );
}
