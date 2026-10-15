"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/app/components/Icon";
import type { IconName } from "@/app/components/icons";
import { Empty } from "@/app/components/Empty";

export type ActKind = "ticket" | "report" | "update" | "invoice";
export type ActItem = {
  key: string; kind: ActKind; at: string; date: string; id?: string; title: string; meta: string; href?: string;
  pill?: { label: string; tone: string; live?: boolean }; tag?: string;
};

const FILTERS: [ActKind | "all", string][] = [["all", "All"], ["ticket", "Tickets"], ["report", "Reports"], ["update", "Updates"], ["invoice", "Invoices"]];
const ICON: Record<ActKind, IconName> = { ticket: "ticket", report: "chart", update: "send", invoice: "receipt" };
const EMPTY: Record<ActKind | "all", string> = {
  all: "Nothing has happened here yet",
  ticket: "No tickets yet",
  report: "No reports yet",
  update: "No updates yet",
  invoice: "No invoices yet",
};

/** The client page's Activity timeline (D15): tickets, reports, updates and invoices for one organisation, newest
 *  first, with filter chips. */
export function Activity({ items, limit = 30 }: { items: ActItem[]; limit?: number }) {
  const [f, setF] = useState<ActKind | "all">("all");
  const list = (f === "all" ? items : items.filter((i) => i.kind === f)).slice(0, limit);
  return (
    <section className="panel" aria-label="Activity">
      <div className="ph">
        <h2>Activity</h2>
        <span className="c-3">newest first</span>
        <div className="fchips" role="group" aria-label="Filter activity">
          {FILTERS.map(([k, l]) => (
            <button key={k} type="button" aria-pressed={f === k} onClick={() => setF(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {list.length === 0 ? (
        <Empty variant="inline">{EMPTY[f]}</Empty>
      ) : (
        <ul className="act">
          {list.map((i) => {
            const body = (
              <>
                <span className="dt">{i.date}</span>
                <span className="ic" aria-hidden="true">
                  <Icon name={ICON[i.kind]} className="i-sm" />
                </span>
                <span className="act-main">
                  <div className="t">
                    {i.id && <span className="id">{i.id}</span>}
                    {i.title}
                  </div>
                  <div className="m">{i.meta}</div>
                </span>
                <span className="r">
                  {i.pill ? (
                    <span className={`pill ${i.pill.tone}`}>
                      <span className={`dot${i.pill.live ? " live" : ""}`} />
                      {i.pill.label}
                    </span>
                  ) : i.tag ? (
                    <span className="c-3 t-12 mono">{i.tag}</span>
                  ) : null}
                </span>
              </>
            );
            return <li key={i.key}>{i.href ? <Link href={i.href}>{body}</Link> : <div>{body}</div>}</li>;
          })}
        </ul>
      )}
    </section>
  );
}
