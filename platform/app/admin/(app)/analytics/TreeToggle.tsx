"use client";

import { useState } from "react";

/** "Expand all" / "Collapse all" for the sitemap tree: opens or closes every <details> under #`target` (the root
 *  stays open either way, so collapsing returns to the top level). */
export function TreeToggle({ target }: { target: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      className="btn btn-ghost btn-sm"
      type="button"
      aria-controls={target}
      aria-expanded={open}
      onClick={() => {
        const next = !open;
        document.getElementById(target)?.querySelectorAll("details").forEach((d, i) => {
          d.open = next || i === 0;
        });
        setOpen(next);
      }}
    >
      {open ? "Collapse all" : "Expand all"}
    </button>
  );
}
