// Typed access to window.Eps (app/styles/motion.js). Every call is optional: the page works before motion.js
// has loaded, it just has no animation or palette yet.
type Theme = "light" | "dark";
export type CmdItem = { group: string; label: string; icon?: string; keys?: string; run: () => void };
export type ToastOpts = {
  icon?: string;
  /** countdown ring; the toast commits when it runs out */
  seconds?: number;
  /** label of the action button (e.g. "Undo"); pressing it calls onUndo instead of onCommit */
  action?: string;
  onUndo?: () => void;
  onCommit?: () => void;
  sticky?: boolean;
};
type EpsApi = {
  theme: { get(): Theme; set(t: Theme): void };
  open(id: string): void;
  close(id: string): void;
  cmdk: { open(): void; isOpen(): boolean; register(items: CmdItem[]): void };
  /** msg is inserted as HTML by motion.js: pass only escaped text (lib/html esc). */
  toast(msg: string, opts?: ToastOpts): { close(): void };
  keys(map: Record<string, (e: KeyboardEvent) => void>): void;
  reduced(): boolean;
  sparkline(el: HTMLElement, data: number[]): void;
  lines(el: HTMLElement, cfg: { labels: string[]; series: { name: string; color: string; data: number[] }[]; marker?: number; badge?: string; aria?: string; height?: number }): void;
};

export function eps(): EpsApi | undefined {
  return typeof window === "undefined" ? undefined : (window as unknown as { Eps?: EpsApi }).Eps;
}

/** Runs fn once window.Eps exists (motion.js is loaded after hydration). */
export function whenEps(fn: (e: EpsApi) => void): () => void {
  const now = eps();
  if (now) {
    fn(now);
    return () => {};
  }
  // motion.js dispatches eps:ready inside boot(), before its last line assigns window.Eps: read it one task later
  const on = () =>
    setTimeout(() => {
      const e = eps();
      if (e) fn(e);
    }, 0);
  document.addEventListener("eps:ready", on, { once: true });
  return () => document.removeEventListener("eps:ready", on);
}
