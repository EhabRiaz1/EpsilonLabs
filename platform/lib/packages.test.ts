import { describe, expect, it } from "vitest";
import { PACKAGES, findPackage, linesTotal, priceLines } from "./packages";

describe("catalogue pricing", () => {
  it("prices lines from the catalogue only", () => {
    const pilot = findPackage("plant-visibility-pilot");
    expect(pilot?.price_from).toBeGreaterThan(0);
    const lines = priceLines([{ slug: "plant-visibility-pilot", qty: 1 }, { slug: "footprint", qty: 3, description: " 3 parts " }]);
    expect(lines[0]).toMatchObject({ unit_price: pilot!.price_from, amount: pilot!.price_from, description: "" });
    expect(lines[1]).toMatchObject({ qty: 3, amount: findPackage("footprint")!.price_from * 3, description: "3 parts" });
    expect(linesTotal(lines)).toBe(lines[0].amount + lines[1].amount);
  });

  it("ignores any price the browser sends and refuses unknown packages", () => {
    const forged = { slug: "footprint", qty: 1, unit_price: 1, amount: 1 } as unknown as { slug: string; qty: number };
    expect(priceLines([forged])[0].unit_price).toBe(findPackage("footprint")!.price_from);
    expect(() => priceLines([{ slug: "free-stuff", qty: 1 }])).toThrow(/Unknown package/);
    expect(() => priceLines([{ slug: "footprint", qty: 0 }])).toThrow(/Quantity/);
    expect(() => priceLines([{ slug: "footprint", qty: 1.5 }])).toThrow(/Quantity/);
  });

  it("only lists USD packages with a price", () => {
    expect(PACKAGES.length).toBeGreaterThan(10);
    for (const p of PACKAGES) expect(p.price_from > 0 && p.currency === "USD").toBe(true);
  });
});
