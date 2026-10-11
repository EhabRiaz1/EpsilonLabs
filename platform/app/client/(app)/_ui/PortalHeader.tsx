"use client";

import { useEffect, type ReactNode } from "react";
import { Icon } from "@/app/components/Icon";
import { MenuButton } from "@/app/components/ShellControls";
import { eps } from "@/app/components/eps";

/** Page header for the portal: title, then Files, the bell and New request (N / F shortcuts, as prototyped). */
export function PortalHeader({ title, sub, unread, canRequest }: { title: ReactNode; sub?: ReactNode; unread: number; canRequest: boolean }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.closest("input, textarea, select, [contenteditable]") || t.isContentEditable))) return;
      if (document.querySelector(".sheet[data-open], .cmdk[data-open]")) return;
      if (e.key === "n" && canRequest) {
        e.preventDefault();
        eps()?.open("sheet-request");
      } else if (e.key === "f") {
        e.preventDefault();
        eps()?.open("sheet-files");
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [canRequest]);

  return (
    <header className="greet">
      <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
        <MenuButton />
        <div>
          <h1>{title}</h1>
          {sub && <div className="date">{sub}</div>}
        </div>
      </div>
      <div className="actions">
        <button className="btn btn-secondary" type="button" onClick={() => eps()?.open("sheet-files")}>
          <Icon name="layers" />
          Files
        </button>
        <span className="bell-wrap">
          <button className="btn btn-secondary btn-icon" type="button" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} onClick={() => eps()?.open("sheet-bell")}>
            <Icon name="bell" />
          </button>
          {unread > 0 && <span className="badge" aria-hidden="true" />}
        </span>
        {canRequest && (
          <button className="btn btn-primary" type="button" onClick={() => eps()?.open("sheet-request")}>
            <Icon name="plus" />
            New request
            <span className="kbd">N</span>
          </button>
        )}
      </div>
    </header>
  );
}

export function OpenRequestButton({ className, children }: { className: string; children: ReactNode }) {
  return (
    <button className={className} type="button" onClick={() => eps()?.open("sheet-request")}>
      {children}
    </button>
  );
}
