"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { Icon } from "@/app/components/Icon";
import { clientPill } from "./pill";

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

/** Request rows that expand inline (client-ticket mockup): details on the left, the latest reply on the right. */
export function TicketRows({ rows, initiallyOpen }: { rows: TicketRow[]; initiallyOpen?: string | null }) {
  const [open, setOpen] = useState<string | null>(initiallyOpen ?? null);
  return (
    <table className="table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Request</th>
          <th className="hide-m">Project</th>
          <th>Status</th>
          <th className="hide-m" style={{ textAlign: "right" }}>
            Updated
          </th>
          <th style={{ width: 36 }} aria-label="Expand" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const isOpen = open === r.id;
          const tone = clientPill(r.status.tone, r.waiting);
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
                <td className="id">{r.ref}</td>
                <td>
                  <div className="ttl">{r.title}</div>
                  <div className="sub">
                    <span className="show-s">{r.ref} · </span>
                    {r.sub}
                  </div>
                </td>
                <td className="hide-m c-2">{r.project}</td>
                <td>
                  <span className={`pill ${tone}`}>
                    <span className={tone === "pill-good" && r.status.label === "In progress" ? "dot live" : "dot"} />
                    {r.status.label}
                  </span>
                </td>
                <td className="hide-m when">{r.updated}</td>
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
                        <div>
                          {r.last ? (
                            <div className="reply">
                              <div className="who">
                                <span className="avatar">{r.last.initials}</span>
                                {r.last.who} · {r.last.when}
                              </div>
                              {r.last.body.length > 400 ? `${r.last.body.slice(0, 400)}…` : r.last.body}
                            </div>
                          ) : (
                            <p className="reply none">No replies yet.</p>
                          )}
                        </div>
                        <div className="detail-actions">
                          <Link className="btn btn-primary" href={`/tickets/${r.id}`}>
                            {r.waiting ? `Review ${r.ref}` : "View thread"}
                          </Link>
                          <Link className="btn btn-secondary" href={`/tickets/${r.id}#reply`}>
                            <Icon name="send" className="i-sm" />
                            Reply
                          </Link>
                          {r.waiting && <span className="note-t">Ehab is waiting on you</span>}
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
