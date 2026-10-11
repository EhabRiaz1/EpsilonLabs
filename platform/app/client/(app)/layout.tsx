import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Shell, initials } from "@/app/components/Shell";
import { displayName, getSession } from "@/lib/session";
import { myMemberships } from "@/lib/orgs";

export default async function ClientAppLayout({ children }: { children: ReactNode }) {
  const { supabase, claims } = await getSession();
  if (!claims) redirect("/login");
  const orgs = await myMemberships(supabase, claims.sub);
  const org = orgs[0];
  const name = displayName(claims);
  return (
    <Shell
      orgName={org?.name ?? "Your portal"}
      orgHost="client.epsilon-labs.co"
      searchLabel="Search or jump to…"
      nav={[{ href: "/", label: "Home", icon: "home", current: true }]}
      user={{
        name,
        detail: org ? `${org.role === "owner" ? "Owner" : "Member"} · ${org.name}` : (claims.email ?? ""),
        initials: initials(name),
      }}
    >
      {children}
    </Shell>
  );
}
