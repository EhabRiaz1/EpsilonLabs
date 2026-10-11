// The site's POST /api/intake handler (api/intake.js), with fetch stubbed and no SMTP configured.
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handlerJs from "../../api/intake.js";

type Res = { statusCode: number; headers: Record<string, string>; body: string; setHeader(k: string, v: string): void; end(b: string): void };

function res(): Res {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    end(b) {
      this.body = b;
    },
  };
}

function req(body: unknown, { method = "POST", headers = {} as Record<string, string> } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const r = Readable.from([Buffer.from(raw)]) as Readable & { method: string; headers: Record<string, string> };
  r.method = method;
  r.headers = { "content-type": "application/json", origin: "https://epsilon-labs.co", "x-forwarded-for": "203.0.113.7", ...headers };
  return r;
}

// api/intake.js is plain CommonJS (a Vercel function on the static site); this is its shape.
const handler = handlerJs as unknown as (req: unknown, res: Res) => Promise<void>;

const good = { name: "Jonas", email: "jonas@northwind.example", kind: "hardware", message: "hi", answers: { need: "x" } };

async function call(body: unknown, opts?: Parameters<typeof req>[1]) {
  const r = res();
  await handler(req(body, opts), r);
  return { status: r.statusCode, json: r.body ? JSON.parse(r.body) : null };
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://db.example");
  vi.stubEnv("SUPABASE_ANON_KEY", "sb_publishable_test");
  vi.stubEnv("INTAKE_IP_SALT", "x".repeat(32));
  vi.stubEnv("SMTP_HOST", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function db(status: number, body: unknown) {
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    void url;
    void init;
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

describe("POST /api/intake", () => {
  it("stores a valid enquiry through submit_intake with the anon key and a hashed IP", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = db(200, { state: "ok", id: "11111111-2222-3333-4444-555555555555", ack: true, notify: true });
    expect(await call(good)).toEqual({ status: 200, json: { ok: true } });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://db.example/rest/v1/rpc/submit_intake");
    expect((init.headers as Record<string, string>).apikey).toBe("sb_publishable_test");
    const sent = JSON.parse(String(init.body));
    expect(sent.p_ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(String(init.body)).not.toContain("203.0.113.7");
    expect(sent.p_payload.email).toBe("jonas@northwind.example");
  });

  it("refuses the wrong method, origin, content type and size", async () => {
    const f = db(200, {});
    expect((await call(good, { method: "GET" })).status).toBe(405);
    expect((await call(good, { headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await call(good, { headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect((await call({ ...good, message: "x".repeat(33 * 1024) })).status).toBe(413);
    expect((await call("{not json")).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it("returns field errors without touching the database", async () => {
    const f = db(200, {});
    const r = await call({ ...good, email: "nope" });
    expect(r.status).toBe(400);
    expect(r.json.fields.email).toMatch(/email/);
    expect(f).not.toHaveBeenCalled();
  });

  it("answers a filled honeypot like a success and stores nothing", async () => {
    const f = db(200, {});
    expect(await call({ ...good, website: "x" })).toEqual({ status: 200, json: { ok: true } });
    expect(f).not.toHaveBeenCalled();
  });

  it("maps the rate limit to 429 and an unreachable database to 503", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db(200, { state: "rate_limited", retry_at: "2026-10-12T11:00:00Z" });
    expect((await call(good)).status).toBe(429);
    db(500, { message: "down" });
    expect((await call(good)).status).toBe(503);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    expect((await call(good)).status).toBe(503);
  });

  it("refuses to run without its configuration", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("INTAKE_IP_SALT", "");
    const f = db(200, {});
    expect((await call(good)).status).toBe(503);
    expect(f).not.toHaveBeenCalled();
  });
});
