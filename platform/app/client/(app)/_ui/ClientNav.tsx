"use client";

import { Icon } from "@/app/components/Icon";
import { NavLinks, type NavItem } from "@/app/components/NavLinks";
import { eps } from "@/app/components/eps";

/** The portal sidebar (client-home mockup): the page links, Files (opens the Files sheet), then the organisation. */
export function ClientNav({ items, files, more }: { items: NavItem[]; files: number | null; more: NavItem[] }) {
  return (
    <>
      <NavLinks items={items} />
      {files !== null && (
        <button className="nav-item nav-btn" type="button" onClick={() => eps()?.open("sheet-files")}>
          <Icon name="layers" />
          Files
          {files > 0 && <span className="count">{files}</span>}
        </button>
      )}
      <div className="nav-head nav-label">Organisation</div>
      <NavLinks items={more} />
    </>
  );
}
