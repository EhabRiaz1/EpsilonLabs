"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Sheet, closeSheet, openSheet } from "@/app/components/Sheet";
import { Icon } from "@/app/components/Icon";
import { Money } from "@/app/components/Money";
import { Note } from "@/app/components/Note";
import { dayMonth, stamp } from "@/lib/dates";
import { STAGE_LABEL, STAGE_STEPS, stageTone } from "@/lib/deals";

export type DealDetail = {
  id: string; title: string; stage: string; channel: string; strategy: string | null; value: number | null; opened: string;
  quotedAt: string | null; closedAt: string | null; lostReason: string | null; draftWaiting: boolean;
  next: { lead: string | null; rest: string };
  company: { name: string; domain: string | null; country: string | null; sector: string | null };
  contacts: { full_name: string | null; email: string | null; role: string | null; opted_out: boolean | null }[];
  touches: { id: string; type: string; direction: string; subject: string | null; body_excerpt: string | null; occurred_at: string }[];
  error: boolean;
};

const ID = "deal-sheet";
const isOpen = () => Boolean(document.getElementById(ID)?.hasAttribute("data-open"));

/** The deal slide-over (D3; replaces the old .deal-panel): next step, facts, the stage, contacts and the last touches.
 *  Esc or the scrim closes it; J/K (wired by PipelineTable) swap the deal without closing. Stage changes stay on the Mac
 *  cockpit: no admin RPC moves a deal, so the stage strip shows where the deal is. */
