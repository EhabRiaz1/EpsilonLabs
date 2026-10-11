import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/lib/auth-actions";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { ThemePill } from "./ThemePill";
import { CloseMenuButton, SearchButton } from "./ShellControls";

export type NavItem = { href: string; label: string; icon: IconName; current?: boolean; count?: number };

/** The approved shell: rounded outer frame, frosted inset sidebar, theme pill in the sidebar foot. */
export function Shell(props: {
  orgName: string;
  orgHost: string;
  searchLabel: string;
  nav: NavItem[];
  status?: ReactNode;
  user: { name: string; detail: string; initials: string };
  children: ReactNode;
}) {
  return (
    <div className="app">
      <aside className="sidebar" id="sidebar" aria-label="Navigation">
        <div className="sb-brand">
          <span className="mark" aria-hidden="true">
            ε
          </span>
          <div className="sb-org">
            <strong>{props.orgName}</strong>
            <span>{props.orgHost}</span>
          </div>
          <CloseMenuButton />
        </div>
        <SearchButton label={props.searchLabel} />
        {props.nav.map((n) => (
          <Link key={n.href} className="nav-item" href={n.href} aria-current={n.current ? "page" : undefined}>
            <Icon name={n.icon} />
            {n.label}
            {n.count !== undefined && <span className="count">{n.count}</span>}
          </Link>
        ))}
        <div className="sb-foot">
          <div className="row between" style={{ padding: "0 6px" }}>
            <ThemePill />
            {props.status}
          </div>
          <div className="sb-user">
            <span className="avatar">{props.user.initials}</span>
            <span className="who">
              <strong className="truncate">{props.user.name}</strong>
              <span className="truncate" style={{ display: "block" }}>
                {props.user.detail}
              </span>
            </span>
            <form action={signOut}>
              <button className="btn btn-ghost btn-icon" type="submit" aria-label="Sign out" title="Sign out">
                <Icon name="arrowR" className="i-sm" />
              </button>
            </form>
          </div>
        </div>
      </aside>
      <div className="main">
        <main className="content">{props.children}</main>
      </div>
    </div>
  );
}

export function initials(nameOrEmail: string): string {
  const base = nameOrEmail.includes("@") ? nameOrEmail.split("@")[0] : nameOrEmail;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const s = parts.length > 1 ? parts[0][0] + parts[1][0] : base.slice(0, 2);
  return s.toUpperCase();
}
