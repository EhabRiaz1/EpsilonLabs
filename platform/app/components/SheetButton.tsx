"use client";

import type { ReactNode } from "react";
import { openSheet } from "./Sheet";

/** A button that opens a <Sheet> by id (header "New …" buttons on server-rendered pages). */
export function SheetButton({ sheet, className = "btn btn-secondary", children, label }: { sheet: string; className?: string; children: ReactNode; label?: string }) {
  return (
    <button className={className} type="button" aria-haspopup="dialog" aria-controls={sheet} aria-label={label} onClick={() => openSheet(sheet)}>
      {children}
    </button>
  );
}
