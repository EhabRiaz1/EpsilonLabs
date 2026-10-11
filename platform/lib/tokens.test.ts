import { describe, expect, it } from "vitest";
import { TOKEN_RE, clientIp, isToken, normaliseCode, proposalToken, sha256Hex, shortHash } from "./tokens";

const SECRET = "s".repeat(40);
const ID = "3f9a1c2e-0000-4000-8000-00000000c21e";

describe("proposal tokens", () => {
  it("are deterministic per proposal, url-safe and unguessable without the secret", () => {
    const t = proposalToken(SECRET, ID);
    expect(t).toBe(proposalToken(SECRET, ID.toUpperCase()));
    expect(t).toMatch(TOKEN_RE);
    expect(t).toHaveLength(43);
    expect(proposalToken("t".repeat(40), ID)).not.toBe(t);
    expect(proposalToken(SECRET, "3f9a1c2e-0000-4000-8000-00000000c21f")).not.toBe(t);
  });

  it("refuses a weak secret or a malformed id", () => {
    expect(() => proposalToken("short", ID)).toThrow(/32/);
    expect(() => proposalToken(SECRET, "../../etc")).toThrow();
  });

  it("hashes like pgcrypto's encode(digest(t, 'sha256'), 'hex')", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("validates token shape", () => {
    expect(isToken(proposalToken(SECRET, ID))).toBe(true);
    for (const bad of ["", "short", "x' or 1=1 --", "a".repeat(129), 42, null]) expect(isToken(bad)).toBe(false);
  });
});

describe("codes and evidence", () => {
  it("normalises 6-digit codes", () => {
    expect(normaliseCode("482 701")).toBe("482701");
    expect(normaliseCode("482-701")).toBe("482701");
    for (const bad of ["48270", "4827011", "48a701", undefined]) expect(normaliseCode(bad)).toBeNull();
  });

  it("shortens fingerprints", () => {
    expect(shortHash("3f9a" + "0".repeat(56) + "c21e")).toBe("3f9a…c21e");
    expect(shortHash(null)).toBe("");
  });

  it("takes the first forwarded IP and drops anything that isn't one", () => {
    const h = (m: Record<string, string>) => (n: string) => m[n] ?? null;
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(h({ "x-real-ip": "2001:db8::1" }))).toBe("2001:db8::1");
    expect(clientIp(h({ "x-forwarded-for": "evil'; drop table" }))).toBeNull();
    expect(clientIp(h({ "x-forwarded-for": "999.1.1.1" }))).toBeNull();
    expect(clientIp(h({}))).toBeNull();
  });
});
