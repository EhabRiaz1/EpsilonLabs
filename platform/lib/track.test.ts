// The site's tracker (assets/js/track.js at the repo root), run against a fake window and document.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("../../assets/js/track.js", import.meta.url), "utf8");

type Listener = (e?: unknown) => void;
type Sent = { via: "beacon" | "fetch"; body: { e: { s: string; p: string; k: string; t?: string; r?: string; u?: Record<string, string> }[] } };

function load(opts: { url?: string; referrer?: string; dnt?: string; gpc?: boolean; wizard?: boolean; stored?: string } = {}) {
  const url = new URL(opts.url ?? "https://epsilon-labs.co/work/?utm_source=linkedin&utm_campaign=oct&x=1");
  const sent: Sent[] = [];
  const docL: Record<string, Listener[]> = {};
  const winL: Record<string, Listener[]> = {};
  const store = new Map<string, string>(opts.stored ? [["eps-sid", opts.stored]] : []);
  let interval: Listener | null = null;
  let observer: Listener | null = null;
  const count = { textContent: "01 / 07" };
  const back = { hidden: true };
  const doc = {
    referrer: opts.referrer ?? "https://www.Google.com/search?q=x",
    visibilityState: "visible",
    addEventListener: (t: string, f: Listener) => (docL[t] ??= []).push(f),
    getElementById: (id: string) => (opts.wizard ? (id === "wiz-count" ? count : id === "wiz-back" ? back : null) : null),
  };
  const win = {
    location: { pathname: url.pathname, search: url.search, href: url.href, host: url.host },
    navigator: {
      doNotTrack: opts.dnt,
      globalPrivacyControl: opts.gpc,
      sendBeacon: (_u: string, blob: { text: string }) => (sent.push({ via: "beacon", body: JSON.parse(blob.text) }), true),
    },
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
    crypto: { getRandomValues: (a: Uint8Array) => a.fill(171) },
    URL,
    URLSearchParams,
    Blob: class { text: string; constructor(parts: string[]) { this.text = parts.join(""); } },
    fetch: (_u: string, init: { body: string }) => (sent.push({ via: "fetch", body: JSON.parse(init.body) }), Promise.resolve()),
    setInterval: (f: Listener) => { interval = f; },
    addEventListener: (t: string, f: Listener) => (winL[t] ??= []).push(f),
    MutationObserver: class { constructor(f: Listener) { observer = f; } observe() {} },
  };
  new Function("window", "document", SRC)(win, doc);
  const click = (href: string) => docL.click?.forEach((f) => f({ target: { closest: () => ({ href }) } }));
  return {
    sent, store, count, back, click,
    tick: () => interval?.(),
    hide: () => { doc.visibilityState = "hidden"; docL.visibilitychange?.forEach((f) => f()); },
    pagehide: () => winL.pagehide?.forEach((f) => f()),
    mutate: () => observer?.(),
    listeners: Object.keys(docL).length + Object.keys(winL).length,
  };
}

describe("track.js", () => {
  it("stays under 3 KB", () => {
    expect(Buffer.byteLength(SRC, "utf8")).toBeLessThan(3072);
  });

  it("sends nothing and listens to nothing with Do-Not-Track or GPC", () => {
    for (const o of [{ dnt: "1" }, { gpc: true }]) {
      const t = load(o);
      t.tick();
      t.pagehide();
      expect(t.sent).toEqual([]);
      expect(t.listeners).toBe(0);
      expect(t.store.size).toBe(0);
    }
  });

  it("records the view with the referrer host and utm tags, and keeps one id per tab", () => {
    const t = load();
    expect(t.sent).toEqual([]);                          // batched, not sent at once
    t.hide();
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].via).toBe("beacon");
    const [view] = t.sent[0].body.e;
    expect(view).toEqual({ s: "ab".repeat(12), p: "/work/", k: "view", r: "www.google.com", u: { source: "linkedin", campaign: "oct" } });
    expect(t.store.get("eps-sid")).toBe("ab".repeat(12));
    expect(load({ stored: "existing-session-1" }).store.get("eps-sid")).toBe("existing-session-1");
  });

  it("names clicked links by path, outbound host or scheme, and batches every 10 s", () => {
    const t = load({ referrer: "" });
    t.click("https://epsilon-labs.co/start/?x=1");
    t.click("https://github.com/epsilon/x");
    t.click("mailto:er@epsilon-labs.co");
    t.tick();
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].via).toBe("fetch");
    expect(t.sent[0].body.e.map((e) => [e.k, e.t])).toEqual([["view", undefined], ["click", "/start/"], ["click", "out:github.com"], ["click", "mailto"]]);
    expect(t.sent[0].body.e[0].r).toBeUndefined();
    t.tick();
    expect(t.sent).toHaveLength(1);                       // nothing new, nothing sent
  });

  it("sends a full batch of 20 straight away", () => {
    const t = load();
    for (let i = 0; i < 25; i++) t.click(`https://epsilon-labs.co/p${i}/`);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].body.e).toHaveLength(20);
    t.pagehide();
    expect(t.sent[1].body.e).toHaveLength(6);
  });

  it("follows the /start wizard: each step once, then the submit", () => {
    const t = load({ url: "https://epsilon-labs.co/start/", wizard: true });
    t.back.hidden = false;
    for (const s of ["02 / 07", "03 / 07", "02 / 07", "07 / 07"]) {
      t.count.textContent = s;
      t.mutate();
    }
    t.back.hidden = true;                                // the thank-you view hides Back, count stays 07
    t.mutate();
    t.mutate();
    t.pagehide();
    const e = t.sent[0].body.e;
    expect(e.filter((x) => x.k === "start_step").map((x) => x.t)).toEqual(["1", "2", "3", "7"]);
    expect(e.filter((x) => x.k === "start_submit")).toHaveLength(1);
  });
});
