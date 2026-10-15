import type { ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./icons";

/** Empty states (admin redesign). `page`: the All-clear orb, a title, a line and an optional action, for a whole
 *  panel. `inline`: one muted line with an optional action ("No invoices yet · New invoice"). */
export function Empty({
  variant = "page", title, children, action, icon = "check",
}: {
  variant?: "page" | "inline";
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  icon?: IconName;
}) {
  if (variant === "inline")
    return (
      <p className="empty-inline">
        <span>{children ?? title}</span>
        {action && <span className="sep" aria-hidden="true">·</span>}
        {action}
      </p>
    );
  return (
    <div className="empty">
      <div className="orb" aria-hidden="true">
        <span className="wave" />
        <span className="wave" />
        <span className="core">
          <Icon name={icon} className="i-lg" />
        </span>
      </div>
      {title && <h2>{title}</h2>}
      {children && <div className="empty-body">{children}</div>}
      {action}
    </div>
  );
}
