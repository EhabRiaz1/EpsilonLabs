"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ADMIN_PAGES } from "@/lib/admin-nav";
import { whenEps } from "./eps";

// motion.js keeps its palette for the life of the page; client navigation keeps the page, so register once.
let registered = false;

/** ⌘K "Go to" for every admin page, plus G-then-letter shortcuts (admin-queue.html). Renders nothing. */
export function AdminPalette() {
  const router = useRouter();
  const ref = useRef(router);
  useEffect(() => {
    ref.current = router;
  }, [router]);
  useEffect(
    () =>
      whenEps((e) => {
        if (registered) return;
        registered = true;
        const go = (href: string) => () => ref.current.push(href);
        e.cmdk.register(
          ADMIN_PAGES.map((p) => ({ group: "Go to", label: p.label, icon: p.icon, keys: p.seq.toUpperCase(), run: go(p.href) })),
        );
        e.keys(Object.fromEntries(ADMIN_PAGES.map((p) => [p.seq, go(p.href)])));
      }),
    [],
  );
  return null;
}
