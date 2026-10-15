"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ADMIN_PAGES } from "@/lib/admin-nav";
import { whenEps, type CmdItem } from "./eps";

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

/** A command a page adds to ⌘K while it is mounted. `bind` also makes it a single-key shortcut (only when no input,
 *  textarea or select has focus: motion.js checks); `keys` alone only shows the key in the palette (for keys a page
 *  already handles itself, like the approval queue's reducer). */
export type PageCommand = Omit<CmdItem, "group"> & { group?: string; bind?: string };

/** Registers page commands and key bindings; returns off(), which removes them and restores the keys they shadowed. */
export function registerPageCommands(group: string, cmds: PageCommand[]): () => void {
  let off = () => {};
  const stop = whenEps((e) => {
    const items: CmdItem[] = cmds.map((c) => ({ group: c.group ?? group, label: c.label, icon: c.icon, keys: c.keys, run: c.run }));
    const offCmds = e.cmdk.register(items);
    const bound = cmds.filter((c) => c.bind);
    const offKeys = bound.length ? e.keys(Object.fromEntries(bound.map((c) => [c.bind as string, () => c.run()]))) : undefined;
    off = () => {
      if (typeof offCmds === "function") offCmds();
      if (typeof offKeys === "function") offKeys();
    };
  });
  return () => {
    stop();
    off();
  };
}

/** Page commands for the life of a component. The commands always call the latest `cmds` (read through a ref), so
 *  they are registered once per `signature` (change it when the set of commands, not their handlers, changes). */
export function usePageCommands(group: string, cmds: PageCommand[], signature: string) {
  const latest = useRef(cmds);
  useEffect(() => {
    latest.current = cmds;
  });
  useEffect(() => {
    const live = latest.current.map((c, i) => ({ ...c, run: () => latest.current[i]?.run() }));
    return registerPageCommands(group, live);
  }, [group, signature]);
}
