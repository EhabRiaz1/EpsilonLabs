import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { NoAccess } from "@/app/components/NoAccess";
import { Shell, initials } from "@/app/components/Shell";
import { AdminPalette } from "@/app/components/AdminPalette";
import { PwaBoot } from "@/app/components/PwaBoot";
import { displayName, getStaff } from "@/lib/session";
import { ADMIN_NAV } from "@/lib/admin-nav";
import { AdminNav, type TicketOrg } from "@/app/components/AdminNav";
import { ago, hhmm, workerOnline } from "@/lib/admin-ops";

const OPEN_TICKETS = ["new", "triaged", "briefed", "planned", "approved", "in_progress"];

// Every admin page sits under this guard: a staff row AND aal2 (F11). RLS checks the same thing again.
export default async function AdminAppLayout({ children }: { children: ReactNode }) {
  const { supabase, claims, staff } = await getStaff();
  if (!claims) redirect("/login");
  if (!staff) return <NoAccess email={claims.email} />;
  if (claims.aal !== "aal2") redirect("/mfa");
  const name = displayName(claims);
  // sidebar counts (RLS scopes all of them): decks waiting, new enquiries, tickets waiting on the founder
  const [approvals, intake, tickets, worker, queued, updates, openByOrg] = await Promise.all([
    supabase.from("approval_queue").select("id", { count: "exact", head: true }).eq("status", "pending").eq("held", false),
    supabase.from("intake").select("id", { count: "exact", head: true }).eq("status", "new"),
    supabase.from("tickets").select("id", { count: "exact", head: true }).in("status", OPEN_TICKETS),
    supabase.from("agent_heartbeats").select("last_run").eq("agent", "worker").order("last_run", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "queued"),
    supabase.from("updates").select("id", { count: "exact", head: true }).eq("status", "draft"),
    // the Tickets tree: open tickets per client (a failure just renders Tickets without the tree)
    supabase.from("tickets").select("org_id, organizations(name, is_demo)").in("status", OPEN_TICKETS).limit(500),
  ]);
  const ticketOrgs: TicketOrg[] | null = openByOrg.error
    ? null
    : Object.values(
        ((openByOrg.data ?? []) as unknown as { org_id: string; organizations: { name: string; is_demo: boolean } | null }[]).reduce<
          Record<string, TicketOrg>
        >((acc, r) => {
          const name = r.organizations?.name ?? "Client";
          acc[r.org_id] = { id: r.org_id, name, open: (acc[r.org_id]?.open ?? 0) + 1 };
          return acc;
        }, {}),
      ).sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
  if (openByOrg.error) console.error("nav tree query failed:", openByOrg.error.message);
  const counts: Record<string, { count?: number; hot?: boolean }> = {
    "/approvals": { count: approvals.count || undefined, hot: true },
    "/intake": { count: intake.count || undefined },
    "/tickets": { count: tickets.count || undefined },
    "/updates": { count: updates.count || undefined },
  };
  const now = new Date();
  const last = (worker.data as { last_run: string } | null)?.last_run ?? null;
  const online = workerOnline(last, now);
  return (
    <Shell
      orgName="Epsilon Labs"
      orgHost="admin.epsilon-labs.co"
      searchLabel="Jump to…"
      navigation={<AdminNav groups={ADMIN_NAV} counts={counts} ticketOrgs={ticketOrgs} />}
      worker={
        <div className={`sb-worker${online ? "" : " off"}`} role="status">
          <span className="dot" />
          <div className="grow">
            <strong>{online ? "Worker online · Mac" : last ? `Worker offline since ${hhmm(last)}` : "Worker not running yet"}</strong>
            <span>
              {online
                ? `heartbeat ${ago(last, now)} ago · ${queued.count ?? 0} queued`
                : "Mac jobs wait until it is back"}
            </span>
          </div>
        </div>
      }
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
      user={{ name, detail: staff.scope === "test" ? staff.email : "Founder", initials: initials(name) }}
    >
      {children}
      <AdminPalette />
      <PwaBoot />
    </Shell>
  );
}
