"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import {
  asList, asText, formToSettings, SEGMENTS, STRATEGIES, TENDER_DISABLED, TENDER_LIVE, TENDER_SOURCE_LABEL, type SettingsValues,
} from "@/lib/admin-settings";
import { saveSettings, type SettingsResult } from "./actions";

function Field({ name, label, hint, err, children }: { name: string; label: string; hint?: string; err?: string; children: ReactNode }) {
  return (
    <label className="field" htmlFor={name}>
      <span className="label">{label}</span>
      {children}
      {err ? <span className="field-err" id={`${name}-err`}>{err}</span> : hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

/** The 8787 /settings form, posted as the same fields to save_settings(). Errors come back per field. */
export function SettingsForm({ v }: { v: SettingsValues }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [r, setR] = useState<SettingsResult | null>(null);
  const e = r?.errors ?? {};
  const quotas = (v["strategy.quotas"] ?? {}) as Record<string, number>;
  const pinned = asList(v["strategy.pinned"]);
  const segs = asList(v["prospector.segments"]);
  const srcs = asList(v["tenders.sources"]);
  const address = asText(v["outreach.address"]);
  const num = (name: string, key: string, label: string, hint: string, min: number, max: number) => (
    <Field name={name} label={label} hint={hint} err={e[name]}>
      <input className="input" id={name} name={name} type="number" inputMode="numeric" min={min} max={max} defaultValue={asText(v[key])} aria-invalid={Boolean(e[name])} aria-describedby={e[name] ? `${name}-err` : undefined} />
    </Field>
  );
  const box = (name: string, value: string, label: string, checked: boolean) => (
    <label key={`${name}-${value}`} className="check">
      <input type="checkbox" name={name} value={value} defaultChecked={checked} />
      <span>{label}</span>
    </label>
  );

  return (
    <form
      className="stack"
      style={{ gap: 14 }}
      onSubmit={(ev) => {
        ev.preventDefault();
        const p = formToSettings(new FormData(ev.currentTarget));
        start(async () => {
          try {
            const res = await saveSettings(p);
            setR(res);
            if (res.ok) router.refresh();
          } catch {
            setR({ ok: false, message: "Couldn't reach admin. Nothing was saved." });
          }
        });
      }}
    >
      <input type="hidden" name="$segments" value="1" />
      <input type="hidden" name="$tenders" value="1" />

      <section className="panel panel-pad">
        <h2 className="t-16 w-600">Prospector</h2>
        <div className="form-grid" style={{ marginTop: 14 }}>
          {num("per_day", "prospector.per_day", "Prospects per day", "0 to 80. The strategy quotas must fit inside it.", 0, 80)}
          {num("daily_budget", "llm.daily_budget", "LLM calls per day", "50 to 1000. Agents stop calling the model at the budget.", 50, 1000)}
          <div className="field span-2">
            <span className="label">Segments</span>
            <div className="checks">{SEGMENTS.map(([id, label]) => box("segments", id, label, segs.includes(id)))}</div>
            {e.segments && <span className="field-err">{e.segments}</span>}
          </div>
          <div className="field span-2">{box("paused", "on", "Pause the prospector", Boolean(v["prospector.paused"]))}</div>
          <Field name="markets" label="Markets" hint="Two-letter country codes. Pakistan and sanctioned markets are never used." err={e.markets}>
            <textarea className="textarea" id="markets" name="markets" rows={3} defaultValue={asList(v["prospector.markets"]).join(", ")} />
          </Field>
        </div>
      </section>

      <section className="panel panel-pad">
        <h2 className="t-16 w-600">Strategies</h2>
        <p className="hint" style={{ marginTop: 4 }}>Prospects per day for each research strategy. Pinned quotas are never moved by the weekly rebalance.</p>
        {e.quotas && <p className="field-err" style={{ marginTop: 8 }}>{e.quotas}</p>}
        <div className="quota-grid" style={{ marginTop: 12 }}>
          {STRATEGIES.map(([id, label]) => (
            <div key={id} className="quota">
              <label className="label" htmlFor={`quota_${id}`}>{label}</label>
              <div className="row" style={{ gap: 10 }}>
                <input className="input" id={`quota_${id}`} name={`quota_${id}`} type="number" inputMode="numeric" min={0} max={50} defaultValue={String(quotas[id] ?? 0)} aria-invalid={Boolean(e[`quota_${id}`])} style={{ width: 90 }} />
                {box(`pin_${id}`, "on", "Pin", pinned.includes(id))}
              </div>
              {e[`quota_${id}`] && <span className="field-err">{e[`quota_${id}`]}</span>}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>{box("auto_rebalance", "on", "Rebalance quotas weekly toward the best positive-reply rate", Boolean(v["strategy.auto_rebalance"]))}</div>
      </section>

      <section className="panel panel-pad">
        <h2 className="t-16 w-600">Outreach</h2>
        <div className="form-grid" style={{ marginTop: 14 }}>
          {num("daily_cap", "outreach.daily_cap", "Cold emails per day (cap)", "0 to 100. The warm-up ramp stays below it.", 0, 100)}
          {address ? (
            <div className="field">
              <span className="label">Sending address</span>
              <span className="input" style={{ display: "flex", alignItems: "center" }} aria-readonly="true">{address}</span>
              <span className="hint">Set once; change it on the Mac if it must move.</span>
            </div>
          ) : (
            <Field name="address" label="Sending address" hint="The outreach mailbox (not er@). Set once." err={e.address}>
              <input className="input" id="address" name="address" type="email" placeholder="ehab@yourdomain.example" />
            </Field>
          )}
        </div>
      </section>

      <section className="panel panel-pad">
        <h2 className="t-16 w-600">Tenders</h2>
        <div className="form-grid" style={{ marginTop: 14 }}>
          {num("tenders_per_day", "tenders.per_day", "Tenders scored per day", "0 to 50.", 0, 50)}
          <div />
          {num("tenders_value_min", "tenders.value_min", "Minimum value (USD)", "Tenders with no stated value are always kept.", 0, 100000000)}
          {num("tenders_value_max", "tenders.value_max", "Maximum value (USD)", "Up to 100,000,000.", 0, 100000000)}
          <div className="field span-2">
            <span className="label">Sources</span>
            <div className="checks">{TENDER_LIVE.map((s) => box("tenders_sources", s, TENDER_SOURCE_LABEL[s], srcs.includes(s)))}</div>
            <div className="checks c-3">{TENDER_DISABLED.map((s) => box("tenders_sources", s, TENDER_SOURCE_LABEL[s], srcs.includes(s)))}</div>
            {e.tenders_sources && <span className="field-err">{e.tenders_sources}</span>}
          </div>
          <div className="field span-2">{box("tenders_paused", "on", "Pause the tender scan", Boolean(v["tenders.paused"]))}</div>
        </div>
      </section>

      <div className="actions-bar save-bar">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? <span className="spinner" /> : <Icon name="check" className="i-sm" />}
          Save settings
        </button>
        {r && !r.ok && (
          <span className="auth-error" role="alert" style={{ marginTop: 0 }}><Icon name="alert" className="i-sm" />{r.message}</span>
        )}
        {r?.ok && (
          <span className="ok-note" role="status"><Icon name="check" className="i-sm" />{r.changed?.length ? `Saved: ${r.changed.join(", ")}` : "Nothing changed."}</span>
        )}
      </div>
    </form>
  );
}
