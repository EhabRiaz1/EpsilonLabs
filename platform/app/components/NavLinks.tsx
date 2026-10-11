"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";
import type { IconName } from "./icons";

export type NavItem = { href: string; label: string; icon: IconName; count?: number; hot?: boolean };

/** Sidebar links; the current one is the longest href that prefixes the path. */
export function NavLinks({ items }: { items: NavItem[] }) {
  const raw = usePathname() ?? "/";
  const path = raw.replace(/^\/(admin|client)(?=\/|$)/, "") || "/";
  const current = items
    .filter((n) => (n.href === "/" ? path === "/" : path === n.href || path.startsWith(`${n.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <>
      {items.map((n) => (
        <Link key={n.href} className="nav-item" href={n.href} aria-current={n.href === current ? "page" : undefined}>
          <Icon name={n.icon} />
          {n.label}
          {n.count !== undefined && <span className={n.hot ? "count hot" : "count"}>{n.count}</span>}
        </Link>
      ))}
    </>
  );
}
