"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./Icon";

export type NoteTone = "error" | "warn" | "ok";
const ICON = { error: "alert", warn: "alert", ok: "check" } as const;

/** One message line for a page, a panel or a sheet footer (admin redesign: replaces the ad-hoc .auth-error / .ok-note
 *  / c-bad paragraphs). Errors are announced (role=alert); `retry` adds a "Retry" button that re-reads the page. */
export function Note({ tone = "error", children, retry, className }: { tone?: NoteTone; children: ReactNode; retry?: boolean; className?: string }) {
  return (
    <div className={`callout${className ? ` ${className}` : ""}`} data-tone={tone} role={tone === "error" ? "alert" : "status"}>
      <Icon name={ICON[tone]} className="i-sm" />
      <span className="grow">{children}</span>
      {retry && <RetryButton />}
    </div>
  );
}

/** Re-runs the server render of the current page (the "–" + retry state of design review D4). */
export function RetryButton({ label = "Retry" }: { label?: string }) {
  const router = useRouter();
  return (
    <button className="link-btn" type="button" onClick={() => router.refresh()}>
      {label}
    </button>
  );
}
