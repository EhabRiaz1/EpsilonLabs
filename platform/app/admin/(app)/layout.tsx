import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { NoAccess } from "@/app/components/NoAccess";
import { Shell, initials } from "@/app/components/Shell";
import { displayName, getStaff } from "@/lib/session";

// Every admin page sits under this guard: a staff row AND aal2 (F11). RLS checks the same thing again.
export default async function AdminAppLayout({ children }: { children: ReactNode }) {
  const { supabase, claims, staff } = await getStaff();
  if (!claims) redirect("/login");
  if (!staff) return <NoAccess email={claims.email} />;
  if (claims.aal !== "aal2") redirect("/mfa");
  const name = displayName(claims);
  // sidebar counts: new enquiries, tickets waiting on the founder (RLS scopes both)
  const [intake, tickets] = await Promise.all([
    supabase.from("intake").select("id", { count: "exact", head: true }).eq("status", "new"),
    supabase.from("tickets").select("id", { count: "exact", head: true }).in("status", ["new", "triaged", "briefed", "planned", "approved", "in_progress"]),
  ]);
  return (
    <Shell
      orgName="Epsilon admin"
      orgHost="admin.epsilon-labs.co"
      searchLabel="Jump to…"
      nav={[
        { href: "/", label: "Overview", icon: "home" },
        { href: "/intake", label: "Intake", icon: "zap", count: intake.count || undefined },
        { href: "/clients", label: "Clients", icon: "users" },
        { href: "/tickets", label: "Tickets", icon: "ticket", count: tickets.count || undefined },
        { href: "/proposals", label: "Proposals", icon: "file" },
        { href: "/invoices", label: "Invoices", icon: "receipt" },
        { href: "/terms", label: "Terms", icon: "shield" },
      ]}
      status={
        staff.scope === "test" ? (
          <span className="pill pill-warn">
            <span className="dot" />
            Test scope
          </span>
        ) : (
          <span className="pill pill-good">
            <span className="dot" />
            2FA on
          </span>
        )
      }
      user={{ name, detail: staff.email, initials: initials(name) }}
    >
      {children}
    </Shell>
  );
}
