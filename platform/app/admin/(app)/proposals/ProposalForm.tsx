"use client";

import { useActionState, useMemo, useState } from "react";
import { Icon } from "@/app/components/Icon";
import { Money } from "@/app/components/Money";
import { DEFAULT_SCHEDULE, scheduleAmounts, scheduleError, type Stage } from "@/lib/money";
import type { Package } from "@/lib/packages";
import type { ActionState } from "./actions";

export type FormValues = {
  title: string;
  client_company: string;
  contact_name: string;
  contact_email: string;
  summary: string;
  scope_md: string;
  timeline_md: string;
  changes_md: string;
  valid_until: string;
  lines: { slug: string; qty: number; description: string }[];
  schedule: Stage[];
};

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * Proposal editor. Packages and their prices come from the catalogue (passed in by the server); the price is shown
 * locked and the server re-prices every line on save, so nothing typed here can change a price.
 */
export function ProposalForm({ initial, packages, action, submitLabel, showChanges }: { initial: FormValues; packages: Package[]; action: Action; submitLabel: string; showChanges: boolean }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [lines, setLines] = useState(initial.lines);
  const [schedule, setSchedule] = useState<Stage[]>(initial.schedule.length ? initial.schedule : [...DEFAULT_SCHEDULE]);
  const bySlug = useMemo(() => new Map(packages.map((p) => [p.slug, p])), [packages]);
  const categories = useMemo(() => [...new Set(packages.map((p) => p.category))], [packages]);
  const priced = lines.map((l) => ({ ...l, pkg: bySlug.get(l.slug) }));
  const total = priced.reduce((a, l) => a + (l.pkg ? Math.round(l.pkg.price_from * l.qty * 100) : 0), 0) / 100;
  const schedErr = scheduleError(schedule);
  const amounts = !schedErr && total > 0 ? scheduleAmounts(total, schedule) : null;
  const sum = schedule.reduce((a, s) => a + (Number.isFinite(s.pct) ? s.pct : 0), 0);

  const setLine = (i: number, patch: Partial<FormValues["lines"][number]>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const setStage = (i: number, patch: Partial<Stage>) => setSchedule((ss) => ss.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <form action={formAction} className="stack pform" style={{ gap: 14 }}>
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <input type="hidden" name="schedule" value={JSON.stringify(schedule)} />

      <section className="panel panel-pad stack" style={{ gap: 14 }}>
        <div className="eyebrow">Client</div>
        <div className="field">
          <label className="label" htmlFor="title">
            Proposal title
          </label>
          <input className="input input-lg" id="title" name="title" defaultValue={initial.title} maxLength={200} required placeholder="Plant Visibility Pilot" />
        </div>
        <div className="pform-grid">
          <div className="field">
            <label className="label" htmlFor="client_company">
              Client company
            </label>
            <input className="input" id="client_company" name="client_company" defaultValue={initial.client_company} maxLength={200} required />
          </div>
          <div className="field">
            <label className="label" htmlFor="valid_until">
              Valid until
            </label>
            <input className="input" id="valid_until" name="valid_until" type="date" defaultValue={initial.valid_until} required />
          </div>
          <div className="field">
            <label className="label" htmlFor="contact_name">
              Contact name
            </label>
            <input className="input" id="contact_name" name="contact_name" defaultValue={initial.contact_name} maxLength={200} required />
          </div>
          <div className="field">
            <label className="label" htmlFor="contact_email">
              Contact email (receives the link and the accept code)
            </label>
            <input className="input" id="contact_email" name="contact_email" type="email" defaultValue={initial.contact_email} maxLength={254} required />
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="summary">
            Summary (the opening paragraph)
          </label>
          <textarea className="textarea" id="summary" name="summary" defaultValue={initial.summary} maxLength={2000} rows={3} />
        </div>
      </section>

      <section className="panel panel-pad stack" style={{ gap: 12 }}>
        <div className="row between">
          <div className="eyebrow">Packages · prices locked to the catalogue</div>
          <span className="c-3 t-12">
            <Icon name="lock" className="i-sm" /> tools/offers.py
          </span>
        </div>
        {priced.length === 0 && <p className="c-3 t-13">No packages yet. Add one below.</p>}
        {priced.map((l, i) => (
          <div className="pline" key={i}>
            <select className="input" aria-label="Package" value={l.slug} onChange={(e) => setLine(i, { slug: e.currentTarget.value })}>
              {categories.map((c) => (
                <optgroup key={c} label={c}>
                  {packages
                    .filter((p) => p.category === c)
                    .map((p) => (
                      <option key={p.slug} value={p.slug}>
                        {p.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <input
              className="input pline-qty"
              aria-label="Quantity"
              type="number"
              min={1}
              max={10000}
              step={1}
              value={l.qty}
              onChange={(e) => setLine(i, { qty: Math.max(1, Math.floor(Number(e.currentTarget.value) || 1)) })}
            />
            <div className="pline-price">
              {l.pkg ? (
                <>
                  <Money value={l.pkg.price_from * l.qty} currency={l.pkg.currency} />
                  <span className="c-3 t-11">
                    <Icon name="lock" className="i-sm" /> {l.qty > 1 ? `${l.qty} × ` : ""}
                    {l.pkg.price_note || "catalogue price"}
                  </span>
                </>
              ) : (
                <span className="c-bad t-12">Not in the catalogue</span>
              )}
            </div>
            <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label="Remove package" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
              <Icon name="trash" className="i-sm" />
            </button>
            <input
              className="input pline-desc"
              aria-label="Line description"
              placeholder="What this line covers for this client (optional)"
              maxLength={1000}
              value={l.description}
              onChange={(e) => setLine(i, { description: e.currentTarget.value })}
            />
          </div>
        ))}
        <div className="row between">
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => setLines((ls) => [...ls, { slug: packages[0]?.slug ?? "", qty: 1, description: "" }])}>
            <Icon name="plus" className="i-sm" />
            Add package
          </button>
          <span className="t-13">
            Total <Money value={total} currency="USD" className="money w-600" />
          </span>
        </div>
      </section>

      <section className="panel panel-pad stack" style={{ gap: 10 }}>
        <div className="row between">
          <div className="eyebrow">Payment schedule</div>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setSchedule([...DEFAULT_SCHEDULE])}>
            Reset to 40 / 40 / 20
          </button>
        </div>
        {schedule.map((s, i) => (
          <div className="pstage" key={i}>
            <input className="input" aria-label={`Stage ${i + 1} label`} value={s.label} maxLength={80} onChange={(e) => setStage(i, { label: e.currentTarget.value })} />
            <input
              className="input pline-qty"
              aria-label={`Stage ${i + 1} percent`}
              type="number"
              min={1}
              max={100}
              value={Number.isFinite(s.pct) ? s.pct : ""}
              onChange={(e) => setStage(i, { pct: Math.floor(Number(e.currentTarget.value)) })}
            />
            <span className="c-3 t-12">%</span>
            <span className="pline-price">{amounts ? <Money value={amounts[i]} currency="USD" /> : <span className="c-3">–</span>}</span>
            <button
              className="btn btn-ghost btn-icon btn-sm"
              type="button"
              aria-label="Remove stage"
              disabled={schedule.length <= 1}
              onClick={() => setSchedule((ss) => ss.filter((_, j) => j !== i))}
            >
              <Icon name="trash" className="i-sm" />
            </button>
          </div>
        ))}
        <div className="row between">
          <button className="btn btn-secondary btn-sm" type="button" disabled={schedule.length >= 6} onClick={() => setSchedule((ss) => [...ss, { label: "Milestone", pct: 0 }])}>
            <Icon name="plus" className="i-sm" />
            Add stage
          </button>
          <span className={`t-12 ${schedErr ? "c-bad" : "c-3"}`}>{schedErr ?? `Adds up to ${sum}%. The first stage is the deposit invoice.`}</span>
        </div>
      </section>

      <section className="panel panel-pad stack" style={{ gap: 14 }}>
        <div className="eyebrow">Proposal text</div>
        <div className="field">
          <label className="label" htmlFor="scope_md">
            Scope
          </label>
          <textarea className="textarea mono-ish" id="scope_md" name="scope_md" defaultValue={initial.scope_md} maxLength={20000} rows={12} />
          <span className="hint">
            Opening paragraph, then <code>## Item</code> + a paragraph per scope card, <code>&gt; Not included…</code> for the amber note, and{" "}
            <code>- item</code> lines for the &ldquo;From you&rdquo; checklist. <code>**bold**</code> works.
          </span>
        </div>
        <div className="field">
          <label className="label" htmlFor="timeline_md">
            Timeline
          </label>
          <textarea className="textarea mono-ish" id="timeline_md" name="timeline_md" defaultValue={initial.timeline_md} maxLength={20000} rows={8} />
          <span className="hint">
            <code>## Week 1 · Survey and sensor plan</code>, then a line of detail, then <code>&gt; Milestone 1 · …</code> for a milestone pill.
          </span>
        </div>
        {showChanges && (
          <div className="field">
            <label className="label" htmlFor="changes_md">
              Changes since the previous version
            </label>
            <textarea className="textarea" id="changes_md" name="changes_md" defaultValue={initial.changes_md} maxLength={4000} rows={3} />
          </div>
        )}
      </section>

      {state?.error && (
        <p className="auth-error" role="alert">
          <Icon name="alert" className="i-sm" />
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p className="ok-note" role="status">
          <Icon name="check" className="i-sm" />
          {state.ok}
        </p>
      )}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-primary btn-lg" type="submit" disabled={pending || !!schedErr}>
          {pending ? (
            <>
              <span className="spinner" />
              Saving
            </>
          ) : (
            submitLabel
          )}
        </button>
      </div>
    </form>
  );
}
