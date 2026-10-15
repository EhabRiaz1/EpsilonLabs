"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/app/components/Icon";
import { Sheet, openSheet } from "@/app/components/Sheet";
import { Tabs } from "@/app/components/Tabs";
import { Note } from "@/app/components/Note";
import { Empty } from "@/app/components/Empty";
import { AUDIT_PAGE } from "@/lib/health";
import { loadAudit, type AuditQuery, type AuditResult } from "./actions";

const SHEET = "audit-log";

/** The "Audit log" header button of Health. */
export function AuditButton() {
  return (
    <button className="btn btn-secondary btn-sm" type="button" onClick={() => openSheet(SHEET)}>
      <Icon name="activity" className="i-sm" />
      Audit log
    </button>
  );
}

const time = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Karachi" }).format(new Date(iso));

/** The audit log (actions table) in a Sheet: actor and kind filters, last 24 h / 7 days, 30 rows a page. The first
 *  page (24 h, everything) comes from the server render; the rest is read through loadAudit. */
export function AuditSheet({ initial, actors, kinds }: { initial: AuditResult; actors: string[]; kinds: string[] }) {
  const [q, setQ] = useState<AuditQuery>({ agent: "", action: "", window: "24h", page: 0 });
  const [res, setRes] = useState<AuditResult>(initial);
  const [pending, start] = useTransition();

  function load(next: AuditQuery) {
    setQ(next);
    start(async () => {
      try {
        setRes(await loadAudit(next));
      } catch {
        setRes({ rows: [], more: false, error: "Couldn't reach admin. Try again." });
      }
    });
  }
  const first = q.page * AUDIT_PAGE + 1;

  return (
    <Sheet
      id={SHEET}
      wide
      title="Audit log"
      sub="Every agent and staff action, newest first (PKT)."
      note={res.error ? <Note tone="error">{res.error}</Note> : null}
      footer={
        <div className="row audit-pager">
          <span className="c-3 t-12 mono">{res.rows.length ? `${first}–${first + res.rows.length - 1}` : "0"}</span>
          <button className="btn btn-secondary btn-sm" type="button" disabled={pending || q.page === 0} onClick={() => load({ ...q, page: q.page - 1 })}>
            Newer
          </button>
          <button className="btn btn-secondary btn-sm" type="button" disabled={pending || !res.more} onClick={() => load({ ...q, page: q.page + 1 })}>
            Older
          </button>
        </div>
      }
    >
      <div className="audit-filters">
        <label className="field">
          <span className="label">Actor</span>
          <select className="select" value={q.agent} onChange={(e) => load({ ...q, agent: e.target.value, page: 0 })}>
            <option value="">Everyone</option>
            {actors.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Kind</span>
          <select className="select" value={q.action} onChange={(e) => load({ ...q, action: e.target.value, page: 0 })}>
            <option value="">All kinds</option>
            {kinds.map((k) => (
              <option key={k} value={k}>{k.replace(/_/g, " ")}</option>
            ))}
          </select>
        </label>
        <Tabs
          label="Window"
          value={q.window}
          onChange={(w) => load({ ...q, window: w as AuditQuery["window"], page: 0 })}
          items={[
            { key: "24h", label: "Last 24 h" },
            { key: "7d", label: "Last 7 days" },
          ]}
        />
      </div>
      <div className={`list-rows audit-rows${pending ? " is-loading" : ""}`} aria-busy={pending}>
        {res.rows.map((a) => (
          <div key={a.id} className="t-12">
            <span className="pill pill-mono">{a.agent}</span>
            <span className="grow truncate">
              {a.action.replace(/_/g, " ")}
              {a.target_table ? <span className="c-3"> · {a.target_table}</span> : null}
            </span>
            <span className="c-3 mono nowrap">
              {a.cost_usd ? `$${Number(a.cost_usd).toFixed(3)} · ` : ""}
              {time(a.at)}
            </span>
          </div>
        ))}
      </div>
      {!res.rows.length && !res.error && <Empty variant="inline">Nothing logged {q.window === "7d" ? "in the last 7 days" : "in the last 24 h"} for this filter.</Empty>}
    </Sheet>
  );
}