export function DealSheet({ want, detail, pending, onClose, onStep }: { want: string | null; detail: DealDetail | null; pending: boolean; onClose: () => void; onStep: (d: 1 | -1) => void }) {
  useEffect(() => {
    if (want && !isOpen()) openSheet(ID);
    if (!want && isOpen()) closeSheet(ID);
  }, [want]);

  const d = detail && detail.id === want ? detail : null;
  const lead = d?.contacts.find((c) => !c.opted_out) ?? d?.contacts[0];
  const stageAt = d ? STAGE_STEPS.findIndex(([k]) => k === d.stage) : -1;

  return (
    <Sheet
      id={ID}
      wide
      onClose={() => want && onClose()}
      title={d ? d.company.name : "Deal"}
      sub={
        d ? (
          <span className="deal-m">
            <span className={`pill ${stageTone(d.stage)}`}>
              <span className="dot" />
              {STAGE_LABEL[d.stage] ?? d.stage}
            </span>
            {lead && <span>{[lead.full_name || lead.email, lead.role].filter(Boolean).join(" · ")}</span>}
            {d.company.country && <span>· {d.company.country}</span>}
          </span>
        ) : undefined
      }
      note={d?.error ? <Note tone="error" retry>Part of this deal didn&apos;t load.</Note> : undefined}
      footer={
        <div className="row deal-foot">
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => onStep(-1)} aria-label="Previous deal (K)">
            <Icon name="chevL" className="i-sm" />
            <span className="kbd">K</span>
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => onStep(1)} aria-label="Next deal (J)">
            <span className="kbd">J</span>
            <Icon name="chevR" className="i-sm" />
          </button>
          <span className="grow" />
          {d && (
            <Link className="btn btn-secondary" href={`/proposals/new?deal=${d.id}`}>
              <Icon name="file" className="i-sm" />
              New proposal
            </Link>
          )}
          {d?.draftWaiting && (
            <Link className="btn btn-primary" href="/approvals">
              <Icon name="inbox" className="i-sm" />
              Open draft
            </Link>
          )}
        </div>
      }
    >
      {!d ? (
        <div className="deal-skel" aria-busy="true">
          <span className="sr-only">Loading the deal…</span>
          <div className="skel line w-70" />
          <div className="skel line w-50" />
          <div className="skel line w-60" />
          <div className="skel line w-40" />
        </div>
      ) : (
        <div className={`deal-body${pending ? " is-pending" : ""}`}>
          <div className="next">
            <span className="tag">Next step · {d.next.lead ? "you" : "waiting"}</span>
            {d.next.lead && <b>{d.next.lead}</b>}
            {d.next.lead && d.next.rest ? " · " : ""}
            {d.draftWaiting ? (
              <Link className="c-accent" href="/approvals">
                {d.next.rest}
              </Link>
            ) : (
              d.next.rest
            )}
          </div>

          <dl className="kv">
            <dt>Deal</dt>
            <dd>{d.title}</dd>
            {d.strategy && (
              <>
                <dt>Strategy</dt>
                <dd>{d.strategy}</dd>
              </>
            )}
            <dt>Channel</dt>
            <dd>{d.channel}</dd>
            <dt>Value</dt>
            <dd className="mono">{d.value != null ? <Money value={d.value} currency="USD" /> : "–"}</dd>
            <dt>Opened</dt>
            <dd className="mono">{stamp(d.opened)}</dd>
            {d.quotedAt && (
              <>
                <dt>Quoted</dt>
                <dd className="mono">{dayMonth(d.quotedAt)}</dd>
              </>
            )}
            {d.closedAt && (
              <>
                <dt>Closed</dt>
                <dd className="mono">
                  {dayMonth(d.closedAt)}
                  {d.lostReason ? ` · ${d.lostReason}` : ""}
                </dd>
              </>
            )}
            {d.company.domain && (
              <>
                <dt>Domain</dt>
                <dd className="mono">{d.company.domain}</dd>
              </>
            )}
            {d.company.country && (
              <>
                <dt>Country</dt>
                <dd>{d.company.country}</dd>
              </>
            )}
            {d.company.sector && (
              <>
                <dt>Sector</dt>
                <dd>{d.company.sector}</dd>
              </>
            )}
          </dl>

          <div>
            <div className="label sheet-label">Stage</div>
            <ol className="seg seg-block stage-strip" aria-label="Stage">
              {STAGE_STEPS.map(([k, l], i) => (
                <li key={k} aria-current={k === d.stage ? "step" : undefined} className={stageAt >= 0 && i < stageAt ? "past" : undefined}>
                  {k === "won" && (d.stage === "lost" || d.stage === "dormant") ? STAGE_LABEL[d.stage] : l}
                </li>
              ))}
            </ol>
            <p className="hint sheet-hint">Stage changes are made on the Mac cockpit; this shows where the deal is.</p>
          </div>

          <div>
            <div className="label sheet-label">Contacts</div>
            {d.contacts.length ? (
              <ul className="ppl ppl-flat">
                {d.contacts.map((c, k) => (
                  <li key={k}>
                    <span>
                      <div className="t">
                        {c.full_name || c.email}
                        {c.role ? <span className="c-3"> · {c.role}</span> : null}
                      </div>
                      <div className="m">
                        {c.email}
                        {c.opted_out ? " · opted out" : ""}
                      </div>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="c-3 t-13">None on file.</p>
            )}
          </div>

          <div>
            <div className="label sheet-label">Touches</div>
            {d.touches.length ? (
              <ul className="tl">
                {d.touches.map((t) => (
                  <li key={t.id} data-kind={t.direction === "inbound" ? "client" : "internal"}>
                    <span className="tl-dot" />
                    <div className="tl-title">{t.subject || t.type.replace(/_/g, " ")}</div>
                    <div className="tl-meta">
                      {t.direction} · {t.type.replace(/_/g, " ")} · {stamp(t.occurred_at)}
                    </div>
                    {t.body_excerpt &&
                      (t.direction === "inbound" ? (
                        <div className="untrusted tl-x">
                          <div className="untrusted-tag">
                            <Icon name="alert" className="i-sm" />
                            They wrote · untrusted
                          </div>
                          <div className="pre t-13">{t.body_excerpt.slice(0, 600)}</div>
                        </div>
                      ) : (
                        <div className="pre t-13 c-2 tl-x">{t.body_excerpt.slice(0, 600)}</div>
                      ))}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="c-3 t-13">No touches yet.</p>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}
