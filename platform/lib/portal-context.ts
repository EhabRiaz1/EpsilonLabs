import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getSession } from "./session";
import { currentOrg } from "./orgs";
import { notificationsOf, projectsOf } from "./portal";

/**
 * Everything the portal layout and its pages share, loaded once per request (React cache): the user, the
 * organisation on screen (the switcher's choice), its projects and the bell. Redirects to /login when signed out.
 */
export const portalContext = cache(async () => {
  const { supabase, claims } = await getSession();
  if (!claims) redirect("/login");
  const { org, all } = await currentOrg(supabase, claims.sub);
  const [projects, notifications] = org
    ? await Promise.all([projectsOf(supabase, org.orgId), notificationsOf(supabase, org.orgId)])
    : [[], []];
  return { supabase, claims, org, all, projects, notifications, unread: notifications.filter((n) => !n.read_at).length };
});
