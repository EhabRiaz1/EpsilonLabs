import { describe, expect, it } from "vitest";
import { hostOnly } from "./cookies";

describe("hostOnly", () => {
  it("always drops Domain so a client.* session never reaches admin.*", () => {
    const o = hostOnly({ domain: ".epsilon-labs.co", path: "/", maxAge: 60, sameSite: "lax" }, true);
    expect(o).not.toHaveProperty("domain");
    expect(o).toMatchObject({ path: "/", maxAge: 60, sameSite: "lax", secure: true });
  });

  it("fills safe defaults", () => {
    expect(hostOnly(undefined, false)).toEqual({ path: "/", sameSite: "lax", secure: false });
  });
});
