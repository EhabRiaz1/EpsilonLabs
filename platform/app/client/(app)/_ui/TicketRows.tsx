"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { Icon } from "@/app/components/Icon";

export type TicketRow = {
  id: string;
  ref: string;
  title: string;
  sub: string;
  project: string;
  status: { label: string; tone: string };
  updated: string;
  fields: [string, string][];
  last: { who: string; initials: string; when: string; body: string } | null;
  waiting: boolean;
};

/** Ticket rows that expand inline (client-home.html): fields, the latest reply, and the thread link. */
export function TicketRows({ rows, initiallyOpen }: { rows: TicketRow[]; initiallyOpen?: string | null }) {
  const [open, setOpen] = useState<string | null>(initiallyOpen ?? null);
  return (
    <table className="table">
      <thead>
        <tr>
          <th className="hide-s">ID</th>
          <th>Title</th>
          <th className="hide-m">Project</th>
          <th>Status</th>
          <th className="hide-m" style={{ textAlign: "right" }}>
            Updated
          </th>
          <th style={{ width: 40 }} aria-label="Expand" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const isOpen = open === r.id;
          return (
            <Fragment key={r.id}>
              <tr
                className="rowx"
                aria-expanded={isOpen}
                tabIndex={0}
                onClick={() => setOpen(isOpen ? null : r.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOpen(isOpen ? null : r.id);
                  }
                }}
              >
                <td className="id hide-s">{r.ref}</td>
                <td>
                  <div className="ticket-title">{r.title}</div>
                  <div className="ticket-sub">
                    <span className="show-s mono">{r.ref} · </span>
                    {r.sub}
                  </div>
                </td>
                <td className="hide-m c-2">{r.project}</td>
                <td>
                  <span className={`pill ${r.status.tone}`}>
                    <span className="dot" />
                    {r.status.label}
                  </span>
                </td>
                <td className="hide-m c-3" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {r.updated}
                </td>
                <td>
                  <Icon name="chevD" className="chev" />
                </td>
              </tr>
              <tr className="detail">
                <td colSpan={6}>
                  <div className="collapse" data-open={isOpen ? "" : undefined}>
                    <div>
                        <div className="detail-body" inert={!isOpen}>
                          <dl className="fields">
                            {r.fields.map(([k, v]) => (
                              <Fragment key={k}>
                                <dt>{k}</dt>
                                <dd>{v}</dd>
                              </Fragment>
                            ))}
                          </dl>
                          <div className="side">
                            {r.last ? (
                              <div className="comment">
                                <div className="who">
                                  <span className="avatar avatar-xs">{r.last.initials}</span>
                                  {r.last.who} · {r.last.when}
                                </div>
                                {r.last.body.length > 400 ? `${r.last.body.slice(0, 400)}…` : r.last.body}
                              </div>
                            ) : (
                              <p className="c-3 t-12">No replies yet.</p>
                            )}
                          </div>
                          <div className="detail-actions">
                            <Link className="btn btn-primary" href={`/tickets/${r.id}`}>
                              View thread
                            </Link>
                            <Link className="btn btn-secondary" href={`/tickets/${r.id}#reply`}>
                              <Icon name="pencil" className="i-sm" />
                              Add a note
                            </Link>
                            {r.waiting && (
                              <span className="c-3 t-12" style={{ marginLeft: "auto" }}>
                                Ehab is waiting on this
                              </span>
                            )}
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
