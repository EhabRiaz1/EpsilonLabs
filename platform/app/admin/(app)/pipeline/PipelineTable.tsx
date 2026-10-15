"use client";

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Tabs } from "@/app/components/Tabs";
import { Icon } from "@/app/components/Icon";
import { Money } from "@/app/components/Money";
import { Empty } from "@/app/components/Empty";
import { usePageCommands } from "@/app/components/AdminPalette";
import { ageText, ageTone, CHANNELS, CH_LABEL, STAGES, STAGE_LABEL, stageFlex, stageTone, STALE_BAD, STALE_WARN } from "@/lib/deals";
import { DealSheet, type DealDetail } from "./DealSheet";

export type DealRow = {
  id: string; company: string; place: string; title: string; stage: string; group: string; channel: string; strategy: string; contact: string;
  value: number | null; age: number; touchedAt: string; rank: number; next: { lead: string | null; rest: string };
};

const PAGE = 40;
const usdShort = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`);

/** The Pipeline table (D7): stage tabs + search + channel, the 6-segment stage bar, the KPI row, then the deals sorted
 *  by needs a touch, 40 at a time. A row opens the deal sheet (D3); J/K move to the next deal without closing it. */
export function PipelineTable({ rows, initialChannel, selected, detail, kpis }: { rows: DealRow[]; initialChannel: string; selected: string | null; detail: DealDetail | null; kpis: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [stage, setStage] = useState("all");
  const [channel, setChannel] = useState(initialChannel);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [want, setWant] = useState<string | null>(selected);
  const [pending, start] = useTransition();
  const search = useRef<HTMLInputElement>(null);

  // a back / forward navigation (or the server catching up) changes ?deal= under us
  const [seen, setSeen] = useState(selected);
  if (seen !== selected) {
    setSeen(selected);
    setWant(selected);
  }

  const byChannel = useMemo(() => (channel ? rows.filter((r) => r.channel === channel) : rows), [rows, channel]);
  const counts = useMemo(() => {
    const m = new Map<string, { n: number; usd: number }>();
    for (const r of byChannel) {
      const c = m.get(r.group) ?? { n: 0, usd: 0 };
      c.n += 1;
      c.usd += r.value ?? 0;
      m.set(r.group, c);
    }
    return m;
  }, [byChannel]);
  const needle = q.trim().toLowerCase();
  const visible = useMemo(
    () =>
      byChannel.filter(
        (r) =>
          (stage === "all" || r.group === stage) &&
          (!needle || `${r.company} ${r.title} ${r.contact} ${r.strategy} ${r.place}`.toLowerCase().includes(needle)),
      ),
    [byChannel, stage, needle],
  );
  const page = visible.slice(0, shown);

  function go(id: string | null) {
    setWant(id);
    const u = new URLSearchParams();
    if (channel) u.set("channel", channel);
    if (id) u.set("deal", id);
    const s = u.toString();
    start(() => router.replace(s ? `${path}?${s}` : path, { scroll: false }));
  }
  function step(d: 1 | -1) {
    if (!visible.length) return;
    const i = want ? visible.findIndex((r) => r.id === want) : -1;
    const next = visible[Math.max(0, Math.min(visible.length - 1, i < 0 ? 0 : i + d))];
    if (!next || next.id === want) return;
    const at = visible.indexOf(next);
    if (at >= shown) setShown(Math.ceil((at + 1) / PAGE) * PAGE);
    go(next.id);
    requestAnimationFrame(() => document.getElementById(`deal-${next.id}`)?.scrollIntoView({ block: "nearest" }));
  }

  usePageCommands(
    "Pipeline",
    [
      { label: "Next deal", icon: "chevD", keys: "J", bind: "j", run: () => step(1) },
      { label: "Previous deal", icon: "chevD", keys: "K", bind: "k", run: () => step(-1) },
      { label: "Search deals", icon: "search", keys: "/", bind: "/", run: () => search.current?.focus() },
    ],
    "pipeline",
  );

  const tabs = [
    { key: "all", label: "All", count: byChannel.length },
    ...STAGES.map(([k, l]) => ({ key: k, label: l, count: counts.get(k)?.n ?? 0 })),
  ];

  return (
    <>
      <div className="ptools">
        <Tabs label="Stage" items={tabs} value={stage} onChange={(k) => { setStage(k); setShown(PAGE); }} className="scroll-x" />
        <div className="ptools-r">
          <label className="select-t">
            <span className="sr-only">Channel</span>
            <select className="select select-sm" value={channel} onChange={(e) => { setChannel(e.target.value); setShown(PAGE); }}>
              <option value="">All channels</option>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>{CH_LABEL[c]}</option>
              ))}
            </select>
          </label>
          <label className="search-t">
            <Icon name="search" className="i-sm" />
            <span className="sr-only">Search deals</span>
            <input ref={search} type="search" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} placeholder="Company, contact, strategy" onKeyDown={(e) => e.key === "Escape" && (e.currentTarget.blur(), setQ(""))} />
            {!q && <span className="kbd" aria-hidden="true">/</span>}
          </label>
        </div>
      </div>

      <div className="stagebar" role="img" aria-label={`Deals per stage: ${STAGES.map(([k, l]) => `${l} ${counts.get(k)?.n ?? 0}`).join(", ")}`}>
        {STAGES.map(([k, l]) => {
          const c = counts.get(k) ?? { n: 0, usd: 0 };
          return (
            <span key={k} className={stage === k ? "on" : undefined} style={{ flex: stageFlex(c.n) }}>
              {k === "quote_out" ? "Quote" : l} <b>{c.n}</b>
              {k === "quote_out" && c.usd > 0 ? ` · ${usdShort(c.usd)}` : ""}
            </span>
          );
        })}
      </div>

      {kpis}

      <section className="panel ptable-wrap" aria-label="Deals" aria-busy={pending || undefined}>
        {page.length === 0 ? (
          <Empty variant="inline" action={needle || channel ? <button type="button" className="link-btn" onClick={() => { setQ(""); setChannel(""); }}>Clear filters</button> : undefined}>
            {needle ? `No deal matches “${q.trim()}”` : stage === "all" ? "No deals yet. The prospector adds leads every morning." : `No deals in ${STAGES.find(([k]) => k === stage)?.[1] ?? stage}`}
          </Empty>
        ) : (
          <div className="ptable-scroll">
            <table className="ptable">
              <colgroup>
                <col className="c-co" />
                <col className="c-st" />
                <col className="c-sg" />
                <col className="c-age" />
                <col />
                <col className="c-amt" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Stage</th>
                  <th scope="col">Strategy</th>
                  <th scope="col">Last touch</th>
                  <th scope="col" className="sorted">Next step</th>
                  <th scope="col" className="amt">Value</th>
                </tr>
              </thead>
              <tbody>
                {page.map((r) => (
                  <tr key={r.id} id={`deal-${r.id}`} aria-selected={r.id === want ? true : undefined} onClick={() => go(r.id)}>
                    <td className="co">
                      <button type="button" className="row-btn" onClick={(e) => { e.stopPropagation(); go(r.id); }} aria-haspopup="dialog">
                        {r.company}
                      </button>
                      {r.place && <small>{r.place}</small>}
                    </td>
                    <td>
                      <span className={`pill ${stageTone(r.stage)}`}>
                        <span className="dot" />
                        {STAGE_LABEL[r.stage] ?? r.stage}
                      </span>
                    </td>
                    <td>
                      <span className="chip-m">{r.strategy}</span>
                    </td>
                    <td>
                      <span className={`age ${ageTone(r.age, r.stage)}`}>{ageText(r.age)}</span>
                    </td>
                    <td className="nx">
                      {r.next.lead && <b>{r.next.lead}</b>}
                      {r.next.lead && r.next.rest ? " · " : ""}
                      {r.next.rest}
                    </td>
                    <td className="amt">{r.value != null ? <Money value={r.value} currency="USD" /> : <span className="c-3">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pfoot">
          <span>
            {Math.min(shown, visible.length)} of {visible.length} · stale: <span className="c-warn">≥ {STALE_WARN} d</span> · <span className="c-bad">≥ {STALE_BAD} d</span>
          </span>
          {visible.length > shown && (
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, visible.length - shown)} more
            </button>
          )}
        </div>
      </section>

      <DealSheet want={want} detail={detail} pending={pending} onClose={() => go(null)} onStep={step} />
    </>
  );
}
