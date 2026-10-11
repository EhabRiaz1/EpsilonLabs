import { describe, expect, it } from "vitest";
import { bearerOk } from "./push-auth";

const SECRET = "s3cr3t-value-that-is-long-enough-0123456789";

describe("bearerOk", () => {
  it("accepts the exact bearer secret", () => {
    expect(bearerOk(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });
  it("refuses a wrong, missing or malformed header", () => {
    for (const h of [null, undefined, "", SECRET, `bearer ${SECRET}`, `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(1)}`, "Bearer ", `Basic ${SECRET}`]) {
      expect(bearerOk(h, SECRET)).toBe(false);
    }
  });
  it("refuses everything when the secret is unset or too short", () => {
    expect(bearerOk("Bearer ", undefined)).toBe(false);
    expect(bearerOk("Bearer short", "short")).toBe(false);
    expect(bearerOk(`Bearer ${SECRET}`, "")).toBe(false);
  });
});
