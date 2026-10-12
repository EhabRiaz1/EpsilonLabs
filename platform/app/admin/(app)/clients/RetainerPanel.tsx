import { ActionForm } from "@/app/components/Forms";
import { hm, tierLabel, TIERS, usageLine, type Usage } from "@/lib/retainers";
import { isoDaysFromNow } from "@/lib/dates";
import { saveRetainer } from "./retainer-actions";

/** Retainer (E6) on the client page: usage per month, the upsell flag, and the retainer itself. */
export function RetainerPanel({ orgId, usage, error }: { orgId: string; usage: Usage | null; error: boolean }) {
  const r = usage?.retainer ?? null;
  const fields = (idp: string) => (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="field grow" style={{ minWidth: 160 }}>
          <label className="label" htmlFor={`${idp}-tier`}>Tier</label>
          <select className="select" id={`${idp}-tier`} name="tier" defaultValue={r?.tier ?? "r10"}>
            {TIERS.map((t) => <option key={t.id} value={t.id}>{t.label}{t.hours ? ` · ${t.hours} h/month` : ""}</option>)}
          </select>
        </div>
        <div className="field" style={{ width: 130 }}>
          <label className="label" htmlFor={`${idp}-hours`}>Hours (custom)</label>
          <input className="input" id={`${idp}-hours`} name="hours" inputMode="decimal" defaultValue={r ? String(r.hours_included) : ""} />
        </div>
      </div>
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="field grow"><label className="label" htmlFor={`${idp}-start`}>Starts</label><input className="input" type="date" id={`${idp}-start`} name="starts_on" required defaultValue={r?.starts_on ?? isoDaysFromNow(0)} /></div>
        <div className="field grow"><label className="label" htmlFor={`${idp}-end`}>Ends <span className="c-3">(optional)</span></label><input className="input" type="date" id={`${idp}-end`} name="ends_on" defaultValue={r?.ends_on ?? ""} /></div>
        <div className="field" style={{ width: 140 }}>
          <label className="label" htmlFor={`${idp}-status`}>Status</label>
          <select className="select" id={`${idp}-status`} name="status" defaultValue={r?.status ?? "active"}>
            <option value="active">Active</option><option value="paused">Paused</option><option value="ended">Ended</option>
          </select>
        </div>
      </div>
    </div>
  );
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Retainer</h2>
        {usage?.upsell && (
          <span className="pill pill-warn more" title="Above 85% in 2 of the last 3 months. Overage is shown, never billed.">
            <span className="dot" />Upsell: {usage.over_85} of 3 months above 85%
          </span>
        )}
      </div>
      {error && <p className="c-bad t-13 panel-pad">Couldn&apos;t load the retainer.</p>}
      {r ? (
        <>
          <p className="c-3 t-13" style={{ padding: "0 22px 8px" }}>
            {tierLabel(r.tier)} · {Number(r.hours_included)} h a month · since {r.starts_on}{r.ends_on ? ` until ${r.ends_on}` : ""} · {r.status}
          </p>
          {usage && usage.periods.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Month</th><th style={{ textAlign: "right" }}>Used</th><th style={{ textAlign: "right" }}>Included</th><th style={{ textAlign: "right" }}>%</th></tr></thead>
                <tbody>
                  {usage.periods.map((p) => {
                    const u = usageLine(p);
                    return (
                      <tr key={p.period}>
                        <td>{p.period}{p.current ? " · this month" : ""}</td>
                        <td style={{ textAlign: "right" }}>{hm(p.used_minutes)}</td>
                        <td style={{ textAlign: "right" }}>{hm(p.included_minutes)}</td>
                        <td style={{ textAlign: "right" }} className={p.pct > 85 ? "c-warn" : undefined}>{u.pct}%{u.over ? " · over" : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <details style={{ borderTop: "1px solid var(--line)" }}>
            <summary className="row" style={{ padding: "14px 22px", cursor: "pointer", listStyle: "none" }}><span className="w-600">Edit the retainer</span></summary>
            <div style={{ padding: "4px 22px 20px" }}>
              <ActionForm action={saveRetainer.bind(null, orgId, r.id)} submit="Save" secondary>{fields("ret-edit")}</ActionForm>
            </div>
          </details>
        </>
      ) : (
        <div style={{ padding: "0 22px 20px" }}>
          <p className="c-3 t-13" style={{ marginBottom: 10 }}>No retainer. Tiers are 10, 20 and 40 hours a month; time is logged on tickets.</p>
          <ActionForm action={saveRetainer.bind(null, orgId, null)} submit="Start the retainer" icon="clock">{fields("ret-new")}</ActionForm>
        </div>
      )}
    </section>
  );
}
