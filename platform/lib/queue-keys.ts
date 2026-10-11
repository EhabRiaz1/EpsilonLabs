// Keyboard reducer for the approval queue (admin-queue.html): J/K move, A approve, E edit, R reject, H/L later,
// Escape cancels an edit, ⌘↵ saves it. Pure, so the rules are unit-tested without a browser.

export type QueueState = { sel: number; editing: boolean; gAt: number };
export type QueueKeyEvent = {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  /** focus is in an input, textarea or select */
  typing?: boolean;
  /** event time in ms (for the "g x" go-to sequences of the palette) */
  at?: number;
};
export type QueueCommand = "approve" | "edit" | "save" | "cancel" | "reject" | "hold" | null;
export type QueueResult = { state: QueueState; command: QueueCommand; handled: boolean };

export const initialQueueState: QueueState = { sel: 0, editing: false, gAt: -Infinity };
const G_WINDOW = 900; // motion.js waits this long for the second key of a sequence

export function clampSel(sel: number, n: number): number {
  return n <= 0 ? 0 : Math.min(Math.max(sel, 0), n - 1);
}

/** n = number of visible items. `handled` means the caller should preventDefault. */
export function queueKey(state: QueueState, ev: QueueKeyEvent, n: number): QueueResult {
  const none = (s: QueueState = state): QueueResult => ({ state: s, command: null, handled: false });
  const at = ev.at ?? 0;
  if (state.editing) {
    if (ev.key === "Escape") return { state: { ...state, editing: false }, command: "cancel", handled: true };
    if (ev.key === "Enter" && (ev.meta || ev.ctrl)) return { state, command: "save", handled: true };
    return none(); // typing in the editor
  }
  if (ev.meta || ev.ctrl || ev.alt || ev.typing) return none();
  const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
  // the key after "g" belongs to the palette's go-to sequence, never to the queue
  if (at - state.gAt < G_WINDOW) return none({ ...state, gAt: -Infinity });
  if (k === "g") return none({ ...state, gAt: at });
  if (n <= 0) return none();
  const sel = clampSel(state.sel, n);
  const cmd = (command: QueueCommand, s: QueueState = { ...state, sel }): QueueResult => ({ state: s, command, handled: true });
  switch (k) {
    case "j":
    case "ArrowDown":
      return cmd(null, { ...state, sel: (sel + 1) % n });
    case "k":
    case "ArrowUp":
      return cmd(null, { ...state, sel: (sel - 1 + n) % n });
    case "a":
      return cmd("approve");
    case "e":
      return cmd("edit", { ...state, sel, editing: true });
    case "r":
      return cmd("reject");
    case "h":
    case "l":
      return cmd("hold");
    default:
      return none();
  }
}
