import type { Metadata } from "next";
import { Icon } from "@/app/components/Icon";
import { initials } from "@/app/components/Shell";
import { displayName } from "@/lib/session";
import { portalContext } from "@/lib/portal-context";
import { dayMonth, dayMonthYear } from "@/lib/dates";
import { PortalHeader } from "../_ui/PortalHeader";
import { NoOrg } from "../_ui/NoOrg";
import { InviteForm, NameForm, OrgSwitcher, TeamAction } from "../_ui/AccountForms";
import { EmailPrefs } from "../_ui/EmailPrefs";
import Link from "next/link";

export const metadata: Metadata = { title: "Account & team" };

type Team = {
  can_manage: boolean;
  members: { user_id: string; email: string; name: string; role: string; joined_at: string; is_me: boolean }[];
  invites: { id: string; email: string; role: string; created_at: string; expires_at: string; state: string }[];
};

export default async function AccountPage() {
  const { supabase, claims, org, all, projects, unread } = await portalContext();
  const name = displayName(claims);
  if (!org) return <NoOrg email={claims.email} />;
  const [{ data, error }, { data: prof }] = await Promise.all([
    supabase.rpc("org_team", { p_org_id: org.orgId }),
    supabase.from("profiles").select("timezone, email_pref").eq("user_id", claims.sub).maybeSingle(),
  ]);
  const prefs = (prof ?? { timezone: "Asia/Karachi", email_pref: "daily" }) as { timezone: string; email_pref: string };
  const team = (data ?? { can_manage: false, members: [], invites: [] }) as Team;
  const pending = team.invites.filter((i) => i.state === "pending" || i.state === "expired");
  const owners = team.members.filter((m) => m.role === "owner").length;

  return (
    <>
      <PortalHeader title="Account & team" sub={claims.email} unread={unread} canRequest={projects.length > 0} />
      <div className="grid-main" style={{ marginTop: 0 }}>
        <div className="col">
          <section className="panel">
            <div className="panel-head">
              <h2>Team · {org.name}</h2>
              <span className="c-3 t-12 more">
                {team.members.length} {team.members.length === 1 ? "person" : "people"}
              </span>
            </div>
            {error ? (
              <p className="c-bad t-13 panel-pad">Couldn&apos;t load the team. Reload to retry.</p>
            ) : (
              <div className="list-rows" style={{ padding: "0 18px 10px" }}>
                {team.members.map((m) => (
                  <div key={m.user_id}>
                    <span className="avatar">{initials(m.name || m.email)}</span>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="w-600">
                        {m.name || m.email.split("@")[0]}
                        {m.is_me ? " (you)" : ""}
                      </span>
                      <span className="c-3 t-12 truncate" style={{ display: "block" }}>
                        {m.email} · {m.role === "owner" ? "Owner" : "Member"} · since {dayMonth(m.joined_at)}
                      </span>
                    </span>
                    {team.can_manage && !m.is_me && !(m.role === "owner" && owners <= 1) && (
                      <TeamAction kind="remove" orgId={org.orgId} id={m.user_id} label="Remove" confirmText={`Remove ${m.email} from ${org.name}? They lose access straight away.`} />
                    )}
                  </div>
                ))}
              </div>
            )}
            {team.can_manage && pending.length > 0 && (
              <>
                <div className="panel-head" style={{ paddingTop: 6 }}>
                  <h2 className="t-13">Invites</h2>
                </div>
                <div className="list-rows" style={{ padding: "0 18px 10px" }}>
                  {pending.map((i) => (
                    <div key={i.id}>
                      <span className="avatar avatar-soft" aria-hidden="true">
                        <Icon name="mail" className="i-sm" />
                      </span>
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="w-500 truncate" style={{ display: "block" }}>
                          {i.email}
                        </span>
                        <span className={`t-12 ${i.state === "expired" ? "c-bad" : "c-3"}`}>
                          {i.state === "expired" ? `Expired ${dayMonth(i.expires_at)}` : `Pending · expires ${dayMonthYear(i.expires_at)}`}
                        </span>
                      </span>
                      {i.state === "pending" && (
                        <TeamAction kind="revoke" orgId={org.orgId} id={i.id} label="Revoke" confirmText={`Revoke the invite for ${i.email}? The link stops working.`} />
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="panel-pad" style={{ borderTop: "1px solid var(--line)" }}>
              {team.can_manage ? (
                <InviteForm orgId={org.orgId} />
              ) : (
                <p className="c-3 t-13">Only an owner of {org.name} can invite people. Ask {team.members.find((m) => m.role === "owner")?.name || "your owner"}.</p>
              )}
            </div>
          </section>
        </div>
        <div className="col">
          <section className="panel panel-pad">
            <NameForm name={name === (claims.email ?? "").split("@")[0] ? "" : name} />
            <p className="hint" style={{ marginTop: 14 }}>
              You sign in with a one-time link sent to {claims.email}. No password is needed.
            </p>
          </section>
          <section className="panel panel-pad">
            <EmailPrefs pref={prefs.email_pref} timezone={prefs.timezone} />
          </section>
          <section className="panel panel-pad">
            <h2 className="t-16 w-600" style={{ marginBottom: 6 }}>Testimonial</h2>
            <p className="c-3 t-13" style={{ marginBottom: 10 }}>Happy with the work? A couple of sentences in your own words helps. Only what you approve is ever quoted.</p>
            <Link className="btn btn-secondary btn-sm" href="/testimonial">
              <Icon name="sparkle" className="i-sm" />
              Write or approve a testimonial
            </Link>
          </section>
          {all.length > 1 && (
            <section className="panel">
              <div className="panel-head">
                <h2>Your organisations</h2>
              </div>
              <div style={{ padding: "0 18px 12px" }}>
                <OrgSwitcher orgs={all.map((m) => ({ orgId: m.orgId, name: m.name, role: m.role }))} current={org.orgId} />
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
