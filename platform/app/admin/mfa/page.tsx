import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/app/components/AuthFrame";
import { MfaForm } from "@/app/components/MfaForm";
import { NoAccess } from "@/app/components/NoAccess";
import { signOut } from "@/lib/auth-actions";
import { getStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Two-factor" };

export default async function MfaPage() {
  const { supabase, claims, staff } = await getStaff();
  if (!claims) redirect("/login");
  if (!staff) return <NoAccess email={claims.email} />;
  if (claims.aal === "aal2") redirect("/");
  const { data } = await supabase.auth.mfa.listFactors();
  const verified = data?.totp?.find((f) => f.status === "verified") ?? null;
  return (
    <AuthFrame host="admin.epsilon-labs.co">
      <MfaForm verifiedFactorId={verified?.id ?? null} />
      <form action={signOut} className="mt-14 ta-c">
        <button className="link-btn t-12" type="submit">
          Not you? Sign out
        </button>
      </form>
    </AuthFrame>
  );
}
