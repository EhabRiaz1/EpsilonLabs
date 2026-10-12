"use client";

import { useActionState } from "react";
import { Icon } from "@/app/components/Icon";
import { savePrefs } from "../actions";
import type { Result } from "../actions";

const COMMON = ["Asia/Karachi", "Asia/Dubai", "Asia/Riyadh", "Asia/Kolkata", "Asia/Singapore", "Europe/London", "Europe/Berlin", "Europe/Istanbul", "America/New_York", "America/Chicago", "America/Los_Angeles", "Australia/Sydney", "UTC"];

/** Email preferences (012): immediate / daily digest at 10:00 local / off, and the timezone the digest uses. */
export function EmailPrefs({ pref, timezone }: { pref: string; timezone: string }) {
  const [state, action, pending] = useActionState<Result, FormData>(savePrefs, undefined);
  const zones = COMMON.includes(timezone) ? COMMON : [timezone, ...COMMON];
  return (
    <form action={action} id="email">
      <h2 className="t-16 w-600" style={{ marginBottom: 10 }}>Email notifications</h2>
      <div className="stack" style={{ gap: 8 }} role="radiogroup" aria-label="How often we email you">
        {[
          ["daily", "Daily digest", "Urgent items (an invoice, a report, a request for your input) at once; everything else in one email a day at 10:00."],
          ["immediate", "As it happens", "Every update by email within a few minutes."],
          ["off", "Off", "No emails. Everything stays in the portal's bell."],
        ].map(([v, label, hint]) => (
          <label key={v} className="row" style={{ gap: 10, alignItems: "flex-start" }}>
            <input type="radio" name="email_pref" value={v} defaultChecked={pref === v} style={{ marginTop: 4 }} />
            <span>
              <span className="w-600">{label}</span>
              <span className="c-3 t-12" style={{ display: "block" }}>{hint}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="field" style={{ marginTop: 12, maxWidth: 280 }}>
        <label className="label" htmlFor="prefs-tz">Your timezone</label>
        <select className="select" id="prefs-tz" name="timezone" defaultValue={timezone}>
          {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
        </select>
      </div>
      <button className="btn btn-secondary" type="submit" disabled={pending} style={{ marginTop: 12 }}>
        {pending ? <span className="spinner" /> : null}
        Save
      </button>
      {state?.error && <p className="auth-error" role="alert" style={{ marginTop: 10 }}><Icon name="alert" className="i-sm" />{state.error}</p>}
      {state?.ok && <p className="ok-note" role="status" style={{ marginTop: 10 }}><Icon name="check" className="i-sm" />{state.ok}</p>}
    </form>
  );
}
