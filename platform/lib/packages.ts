// The packages a proposal may use (generated from tools/offers.py by scripts/sync_packages.py). Pure.
// The unit price always comes from here, never from the browser: a proposal is priced from the catalogue only.
import data from "./packages.json";

export type Package = { slug: string; name: string; category: string; price_from: number; currency: string; price_note: string; duration: string };
export type LineInput = { slug: string; qty: number; description?: string };
export type Line = { slug: string; name: string; description: string; qty: number; unit_price: number; amount: number };

export const PACKAGES: readonly Package[] = data as Package[];
const BY_SLUG = new Map(PACKAGES.map((p) => [p.slug, p]));

export function findPackage(slug: string): Package | undefined {
  return BY_SLUG.get(slug);
}

/** Price lines from the catalogue. Throws on an unknown package or a bad quantity. */
export function priceLines(inputs: readonly LineInput[]): Line[] {
  if (inputs.length > 50) throw new Error("At most 50 price lines.");
  return inputs.map((i) => {
    const p = BY_SLUG.get(i.slug);
    if (!p) throw new Error(`Unknown package: ${i.slug}`);
    if (!Number.isInteger(i.qty) || i.qty < 1 || i.qty > 10000) throw new Error(`Quantity for ${p.name} must be 1 to 10000.`);
    const description = (i.description ?? "").trim().slice(0, 1000);
    return { slug: p.slug, name: p.name, description, qty: i.qty, unit_price: p.price_from, amount: Math.round(p.price_from * i.qty * 100) / 100 };
  });
}

export function linesTotal(lines: readonly Pick<Line, "amount">[]): number {
  return Math.round(lines.reduce((a, l) => a + Math.round(l.amount * 100), 0)) / 100;
}
