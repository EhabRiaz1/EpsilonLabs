// Organisation slugs: what organizations.slug accepts (^[a-z0-9][a-z0-9-]{0,62}$). Pure (unit-tested).
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
}
