// Typed access to window.Eps (app/styles/motion.js). Every call is optional: the page works before motion.js
// has loaded, it just has no animation or palette yet.
type Theme = "light" | "dark";
type EpsApi = {
  theme: { get(): Theme; set(t: Theme): void };
  open(id: string): void;
  close(id: string): void;
  cmdk: { open(): void };
  toast(msg: string, opts?: { icon?: string }): void;
};

export function eps(): EpsApi | undefined {
  return typeof window === "undefined" ? undefined : (window as unknown as { Eps?: EpsApi }).Eps;
}
