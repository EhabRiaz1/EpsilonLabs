import { describe, expect, it } from "vitest";
import { clampSel, initialQueueState, queueKey, type QueueState } from "./queue-keys";

const S = (p: Partial<QueueState> = {}): QueueState => ({ ...initialQueueState, ...p });

describe("queueKey", () => {
  it("J/K and arrows move with wrap", () => {
    expect(queueKey(S({ sel: 0 }), { key: "j" }, 3).state.sel).toBe(1);
    expect(queueKey(S({ sel: 2 }), { key: "j" }, 3).state.sel).toBe(0);
    expect(queueKey(S({ sel: 0 }), { key: "k" }, 3).state.sel).toBe(2);
    expect(queueKey(S({ sel: 1 }), { key: "ArrowUp" }, 3).state.sel).toBe(0);
    expect(queueKey(S({ sel: 1 }), { key: "ArrowDown" }, 3).state.sel).toBe(2);
    expect(queueKey(S({ sel: 0 }), { key: "J" }, 3).state.sel).toBe(1);
  });

  it("A, R, H/L give commands; E enters edit", () => {
    expect(queueKey(S(), { key: "a" }, 2).command).toBe("approve");
    expect(queueKey(S(), { key: "r" }, 2).command).toBe("reject");
    expect(queueKey(S(), { key: "h" }, 2).command).toBe("hold");
    expect(queueKey(S(), { key: "l" }, 2).command).toBe("hold");
    const e = queueKey(S(), { key: "e" }, 2);
    expect(e.command).toBe("edit");
    expect(e.state.editing).toBe(true);
    expect(e.handled).toBe(true);
  });

  it("while editing only Escape and ⌘/Ctrl+Enter do anything", () => {
    const ed = S({ editing: true, sel: 1 });
    for (const key of ["a", "r", "j", "k", "e", "Enter"]) {
      const r = queueKey(ed, { key, typing: true }, 3);
      expect(r.command).toBeNull();
      expect(r.handled).toBe(false);
      expect(r.state).toEqual(ed);
    }
    expect(queueKey(ed, { key: "Enter", meta: true, typing: true }, 3).command).toBe("save");
    expect(queueKey(ed, { key: "Enter", ctrl: true, typing: true }, 3).command).toBe("save");
    const esc = queueKey(ed, { key: "Escape", typing: true }, 3);
    expect(esc.command).toBe("cancel");
    expect(esc.state.editing).toBe(false);
  });

  it("ignores modifiers, typing and an empty queue", () => {
    expect(queueKey(S(), { key: "a", meta: true }, 2).command).toBeNull();
    expect(queueKey(S(), { key: "a", ctrl: true }, 2).command).toBeNull();
    expect(queueKey(S(), { key: "a", alt: true }, 2).command).toBeNull();
    expect(queueKey(S(), { key: "a", typing: true }, 2).command).toBeNull();
    const empty = queueKey(S(), { key: "a" }, 0);
    expect(empty.command).toBeNull();
    expect(empty.handled).toBe(false);
  });

  it("the key after g belongs to the go-to sequence", () => {
    const g = queueKey(S(), { key: "g", at: 1000 }, 3);
    expect(g.command).toBeNull();
    const a = queueKey(g.state, { key: "a", at: 1300 }, 3);
    expect(a.command).toBeNull();
    expect(a.handled).toBe(false);
    // later, A approves again
    expect(queueKey(a.state, { key: "a", at: 1400 }, 3).command).toBe("approve");
    // a slow second key is a normal key
    expect(queueKey(g.state, { key: "a", at: 2500 }, 3).command).toBe("approve");
  });

  it("clamps a stale selection after items leave", () => {
    expect(clampSel(5, 2)).toBe(1);
    expect(clampSel(-1, 2)).toBe(0);
    expect(clampSel(3, 0)).toBe(0);
    expect(queueKey(S({ sel: 9 }), { key: "a" }, 2).state.sel).toBe(1);
  });
});
