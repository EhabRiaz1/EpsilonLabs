import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/app/components/AuthFrame";
import { getSession } from "@/lib/session";
import { inDemo } from "@/lib/orgs";
import { DemoButton } from "./DemoButton";

export const metadata: Metadata = { title: "Demo portal" };

// Public entry to the demo portal (Phase 7 / E3), linked from epsilon-labs.co/work and from proposals.
export default async function DemoPage() {
  const { supabase, claims } = await getSession();
  if (claims && (await inDemo(supabase, claims.sub))) redirect("/");
  return (
    <AuthFrame host="client.epsilon-labs.co">
      <span className="pill pill-warn"><span className="dot" />DEMO · sample data</span>
      <h1 className="t-22" style={{ margin: "14px 0 8px", fontWeight: 500 }}>See the client portal</h1>
      <p className="c-2 t-13" style={{ lineHeight: 1.6 }}>
        Every Epsilon client gets a portal like this: projects with progress, requests and their replies, weekly
        updates, delivery reports and invoices in one place. The demo is a fictional company, Northwind Industrial,
        and it is read-only.
      </p>
      {claims ? (
        <p className="c-2 t-13" style={{ marginTop: 18, lineHeight: 1.6 }}>
          You&apos;re signed in to your own portal. <Link href="/">Go to it</Link>, or open this page in a private window to
          see the demo.
        </p>
      ) : (
        <DemoButton />
      )}
    </AuthFrame>
  );
}
