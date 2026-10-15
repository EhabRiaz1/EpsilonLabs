import { ActionButton, ActionForm } from "@/app/components/Forms";
import { ArcGauge } from "@/app/components/ArcGauge";
import { hm, tierLabel, usageLine, type Usage } from "@/lib/retainers";
import { dayMonth, isoDaysFromNow } from "@/lib/dates";
import { deleteTime, logTime } from "../clients/retainer-actions";

export type TimeEntry = { id: string; minutes: number; note: string; billable: boolean; worked_on: string };

/** Time on a ticket (E6): logged by the founder; billable time counts against the client's retainer and they see it.
 *  With a retainer, the gauge shows this period's use from retainer_usage() (design review D8). */
export function TimePanel({ ticketId, entries, hasRetainer, usage }: { ticketId: string; entries: TimeEntry[]; hasRetainer: boolean; usage?: Usage | null }) {
  const total = entries.reduce((s, e) => s + e.minutes, 0);
  const billable = entries.filter((e) => e.billable).reduce((s, e) => s + e.minutes, 0);
  const period = usage?.retainer ? (usage.periods.find((p) => p.current) ?? usage.periods[0] ?? null) : null;
  const line = period ? usageLine(period) : null;
  return (
    <section className="panel" id="time">
      <div className="panel-head">
        <h2>Time</h2>
        <span className="c-3 t-12 more">{entries.length ? `${hm(total)} logged · ${hm(billable)} billable` : hasRetainer ? "retainer client" : "no retainer"}</span>
      </div>
      {usage?.retainer && period && line && (
        <div className="retainer">
          <div className="row between">
            <span className="t-13 w-600">{tierLabel(usage.retainer.tier)}</span>
            <span className={`t-12 mono ${line.over ? "c-bad" : "c-3"}`}>{line.left}</span>
          </div>
          <ArcGauge pct={line.pct} value={hm(period.used_minutes)} label={`of ${hm(period.included_minutes)} this period`} />
          {usage.upsell && <p className="hint">Over 85% in 2 of the last 3 periods: worth offering a bigger tier.</p>}
        </div>
      )}
      {entries.length > 0 && (
        <div className="entries">
          {entries.map((e) => (
            <div key={e.id}>
              <span className="mono t-13 entry-t">{hm(e.minutes)}</span>
              <span className="grow entry-n">
                <span className="truncate">{e.note || "(no note)"}</span>
                <span className="c-3 t-12">{dayMonth(e.worked_on)}{e.billable ? "" : " · not billable"}</span>
              </span>
              <ActionButton className="btn btn-ghost btn-sm" label="Delete" confirmText="Delete this time entry?" action={deleteTime.bind(null, ticketId, e.id)} />
            </div>
          ))}
        </div>
      )}
      <div className="pane time-form">
        <ActionForm action={logTime.bind(null, ticketId)} submit="Log time" icon="clock" secondary>
          <div className="row wrap time-fields">
            <div className="field f-time"><label className="label" htmlFor="tm-time">Time</label><input className="input" id="tm-time" name="time" required placeholder="1h 30m" /></div>
            <div className="field f-day"><label className="label" htmlFor="tm-on">Day</label><input className="input" type="date" id="tm-on" name="worked_on" defaultValue={isoDaysFromNow(0)} max={isoDaysFromNow(0)} /></div>
            <div className="field grow f-note"><label className="label" htmlFor="tm-note">Note <span className="c-3">(the client sees billable notes)</span></label><input className="input" id="tm-note" name="note" maxLength={500} /></div>
          </div>
          <label className="row t-13 time-bill">
            <input type="checkbox" name="billable" defaultChecked /> Billable (counts against the retainer)
          </label>
        </ActionForm>
      </div>
    </section>
  );
}
