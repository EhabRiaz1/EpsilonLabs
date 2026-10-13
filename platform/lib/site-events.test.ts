// The site's /api/events helpers and handler (api/_events.js, api/events.js at the repo root). They run on the
// epsilon-labs.co Vercel project, not in this app; they are tested here so they share `npm test` and CI.
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import coreJs from "../../api/_events.js";
import handlerJs from "../../api/events.js";

type Ev = { s: string; p: string; k: string; t?: string; r?: string; u?: Record<string, string>; c?: string; d?: string };
const core = coreJs as unknown as {
  normalise(body: unknown, ctx?: { country?: string | null; device?: string | null }): Ev[];
  deviceClass(ua: string): string;
  isBot(ua: string | undefined): boolean;
  optedOut(h: Record<string, string>): boolean;
  country(h: Record<string, string>): string | null;
  cleanPath(p: unknown): string | null;
};
const handler = handlerJs as unknown as (req: unknown, res: unknown) => Promise<void>;

const SID = "a1b2c3d4e5f6a1b2c3d4e5f6";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15";

describe("normalise", () => {
  it("keeps valid events and adds country and device from the request only", () => {
    const out = core.normalise(
      { e: [{ s: SID, p: "/start/?utm_source=x#top", k: "view", r: "Google.com", u: { source: "li", junk: "x", medium: "" }, c: "US", d: "tablet", ip: "1.2.3.4" }] },
      { country: "PK", device: "mobile" },
    );
    expect(out).toEqual([{ s: SID, p: "/start/", k: "view", r: "google.com", u: { source: "li" }, c: "PK", d: "mobile" }]);
  });

  it("drops bad events one by one and keeps at most 20", () => {
    const good = { s: SID, p: "/", k: "click", t: " out:github.com\n" };
    const bad = [{ s: "short", p: "/", k: "view" }, { s: SID, p: "nope", k: "view" }, { s: SID, p: "/", k: "buy" }, null, "x", { s: SID, p: "/a b", k: "view" }];
    const out = core.normalise({ e: [...bad, ...Array.from({ length: 25 }, () => good)] });
    expect(out).toHaveLength(20);
    expect(out[0]).toEqual({ s: SID, p: "/", k: "click", t: "out:github.com" });
    expect(core.normalise({ e: "x" })).toEqual([]);
    expect(core.normalise(null)).toEqual([]);
  });

  it("keeps utm on views only and drops a referrer that is not a host", () => {
    const [click] = core.normalise({ e: [{ s: SID, p: "/", k: "click", u: { source: "x" }, r: "https://evil/x" }] });
    expect(click).toEqual({ s: SID, p: "/", k: "click" });
  });
});

describe("request checks", () => {
  it("classifies devices and bots", () => {
    expect(core.deviceClass("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148")).toBe("mobile");
    expect(core.deviceClass("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36")).toBe("mobile");
    expect(core.deviceClass("Mozilla/5.0 (Linux; Android 13; SM-X710) Safari/537.36")).toBe("tablet");
    expect(core.deviceClass("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("tablet");
    expect(core.deviceClass(UA)).toBe("desktop");
    expect(core.isBot("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(core.isBot(undefined)).toBe(true);
    expect(core.isBot(UA)).toBe(false);
  });

  it("honours DNT and GPC, and takes the country from Vercel's header only", () => {
    expect(core.optedOut({ dnt: "1" })).toBe(true);
    expect(core.optedOut({ "sec-gpc": "1" })).toBe(true);
    expect(core.optedOut({ dnt: "0" })).toBe(false);
    expect(core.country({ "x-vercel-ip-country": "pk" })).toBe("PK");
    expect(core.country({ "x-vercel-ip-country": "XXX" })).toBeNull();
    expect(core.country({})).toBeNull();
  });
});

// ---- the handler, with fetch stubbed ----------------------------------------------------------------------------

type Res = { statusCode: number; headers: Record<string, string>; setHeader(k: string, v: string): void; end(): void };
function res(): Res {
  return { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end() {} };
}
function req(body: unknown, headers: Record<string, string> = {}, method = "POST") {
  const r = Readable.from([Buffer.from(typeof body === "string" ? body : JSON.stringify(body))]) as Readable & { method: string; headers: Record<string, string> };
  r.method = method;
  r.headers = { "content-type": "text/plain;charset=UTF-8", origin: "https://epsilon-labs.co", "user-agent": UA, "x-forwarded-for": "203.0.113.7", "x-vercel-ip-country": "GB", ...headers };
  return r;
}
async function post(body: unknown, headers?: Record<string, string>, method?: string) {
  const r = res();
  await handler(req(body, headers, method), r);
  return r.statusCode;
}

describe("POST /api/events", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "https://db.example.supabase.co");
    vi.stubEnv("SUPABASE_ANON_KEY", "sb_publishable_test");
    vi.stubEnv("INTAKE_IP_SALT", "0123456789abcdef0123");
    fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ state: "ok", stored: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const body = { e: [{ s: SID, p: "/work/", k: "view" }] };

  it("sends the events with a hashed client key and never the IP or user agent", async () => {
    expect(await post(body)).toBe(204);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://db.example.supabase.co/rest/v1/rpc/record_events");
    const sent = JSON.parse(init.body);
    expect(sent.p_batch.client).toMatch(/^[0-9a-f]{64}$/);
    // the visit id comes from the server (daily salted hash of IP + agent), never from the browser
    const [ev] = sent.p_batch.events;
    expect(ev).toEqual({ s: expect.stringMatching(/^[0-9a-f]{32}$/), p: "/work/", k: "view", c: "GB", d: "desktop" });
    expect(ev.s).not.toBe(SID);
    expect(init.body).not.toContain("203.0.113.7");
    expect(init.body).not.toContain("Mozilla");
    await post({ e: [{ p: "/", k: "view" }] });                       // the tracker no longer sends an id at all
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).p_batch.events[0].s).toBe(ev.s);   // same visitor, same day
    await post({ e: [{ p: "/", k: "view" }] }, { "x-forwarded-for": "198.51.100.9" });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).p_batch.events[0].s).not.toBe(ev.s);
  });

  it("stores nothing for DNT, GPC, bots or an empty batch", async () => {
    expect(await post(body, { dnt: "1" })).toBe(204);
    expect(await post(body, { "sec-gpc": "1" })).toBe(204);
    expect(await post(body, { "user-agent": "Googlebot/2.1" })).toBe(204);
    expect(await post({ e: [] })).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses other methods, origins, types and sizes", async () => {
    expect(await post(body, {}, "GET")).toBe(405);
    expect(await post(body, { origin: "https://evil.example" })).toBe(403);
    expect(await post(body, { "content-type": "application/x-www-form-urlencoded" })).toBe(415);
    expect(await post("x".repeat(17 * 1024))).toBe(413);
    expect(await post("{not json")).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 204 when the database caps or limits, and 503 when it is down or unconfigured", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ state: "rate_limited", stored: 0 }), { status: 200 }));
    expect(await post(body)).toBe(204);
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    expect(await post(body)).toBe(503);
    vi.stubEnv("INTAKE_IP_SALT", "");
    expect(await post(body)).toBe(503);
  });
});
