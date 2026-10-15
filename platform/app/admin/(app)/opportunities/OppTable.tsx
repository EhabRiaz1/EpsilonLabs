"use client";

import { Fragment, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Tabs } from "@/app/components/Tabs";
import { Icon } from "@/app/components/Icon";
import { Empty } from "@/app/components/Empty";
import { Sheet, closeSheet, openSheet } from "@/app/components/Sheet";
import { ask } from "@/app/components/Confirm";
import { eps } from "@/app/components/eps";
import { usePageCommands } from "@/app/components/AdminPalette";
import { esc } from "@/lib/html";
import { OppActions } from "./OppActions";
import { passOpportunities } from "./actions";

export type OppTab = "new" | "watching" | "bidding" | "passed" | "closed";
export type OppRow = {
  id: string; title: string; buyer: string; country: string; source: string; value: string; deadline: string; tone: "" | "amber" | "red";
  score: number; elig: string; status: string; tab: OppTab; reasons: string[]; eligNotes: string[]; url: string; decided: string;
};
type Detail = { id: string; title: string; sub: string; url: string; body: ReactNode };

const PAGE = 50;
const UNDO_SECONDS = 8;
const SHEET = "opp-sheet";
const TONE: Record<string, string> = { red: "c-bad", amber: "c-warn", "": "" };
const ELIG: Record<string, [string, string]> = { ok: ["Eligible", "pill-good"], flag: ["Check", "pill-warn"], exclude: ["Ineligible", "pill-bad"] };
const TAB_LABEL: [OppTab, string][] = [["new", "New"], ["watching", "Watching"], ["bidding", "Bidding"], ["passed", "Passed"], ["closed", "Closed"]];
const EMPTY: Record<OppTab, string> = {
  new: "No new tenders. The scan runs daily at 06:00 PKT.",
  watching: "Nothing submitted and waiting on a buyer.",
  bidding: "Nothing being bid on.",
  passed: "Nothing passed yet.",
  closed: "No won, lost or expired tenders yet.",
};

/** Opportunities triage (Phase 2): eligible first, fit meter, deadline days tinted. Rows expand inline with the
 *  decision buttons; Details opens the full notice in a sheet. "Pass all ineligible" asks first, then gives 8 s to undo
 *  before anything is written (the RPC can't move a pass back to new, so Undo never reaches the server). */
