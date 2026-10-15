import Link from "next/link";
import type { ReactNode } from "react";
import { AutoRefresh } from "./AutoRefresh";
import { MenuButton } from "./ShellControls";

export type Crumb = { label: ReactNode; href?: string };

/** One header for every admin page (admin redesign; replaces .greet / .page-head / .t-head). Breadcrumbs or an
 *  eyebrow, the title, a mono subtitle line, actions on the right and an optional auto-refresh. `greet` is Today's
 *  variant (the mockup's .greet: bigger title, the date line, the phone goal ring under it). */
export function PageHeader({
  title, sub, crumbs, eyebrow, actions, refresh, quietRefresh, variant = "page", below, pills,
}: {
  title: ReactNode;
  sub?: ReactNode;
  crumbs?: Crumb[];
  eyebrow?: ReactNode;
  actions?: ReactNode;
  /** AutoRefresh every n seconds */
  refresh?: number;
  /** refresh without the "Live" pill */
  quietRefresh?: boolean;
  variant?: "page" | "greet";
  /** extra content under the subtitle (Today's phone goal ring) */
  below?: ReactNode;
  /** status pills under the title (ticket page) */
  pills?: ReactNode;
}) {
  const right =
    actions || refresh ? (
      <div className="actions">
        {refresh ? <AutoRefresh seconds={refresh} quiet={quietRefresh} /> : null}
        {actions}
      </div>
    ) : null;
  const trail = crumbs?.length ? (
    <nav className="crumbs-t" aria-label="Breadcrumb">
      {crumbs.map((c, i) => (
        <span key={i} className="crumb">
          {i > 0 && <span className="sep" aria-hidden="true">/</span>}
          {c.href ? <Link href={c.href}>{c.label}</Link> : <span className="here" aria-current="page">{c.label}</span>}
        </span>
      ))}
    </nav>
  ) : null;

  if (variant === "greet")
    return (
      <header className="greet">
        <div className="row greet-l">
          <MenuButton />
          <div>
            <h1>{title}</h1>
            {sub && <div className="date">{sub}</div>}
            {below}
          </div>
        </div>
        {right}
      </header>
    );
  return (
    <>
      {trail && (
        <div className="row crumbs-row">
          <MenuButton />
          {trail}
        </div>
      )}
      <header className="p-head">
        <div className="row p-head-l">
          {!trail && <MenuButton />}
          <div className="p-head-t">
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h1>{title}</h1>
            {pills && <div className="pills">{pills}</div>}
            {sub && <div className="sub">{sub}</div>}
            {below}
          </div>
        </div>
        {right}
      </header>
    </>
  );
}
