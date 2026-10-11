"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import { eps } from "@/app/components/eps";
import type { IconName } from "@/app/components/icons";
import { markRead } from "../actions";

export type Bell = { id: string; kind: string; title: string; link: string | null; urgent: boolean; unread: boolean; when: string };

const ICON: Record<string, IconName> = { ticket_status: "ticket", reply: "mail", invoice: "receipt", file: "file" };

/** In-app notifications (the digest emails come later): newest first, unread marked. */
export function BellSheet({ items }: { items: Bell[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const unread = items.filter((i) => i.unread);

  function open(b: Bell) {
    start(async () => {
      if (b.unread) await markRead([b.id]);
      eps()?.close("sheet-bell");
      if (b.link) router.push(b.link);
      else router.refresh();
    });
  }

  return (
    <div className="sheet" id="sheet-bell" role="dialog" aria-modal="true" aria-labelledby="bell-title">
      <div className="sheet-head">
        <div className="grow">
          <h2 id="bell-title">Notifications</h2>
          <div className="c-3 t-13">{unread.length ? `${unread.length} unread` : "You're all caught up"}</div>
        </div>
        <button className="btn btn-secondary btn-icon" type="button" aria-label="Close" onClick={() => eps()?.close("sheet-bell")}>
          <Icon name="x" />
        </button>
      </div>
      <div className="sheet-body">
        {items.length ? (
          <div className="list-rows">
            {items.map((b) => (
              <button key={b.id} type="button" onClick={() => open(b)} disabled={pending}>
                <span className="avatar avatar-soft" aria-hidden="true">
                  <Icon name={ICON[b.kind] ?? "bell"} className="i-sm" />
                </span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className={b.unread ? "w-600" : "c-2"} style={{ display: "block", overflowWrap: "anywhere" }}>
                    {b.title}
                  </span>
                  <span className="c-3 t-12">
                    {b.when}
                    {b.urgent && b.unread ? " · needs you" : ""}
                  </span>
                </span>
                {b.unread && <span className="unread-dot" aria-label="Unread" />}
              </button>
            ))}
          </div>
        ) : (
          <div className="empty" style={{ padding: "48px 12px" }}>
            <div className="orb">
              <span className="wave" />
              <span className="wave" />
              <span className="core">
                <Icon name="bell" className="i-lg" />
              </span>
            </div>
            <h2 className="display">Nothing new</h2>
            <p className="c-2" style={{ maxWidth: "34ch" }}>
              Status changes, replies from Ehab, new files and invoices show up here.
            </p>
          </div>
        )}
      </div>
      {unread.length > 0 && (
        <div className="sheet-foot">
          <span className="grow" />
          <button className="btn btn-secondary" type="button" disabled={pending} onClick={() => start(async () => { await markRead(null); router.refresh(); })}>
            <Icon name="check" className="i-sm" />
            Mark all read
          </button>
        </div>
      )}
    </div>
  );
}
