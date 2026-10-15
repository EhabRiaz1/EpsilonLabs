"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Tabs } from "./Tabs";

export type RouteTab = { key: string; label: string; count?: number; href: string };

/** The sliding-ink Tabs for server-filtered lists: each tab is a URL (?status=…), so a reload or a shared link keeps
 *  the view. The list dims while the next view loads. */
export function RouteTabs({ items, value, label, className }: { items: RouteTab[]; value: string; label: string; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // the ink moves at once; the server view follows
  const [picked, setPicked] = useState<string | null>(null);
  const cur = pending && picked ? picked : value;
  return (
    <div className={`route-tabs${pending ? " is-pending" : ""}${className ? ` ${className}` : ""}`} aria-busy={pending || undefined}>
      <Tabs
        label={label}
        value={cur}
        items={items.map(({ key, label: l, count }) => ({ key, label: l, count }))}
        onChange={(k) => {
          const t = items.find((x) => x.key === k);
          if (!t) return;
          setPicked(k);
          start(() => router.push(t.href, { scroll: false }));
        }}
      />
    </div>
  );
}
