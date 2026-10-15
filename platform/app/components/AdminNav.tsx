"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import type { AdminNavGroup } from "@/lib/admin-nav";

export type NavCount = { count?: number; hot?: boolean };
export type TicketOrg = { id: string; name: string; open: number };

const STORE = "eps.nav.collapsed";
const TREE_MAX = 5;

/** The admin sidebar (design review D2): groups with collapsible heads (System starts collapsed; the choice is
 * remembered), G-key hints always visible, and a per-client tree under Tickets. */
export function AdminNav(props: { groups: AdminNavGroup[]; counts: Record<string, NavCount>; ticketOrgs: TicketOrg[] | null }) {
  const raw = usePathname() ?? "/";
  const path = raw.replace(/^\/admin(?=\/|$)/, "") || "/";
  const all = props.groups.flatMap((g) => g.pages);
  const current = all
    .filter((n) => (n.href === "/" ? path === "/" : path === n.href || path.startsWith(`${n.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const currentGroup = props.groups.find((g) => g.pages.some((p) => p.href === current))?.key;

  const [closed, setClosed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(props.groups.filter((g) => g.collapsed).map((g) => [g.key, true])),
  );
  const [treeOpen, setTreeOpen] = useState(path.startsWith("/tickets"));
  useEffect(() => {
    // the remembered open/closed groups, read after hydration so server and client render the same first frame
    const load = () => {
      try {
        const saved = JSON.parse(localStorage.getItem(STORE) || "null") as Record<string, boolean> | null;
        if (saved) setClosed((c) => ({ ...c, ...saved }));
      } catch {
        // storage blocked or malformed: keep the defaults
      }
    };
    load();
  }, []);
  function toggle(key: string) {
    setClosed((c) => {
      const next = { ...c, [key]: !c[key] };
      try {
        localStorage.setItem(STORE, JSON.stringify(next));
      } catch {
        // storage blocked: the toggle still applies on this page
      }
      return next;
    });
  }

  const orgs = props.ticketOrgs ?? [];
  return (
    <>
      {props.groups.map((g) => {
        const open = !closed[g.key] || g.key === currentGroup;
        const items = g.pages.map((p) => {
          const c = props.counts[p.href] ?? {};
          const keys = p.seq.toUpperCase().split(" ");
          if (p.href === "/tickets" && orgs.length) {
            return (
              <div key={p.href}>
                <button
                  className="nav-item nav-toggle"
                  type="button"
                  aria-expanded={treeOpen}
                  aria-current={current === p.href ? "page" : undefined}
                  onClick={() => setTreeOpen((o) => !o)}
                >
                  <Icon name={p.icon} />
                  {p.label}
                  {c.count !== undefined && <span className={c.hot ? "count hot" : "count"}>{c.count}</span>}
                  <Icon name="chevD" className="i-sm chev" />
                </button>
                <div className="collapse" data-open={treeOpen ? "" : undefined}>
                  <div>
                    <div className="nav-tree">
                      <Link href="/tickets" aria-current={path === "/tickets" ? "page" : undefined}>
                        All tickets
                      </Link>
                      {orgs.slice(0, TREE_MAX).map((o) => (
                        <Link key={o.id} href={`/tickets?org=${o.id}`}>
                          <span className="truncate">{o.name}</span>
                          <span className="n">{o.open}</span>
                        </Link>
                      ))}
                      {orgs.length > TREE_MAX && <Link href="/clients">All clients</Link>}
                    </div>
                  </div>
                </div>
              </div>
            );
          }
          return (
            <Link key={p.href} className="nav-item" href={p.href} aria-current={current === p.href ? "page" : undefined}>
              <Icon name={p.icon} />
              {p.label}
              {c.count !== undefined && <span className={c.hot ? "count hot" : "count"}>{c.count}</span>}
              <span className="kbd-group" aria-hidden="true">
                {keys.map((k, i) => (
                  <span key={i} className="kbd">
                    {k}
                  </span>
                ))}
              </span>
            </Link>
          );
        });
        if (!g.label) return <div key={g.key}>{items}</div>;
        return (
          <div key={g.key}>
            <button className="nav-head" type="button" aria-expanded={open} onClick={() => toggle(g.key)}>
              {g.label} <Icon name="chevD" className="i-sm" />
            </button>
            <div className="collapse" data-open={open ? "" : undefined}>
              <div>{items}</div>
            </div>
          </div>
        );
      })}
    </>
  );
}
