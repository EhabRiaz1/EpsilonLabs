import type { Metadata } from "next";
import { Icon } from "@/app/components/Icon";
import { portalContext } from "@/lib/portal-context";
import { dayMonth } from "@/lib/dates";
import { hm, tierLabel, usageLine, type Usage } from "@/lib/retainers";
import { PortalHeader } from "../_ui/PortalHeader";
import { NoOrg } from "../_ui/NoOrg";
import { Gauge } from "../_ui/Gauge";

export const metadata: Metadata = { title: "Retainer" };

type Entry = { id: string; minutes: number; note: string; worked_on: string; ticket_id: string | null };

/** Hours used vs included this month, with history (E6). Billable time only; overage is shown, never billed here. */
export default async function RetainerPage() {
  const { supabase, claims, org, projects, unread } = await portalContext();
  if (!org) return <NoOrg email={claims.email} />;
  const { data, error } = await supabase.rpc("retainer_usage", { p_org_id: org.orgId, p_months: 12, p_today: null });
  const usage = (data ?? null) as Usage | null;
  const r = usage?.retainer ?? null;
  const cur = usage?.periods.find((p) => p.current) ?? null;
  const since = cur?.starts_on ?? new Date().toISOString().slice(0, 10);
  const { data: es } = await supabase.from("time_entries").select("id, minutes, note, worked_on, ticket_id").eq("org_id", org.orgId).gte("worked_on", since).order("worked_on", { ascending: false }).limit(100);
  const entries = (es ?? []) as Entry[];
  const ids = [...new Set(entries.map((e) => e.ticket_id).filter((x): x is string => Boolean(x)))];
  const refs = new Map<string, string>();
  if (ids.length) {
    const { data: ts } = await supabase.from("tickets").select("id, ref, title").in("id", ids);
    for (const t of (ts ?? []) as { id: string; ref: string; title: string }[]) refs.set(t.id, `${t.ref} · ${t.title}`);
  }
  const line = cur ? usageLine(cur) : null;
  return (
    <>
      <PortalHeader title="Retainer" sub={r ? `${tierLabel(r.tier)} · ${Number(r.hours_included)} hours a month` : org.name} unread={unread} canRequest={projects.length > 0} />
      {error && <section className="panel panel-pad"><p className="c-bad t-13">Couldn&apos;t load the retainer. Reload to try again.</p></section>}
      {!error && !r && (
        <section className="panel">
          <div className="empty">
            <div className="orb"><span className="wave" /><span className="wave" /><span className="core"><Icon name="clock" className="i-lg" /></span></div>
            <h2 className="display">No retainer</h2>
            <p className="c-2" style={{ maxWidth: "40ch" }}>A monthly retainer (10, 20 or 40 hours) covers fixes, changes and questions. Ask Ehab if you&apos;d like one.</p>
          </div>
        </section>
      )}
      {r && (
        <div className="grid-main" style={{ marginTop: 0 }}>
          <div className="col">
            <section className="panel gauge-panel" aria-label="This month">
              <div className="row between">
                <h2 className="t-16" style={{ fontFamily: "var(--font-sans)", fontWeight: 600 }}>This month</h2>
                {line && <span className={`pill ${line.over ? "pill-warn" : "pill-good"}`}><span className="dot" />{line.left}</span>}
              </div>
              {cur ? (
                <>
                  <Gauge pct={Math.min(100, Math.round(cur.pct))} label={`${hm(cur.used_minutes)} of ${hm(cur.included_minutes)} used`} />
                  <p className="c-3 t-12" style={{ marginTop: 8 }}>Billable time logged by Ehab on your tickets. Anything over the included hours is shown here and discussed with you first; it is never billed automatically.</p>
                </>
              ) : (
                <p className="c-3 t-13" style={{ marginTop: 10 }}>The retainer starts on {r.starts_on}.</p>
              )}
            </section>
            <section className="panel">
              <div className="panel-head"><h2>This month&apos;s time</h2><span className="c-3 t-12 more">{entries.length} entr{entries.length === 1 ? "y" : "ies"}</span></div>
              {entries.length === 0 ? (
                <p className="c-3 t-13" style={{ padding: "0 22px 16px" }}>No time logged yet this month.</p>
              ) : (
                <div className="list-rows" style={{ padding: "0 18px 10px" }}>
                  {entries.map((e) => (
                    <div key={e.id}>
                      <span className="mono t-13" style={{ width: 64 }}>{hm(e.minutes)}</span>
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="truncate" style={{ display: "block" }}>{e.note || (e.ticket_id ? refs.get(e.ticket_id) : "") || "Work"}</span>
                        <span className="c-3 t-12">{dayMonth(e.worked_on)}{e.ticket_id && refs.get(e.ticket_id) && e.note ? ` · ${refs.get(e.ticket_id)}` : ""}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
          <div className="col">
            <section className="panel">
              <div className="panel-head"><h2>History</h2></div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Month</th><th style={{ textAlign: "right" }}>Used</th><th style={{ textAlign: "right" }}>Included</th><th style={{ textAlign: "right" }}>%</th></tr></thead>
                  <tbody>
                    {(usage?.periods ?? []).map((p) => (
                      <tr key={p.period}>
                        <td>{p.period}{p.current ? " · now" : ""}</td>
                        <td style={{ textAlign: "right" }}>{hm(p.used_minutes)}</td>
                        <td style={{ textAlign: "right" }}>{hm(p.included_minutes)}</td>
                        <td style={{ textAlign: "right" }}>{usageLine(p).pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