export function OppTable({ rows, passedTotal, initialTab, selected, detail, detailMissing }: {
  rows: OppRow[]; passedTotal: number; initialTab: OppTab; selected: string | null; detail: Detail | null; detailMissing: boolean;
}) {
  const router = useRouter();
  const path = usePathname();
  const [tab, setTab] = useState<OppTab>(initialTab);
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [want, setWant] = useState<string | null>(selected);
  const [pending, start] = useTransition();

  const [seen, setSeen] = useState(selected);
  if (seen !== selected) {
    setSeen(selected);
    setWant(selected);
  }
  useEffect(() => {
    const el = document.getElementById(SHEET);
    const isOpen = Boolean(el?.hasAttribute("data-open"));
    if (want && !isOpen) openSheet(SHEET);
    if (!want && isOpen) closeSheet(SHEET);
  }, [want]);

  const live = useMemo(() => rows.filter((r) => !hidden.has(r.id)), [rows, hidden]);
  const list = useMemo(() => live.filter((r) => r.tab === tab), [live, tab]);
  const count = (t: OppTab) => (t === "passed" ? Math.max(passedTotal, 0) + (rows.length - live.length) : live.filter((r) => r.tab === t).length);
  const ineligible = useMemo(() => live.filter((r) => r.tab === "new" && r.elig === "exclude"), [live]);
  const page = list.slice(0, shown);

  function show(id: string | null) {
    setWant(id);
    const u = id ? `${path}?id=${id}` : path;
    start(() => router.replace(u, { scroll: false }));
  }

  async function passIneligible() {
    const ids = ineligible.map((r) => r.id);
    if (!ids.length) return;
    const ok = await ask({
      title: `Pass ${ids.length} ineligible tender${ids.length === 1 ? "" : "s"}?`,
      body: (
        <p>
          They move to Passed. Nothing is sent to anyone. You get {UNDO_SECONDS} seconds to undo before it&apos;s saved.
        </p>
      ),
      confirm: `Pass ${ids.length}`,
      tone: "danger",
      icon: "x",
    });
    if (!ok) return;
    setHidden((h) => new Set([...h, ...ids]));
    setOpen(null);
    const unhide = () =>
      setHidden((h) => {
        const n = new Set(h);
        ids.forEach((x) => n.delete(x));
        return n;
      });
    const e = eps();
    const commit = async () => {
      let r: Awaited<ReturnType<typeof passOpportunities>>;
      try {
        r = await passOpportunities(ids);
      } catch {
        r = { ok: false, passed: 0, failed: ids.length, message: "Couldn't reach admin. Nothing was changed." };
      }
      if (!r.ok) {
        unhide();
        eps()?.toast(esc(r.message), { icon: "alert" });
      }
      router.refresh();
    };
    if (!e) return void commit();
    e.toast(esc(`Passed ${ids.length} ineligible`), {
      icon: "check",
      seconds: UNDO_SECONDS,
      action: "Undo",
      onUndo: () => {
        unhide();
        eps()?.toast("Back in New", { icon: "undo" });
      },
      onCommit: () => void commit(),
    });
  }

  usePageCommands(
    "Opportunities",
    [
      ...TAB_LABEL.map(([k, l]) => ({ label: `Show ${l}`, icon: "layers", run: () => setTab(k) })),
      { label: "Pass all ineligible", icon: "x", run: () => void passIneligible() },
    ],
    "opps",
  );

  return (
    <>
      <div className="ptools">
        <Tabs
          label="Tenders"
          className="scroll-x"
          value={tab}
          onChange={(k) => {
            setTab(k as OppTab);
            setShown(PAGE);
            setOpen(null);
          }}
          items={TAB_LABEL.map(([k, l]) => ({ key: k, label: l, count: count(k) }))}
        />
        {tab === "new" && ineligible.length > 0 && (
          <button className="btn btn-secondary btn-sm ptools-r" type="button" onClick={() => void passIneligible()}>
            <Icon name="x" className="i-sm" />
            Pass all ineligible · {ineligible.length}
          </button>
        )}
      </div>

      <section className="panel ptable-wrap" aria-label="Tenders">
        {page.length === 0 ? (
          <Empty variant="inline">{EMPTY[tab]}</Empty>
        ) : (
          <div className="ptable-scroll">
            <table className="ptable otable">
              <colgroup>
                <col className="c-fit" />
                <col />
                <col className="c-el" />
                <col className="c-dl" />
                <col className="c-val" />
                <col className="c-src" />
                <col className="c-cty" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Fit</th>
                  <th scope="col">Tender</th>
                  <th scope="col" className={tab === "new" ? "sorted" : undefined}>Eligibility</th>
                  <th scope="col">Deadline</th>
                  <th scope="col" className="amt">Value</th>
                  <th scope="col" className="hide-m">Source</th>
                  <th scope="col" className="hide-m">Country</th>
                </tr>
              </thead>
              <tbody>
                {page.map((r) => {
                  const el = ELIG[r.elig] ?? ELIG.ok;
                  const isOpen = open === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr aria-selected={r.id === want || isOpen ? true : undefined} onClick={() => setOpen(isOpen ? null : r.id)} className={r.elig === "exclude" ? "dim" : undefined}>
                        <td>
                          <span className="fit" aria-label={`Fit ${r.score} of 100`}>
                            <span className="meter-t">
                              <i style={{ width: `${Math.max(0, Math.min(100, r.score))}%` }} data-tone={r.score >= 60 ? "hi" : r.score < 40 ? "lo" : undefined} />
                            </span>
                            <b>{r.score}</b>
                          </span>
                        </td>
                        <td className="co">
                          <button
                            type="button"
                            className="row-btn"
                            aria-expanded={isOpen}
                            aria-controls={`opp-x-${r.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpen(isOpen ? null : r.id);
                            }}
                          >
                            {r.title}
                          </button>
                          {r.buyer && <small>{r.buyer}</small>}
                        </td>
                        <td>
                          <span className={`pill ${el[1]}`}>
                            <span className="dot" />
                            {el[0]}
                          </span>
                        </td>
                        <td>
                          <span className={`age ${TONE[r.tone] ?? ""}`}>{tab === "passed" || tab === "closed" ? (r.decided ? `${r.status} ${r.decided}` : r.status) : r.deadline}</span>
                        </td>
                        <td className="amt">{r.value === "Not stated" ? <span className="c-3">–</span> : r.value}</td>
                        <td className="hide-m c-2">{r.source}</td>
                        <td className="hide-m c-2">{r.country || "–"}</td>
                      </tr>
                      {isOpen && (
                        <tr className="x-row" id={`opp-x-${r.id}`}>
                          <td colSpan={7}>
                            <div className="x-body">
                              <div className="x-why">
                                {r.reasons.length > 0 ? (
                                  <ul className="bullets">
                                    {r.reasons.map((x, k) => (
                                      <li key={k}>{x}</li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="c-3 t-13">No fit reasons recorded.</p>
                                )}
                                {r.eligNotes.length > 0 && <p className="c-warn t-12">{r.eligNotes.join(" · ")}</p>}
                              </div>
                              <div className="x-acts">
                                <OppActions id={r.id} status={r.status} />
                                <div className="row x-links">
                                  {r.status === "new" && (
                                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => setOpen(null)} title="Keeps it in New">
                                      <Icon name="clock" className="i-sm" />
                                      Later
                                    </button>
                                  )}
                                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => show(r.id)} aria-haspopup="dialog">
                                    <Icon name="eye" className="i-sm" />
                                    Details
                                  </button>
                                  {r.url && (
                                    <a className="btn btn-ghost btn-sm" href={r.url} target="_blank" rel="noopener noreferrer nofollow">
                                      <Icon name="external" className="i-sm" />
                                      Notice
                                    </a>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="pfoot">
          <span>
            {Math.min(shown, list.length)} of {list.length}
            {tab === "new" ? " · eligible first, then fit, then deadline" : ""}
          </span>
          {list.length > shown && (
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, list.length - shown)} more
            </button>
          )}
        </div>
      </section>

      <Sheet
        id={SHEET}
        wide
        onClose={() => want && show(null)}
        title={detail && detail.id === want ? detail.title : "Tender"}
        sub={detail && detail.id === want ? detail.sub : undefined}
        footer={
          detail && detail.id === want && detail.url ? (
            <a className="btn btn-secondary" href={detail.url} target="_blank" rel="noopener noreferrer nofollow">
              <Icon name="external" className="i-sm" />
              Open the notice
            </a>
          ) : undefined
        }
      >
        {detail && detail.id === want ? (
          <div className={`opp-detail${pending ? " is-pending" : ""}`}>{detail.body}</div>
        ) : detailMissing && !pending ? (
          <Empty variant="inline">This tender isn&apos;t there any more.</Empty>
        ) : (
          <div className="deal-skel" aria-busy="true">
            <span className="sr-only">Loading the tender…</span>
            <div className="skel line w-70" />
            <div className="skel line w-50" />
            <div className="skel line w-60" />
          </div>
        )}
      </Sheet>
    </>
  );
}
