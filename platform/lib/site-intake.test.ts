// The site's /api/intake helpers (api/_intake.js at the repo root). They run on the epsilon-labs.co Vercel project,
// not in this app; they are tested here so they share `npm test` and CI.
import { describe, expect, it } from "vitest";
import coreJs from "../../api/_intake.js";

type Value = { name: string; email: string; company: string; kind: string; budget: string; message: string; answers: Record<string, string>; website: string; source: string };
type Mail = { subject: string; html: string; text: string };
// api/_intake.js is plain CommonJS (it deploys with the static site); this is its shape.
const core = coreJs as unknown as {
  validate(b: unknown): { ok: true; value: Value } | { ok: false; errors: Record<string, string> };
  originAllowed(o: string | undefined): boolean;
  ipKey(ip: string, secret: string, now: Date): string;
  clientIp(h: Record<string, string>): string;
  supabaseHeaders(key: string): Record<string, string>;
  ackEmail(v: Value): Mail;
  founderEmail(v: Value, id: string | null): Mail;
};

const good = {
  name: " Jonas Weber ",
  email: "Jonas@Northwind.example",
  company: "Northwind",
  kind: "hardware",
  budget: "$10k – $50k",
  message: "Twelve machines.",
  answers: { need: "A machine nobody can read", offer: "/services/protocol-decode/", offer_name: "Protocol Decode Sprint", junk: "x" },
};

describe("validate", () => {
  it("normalises a good payload and keeps only known answers", () => {
    const r = core.validate(good);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe("Jonas Weber");
    expect(r.value.email).toBe("jonas@northwind.example");
    expect(r.value.answers).toEqual({ need: "A machine nobody can read", offer: "/services/protocol-decode/", offer_name: "Protocol Decode Sprint" });
    expect(r.value.source).toBe("epsilon-labs.co/start");
  });

  it("returns field errors", () => {
    const r = core.validate({ ...good, name: "", email: "nope", kind: "firmware", message: "x".repeat(10001) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(["email", "kind", "message", "name"]);
  });

  it("refuses non-objects and bad answers", () => {
    expect(core.validate(null).ok).toBe(false);
    expect(core.validate([good]).ok).toBe(false);
    expect(core.validate({ ...good, answers: ["x"] }).ok).toBe(false);
    expect(core.validate({ ...good, answers: { need: "x".repeat(501) } }).ok).toBe(false);
    expect(core.validate({ ...good, answers: { need: 3 } }).ok).toBe(false);
  });

  it("passes the honeypot through for the handler to drop", () => {
    const r = core.validate({ ...good, website: "http://spam.example" });
    expect(r.ok && r.value.website).toBe("http://spam.example");
  });
});

describe("originAllowed", () => {
  it("allows the site, previews and local dev only", () => {
    for (const o of [undefined, "https://epsilon-labs.co", "https://www.epsilon-labs.co", "https://site-git-x.vercel.app", "http://localhost:8000"]) {
      expect(core.originAllowed(o)).toBe(true);
    }
    for (const o of ["https://evil.example", "http://epsilon-labs.co", "https://epsilon-labs.co.evil.example", "null", "garbage"]) {
      expect(core.originAllowed(o)).toBe(false);
    }
  });
});

describe("ipKey", () => {
  const secret = "s".repeat(32);
  const day1 = new Date("2026-10-12T10:00:00Z");
  it("is stable within a day, changes the next day, and never contains the address", () => {
    const k = core.ipKey("203.0.113.7", secret, day1);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(core.ipKey("203.0.113.7", secret, new Date("2026-10-12T23:59:00Z"))).toBe(k);
    expect(core.ipKey("203.0.113.7", secret, new Date("2026-10-13T00:01:00Z"))).not.toBe(k);
    expect(core.ipKey("203.0.113.8", secret, day1)).not.toBe(k);
    expect(core.ipKey("203.0.113.7", "t".repeat(32), day1)).not.toBe(k);
    expect(k).not.toContain("203");
  });
  it("needs a real secret", () => {
    expect(() => core.ipKey("1.2.3.4", "short", day1)).toThrow(/INTAKE_IP_SALT/);
  });
  it("reads the first forwarded hop", () => {
    expect(core.clientIp({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })).toBe("203.0.113.7");
    expect(core.clientIp({ "x-real-ip": "198.51.100.2" })).toBe("198.51.100.2");
    expect(core.clientIp({})).toBe("");
  });
});

describe("supabaseHeaders", () => {
  it("sends a publishable key as apikey only, a legacy JWT also as bearer", () => {
    expect(core.supabaseHeaders("sb_publishable_abc")).toEqual({ apikey: "sb_publishable_abc", "Content-Type": "application/json" });
    expect(core.supabaseHeaders("eyJhbGc.x.y").Authorization).toBe("Bearer eyJhbGc.x.y");
  });
});

describe("emails", () => {
  const v = (core.validate({ ...good, name: "<b>Jonas</b> W", company: "A&B <Ltd>", message: "<script>x</script>" }) as { ok: true; value: Value }).value;
  it("acknowledgement is a fixed template with the first name escaped", () => {
    const m = core.ackEmail(v);
    expect(m.subject).toBe("We have your enquiry · Epsilon Labs");
    expect(m.html).toContain("Thanks, &lt;b&gt;Jonas&lt;/b&gt;");
    expect(m.html).not.toContain("<b>Jonas");
    expect(m.html).not.toContain("script");
  });
  it("founder notice escapes everything the visitor typed and links to admin", () => {
    const m = core.founderEmail(v, "11111111-2222-3333-4444-555555555555");
    expect(m.subject).toBe("[Epsilon] New enquiry from <b>Jonas</b> W (A&B <Ltd>)");
    expect(m.html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("https://admin.epsilon-labs.co/intake/11111111-2222-3333-4444-555555555555");
    expect(m.text).toContain("Track: hardware");
  });
});
