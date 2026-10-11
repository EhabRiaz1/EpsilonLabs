"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import { StatusControl } from "./TicketControls";

export type QueueRow = {
  id: string;
  ref: string;
  title: string;
  meta: string;
  urgent: boolean;
  client: string;
  status: { label: string; tone: string; raw: string };
  when: string;
  body: string;
  fields: [string, string][];
};

/** Queue rows that expand inline (admin-queue.html), with J/K to move and Enter to open. */
export function TicketQueue({ rows }: { rows: QueueRow[] }) {
  const router = useRouter();
  const [sel, setSel] = useState(0);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && t.closest("input, textarea, select"))) return;
      if (document.querySelector(".sheet[data-open], .cmdk[data-open]")) return;
      if (e.key === "j" || e.key === "ArrowDown") setSel((s) => Math.min(rows.length - 1, s + 1));
      else if (e.key === "k" || e.key === "ArrowUp") setSel((s) => Math.max(0, s - 1));
      else if (e.key === "o" && rows[sel]) router.push(`/tickets/${rows[sel].id}`);
      else return;
      e.preventDefault();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [rows, sel, router]);

  return (
    <table className="table">
      <thead>
        <tr>
          <th style={{ width: 52 }} aria-label="Kind" />
          <th>Ticket</th>
          <th className="hide-m">Client</th>
          <th>Status</th>
          <th className="hide-m" style={{ textAlign: "right" }}>
            Updated
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const open = i === sel;
          return (
            <Fragment key={r.id}>
              <tr className="rowx q-row" aria-expanded={open} tabIndex={0} onClick={() => setSel(open ? -1 : i)} onKeyDown={(e) => { if (e.key === "Enter") router.push(`/tickets/${r.id}`); }}>
                <td>
                  <span className="ic">
                    <Icon name={r.urgent ? "alert" : "ticket"} />
                  </span>
                </td>
                <td>
                  <div className="t">{r.title}</div>
                  <div className="m">
                    {r.meta}
                    {r.urgent && <span className="c-bad"> · urgent</span>}
                  </div>
                </td>
                <td className="hide-m c-2">{r.client}</td>
                <td>
                  <span className={`pill ${r.status.tone}`}>
                    <span className="dot" />
                    {r.status.label}
                  </span>
                </td>
                <td className="hide-m tm">{r.when}</td>
              </tr>
              <tr className="detail">
                <td colSpan={5}>
                  <div className="collapse" data-open={open ? "" : undefined}>
                    <div>
                      <div className="detail-body" inert={!open}>
                        <div>
                          <div className="untrusted">
                            <div className="untrusted-tag">
                              <Icon name="alert" className="i-sm" />
                              Client wrote · untrusted
                            </div>
                            <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{r.body ? (r.body.length > 600 ? `${r.body.slice(0, 600)}…` : r.body) : "(no description)"}</div>
                          </div>
                        </div>
                        <div className="side">
                          <dl className="fields">
                            {r.fields.map(([k, v]) => (
                              <Fragment key={k}>
                                <dt>{k}</dt>
                                <dd>{v}</dd>
                              </Fragment>
                            ))}
                          </dl>
                        </div>
                        <div className="detail-actions" onClick={(e) => e.stopPropagation()}>
                          <Link className="btn btn-primary" href={`/tickets/${r.id}`}>
                            Open {r.ref}
                            <span className="kbd">O</span>
                          </Link>
                          <StatusControl id={r.id} status={r.status.raw} compact />
                          <span className="c-3 t-12" style={{ marginLeft: "auto" }}>
                            {i + 1} of {rows.length}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
