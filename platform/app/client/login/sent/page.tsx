import type { Metadata } from "next";
import { AuthFrame } from "@/app/components/AuthFrame";
import { SentPanel } from "@/app/components/SentPanel";
import { sendMagicLink } from "@/lib/auth-actions";

export const metadata: Metadata = { title: "Check your email" };

export default async function SentPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  return (
    <AuthFrame host="client.epsilon-labs.co">
      <SentPanel email={typeof email === "string" ? email.slice(0, 254) : ""} resend={sendMagicLink.bind(null, "client")} />
    </AuthFrame>
  );
}
