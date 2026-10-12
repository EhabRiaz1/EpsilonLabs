import { ActionButton, ActionForm } from "@/app/components/Forms";
import { hm } from "@/lib/retainers";
import { dayMonth, isoDaysFromNow } from "@/lib/dates";
import { deleteTime, logTime } from "../clients/retainer-actions";

export type TimeEntry = { id: string; minutes: number; note: string; billable: boolean; worked_on: string };

/** Time on a ticket (E6): logged by the founder; billable time counts against the client's retainer and they see it. */
export function TimePanel({ ticketId, entries, hasRetainer }: { ticketId: string; entries: TimeEntry[]; hasRetainer: boolean }) {
  const total = entries.reduce((s, e) => s + e.minutes, 0);
  const billable = entries.filter((e) => e.billable).reduce((s, e) => s + e.minutes, 0);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Time</h2>
        <span className="c-3 t-12 more">{entries.length ? `${hm(total)} logged · ${hm(billable)} billable` : hasRetainer ? "retainer client" : "no retainer"}</span>
      </div>
      {entries.length > 0 && (
        <div className="list-rows" style={{ padding: "0 18px 8px" }}>
          {entries.map((e) => (
            <div key={e.id}>
              <span className="mono t-13" style={{ width: 64 }}>{hm(e.minutes)}</span>
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="truncate" style={{ display: "block" }}>{e.note || "(no note)"}</span>
                <span className="c-3 t-12">{dayMonth(e.worked_on)}{e.billable ? "" : " · not billable"}</span>
              </span>
              <ActionButton className="btn btn-ghost btn-sm" label="Delete" confirmText="Delete this time entry?" action={deleteTime.bind(null, ticketId, e.id)} />
            </div>
          ))}
        </div>
      )}
      <div className="pane" style={{ borderTop: entries.length ? "1px solid var(--line)" : undefined }}>
        <ActionForm action={logTime.bind(null, ticketId)} submit="Log time" icon="clock" secondary>
          <div className="row wrap" style={{ gap: 10 }}>
            <div className="field" style={{ width: 110 }}><label className="label" htmlFor="tm-time">Time</label><input className="input" id="tm-time" name="time" required placeholder="1h 30m" /></div>
            <div className="field" style={{ width: 160 }}><label className="label" htmlFor="tm-on">Day</label><input className="input" type="date" id="tm-on" name="worked_on" defaultValue={isoDaysFromNow(0)} max={isoDaysFromNow(0)} /></div>
            <div className="field grow" style={{ minWidth: 180 }}><label className="label" htmlFor="tm-note">Note <span className="c-3">(the client sees billable notes)</span></label><input className="input" id="tm-note" name="note" maxLength={500} /></div>
          </div>
          <label className="row t-13" style={{ gap: 8, marginTop: 8 }}>
            <input type="checkbox" name="billable" defaultChecked /> Billable (counts against the retainer)
          </label>
        </ActionForm>
      </div>
    </section>
  );
}
