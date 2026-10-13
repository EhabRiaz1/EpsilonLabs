// Pure helpers for admin /analytics: formatting the migration-016 aggregates and turning sitemap.xml into a tree.
// No I/O (unit-tested).

export type PageRow = { path: string; views: number; sessions: number };
export type Funnel = { visits: number; start: number; steps: { step: number; sessions: number }[]; submit: number };
export type DayRow = { day: string; views: number; sessions: number };
export type FunnelRow = { key: string; label: string; sessions: number; ofVisits: number; ofPrev: number | null };

/** The site's own hosts: a session whose first view came from one of these was opened from the site in a new tab. */
export const SITE_HOSTS = ["epsilon-labs.co", "www.epsilon-labs.co"];

/** Whole-number percentage, 0 when the base is 0. */
export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** The wizard's seven screens (assets/js/site.js on /start). */
const STEP_LABELS = ["Software or hardware", "The work", "Where it is today", "Timing", "Budget", "Your details", "Review"];

/** Rows of the /start funnel, each with its share of all visits and of the row before it. */
export function funnelRows(f: Funnel | null | undefined): FunnelRow[] {
  if (!f) return [];
  const steps = [...(f.steps ?? [])].sort((a, b) => a.step - b.step);
  const raw: { key: string; label: string; sessions: number }[] = [
    { key: "visits", label: "Visited the site", sessions: f.visits },
    { key: "start", label: "Opened /start", sessions: f.start },
    ...steps.map((s) => ({ key: `step-${s.step}`, label: `Step ${s.step} · ${STEP_LABELS[s.step - 1] ?? "Step"}`, sessions: s.sessions })),
    { key: "submit", label: "Sent the enquiry", sessions: f.submit },
  ];
  return raw.map((r, i) => ({
    ...r,
    ofVisits: pct(r.sessions, f.visits),
    ofPrev: i === 0 ? null : pct(r.sessions, raw[i - 1].sessions),
  }));
}

/** Conversion from opening /start to sending, as "3.2%" (one decimal), or "–" with no /start sessions. */
export function conversion(f: Funnel | null | undefined): string {
  if (!f || f.start <= 0) return "–";
  return `${((f.submit / f.start) * 100).toFixed(1)}%`;
}

/** How a referrer host reads in the sources list. */
export function sourceLabel(host: string | null | undefined): string {
  const h = (host ?? "").trim().toLowerCase();
  if (!h) return "Direct / unknown";
  if (SITE_HOSTS.includes(h)) return "epsilon-labs.co (new tab)";
  return h.replace(/^www\./, "");
}

/** "linkedin / social / oct-launch", skipping empty parts. */
export function utmLabel(u: { source: string; medium: string; campaign: string }): string {
  return [u.source, u.medium, u.campaign].filter(Boolean).join(" / ") || "(empty tags)";
}

export function deviceLabel(d: string): string {
  return d === "mobile" ? "Phone" : d === "tablet" ? "Tablet" : d === "desktop" ? "Desktop" : "Unknown";
}

/** Country name from its ISO code (English), the code itself if unknown, "Unknown" when empty. */
export function countryLabel(code: string): string {
  if (!code) return "Unknown";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Sum of a daily series and the change of the last 7 days against the 7 before, as a whole percentage. */
export function weekTrend(days: DayRow[], key: "views" | "sessions" = "views"): { last7: number; prev7: number; change: number | null } {
  const v = days.map((d) => Number(d[key]) || 0);
  const last7 = v.slice(-7).reduce((a, b) => a + b, 0);
  const prev7 = v.slice(-14, -7).reduce((a, b) => a + b, 0);
  return { last7, prev7, change: v.length >= 14 && prev7 > 0 ? Math.round(((last7 - prev7) / prev7) * 100) : null };
}

/** "+12%" / "−8%" / "no change" / "new" for the KPI tiles. */
export function changeText(change: number | null, prev: number): string {
  if (change === null) return prev === 0 ? "first week of data" : "";
  if (change === 0) return "no change on last week";
  return `${change > 0 ? "+" : "−"}${Math.abs(change)}% on last week`;
}

/** Short day labels for the trend chart: the first, the middle and "Today". */
export function dayLabels(days: DayRow[]): string[] {
  const n = days.length;
  return days.map((d, i) => {
    if (i === n - 1) return "Today";
    if (i === 0 || i === Math.floor(n / 2)) {
      const dt = new Date(`${d.day}T00:00:00Z`);
      return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(dt);
    }
    return "";
  });
}

// ---- sitemap ------------------------------------------------------------------------------------------------------

/** The site paths named in a sitemap.xml (<loc> entries), in document order, without duplicates. */
export function parseSitemap(xml: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of String(xml ?? "").matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    const loc = m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    let path: string;
    try {
      path = normPath(new URL(loc).pathname);
    } catch {
      continue;
    }
    if (!seen.has(path)) {
      seen.add(path);
      out.push(path);
    }
  }
  return out;
}

/** One spelling per page: "/about" and "/about/index.html" are both "/about/"; files keep their name. */
export function normPath(p: string): string {
  let s = (p || "/").split(/[?#]/)[0];
  if (!s.startsWith("/")) s = `/${s}`;
  s = s.replace(/\/index\.html?$/i, "/").replace(/\/{2,}/g, "/");
  const last = s.split("/").pop() ?? "";
  if (!s.endsWith("/") && !last.includes(".")) s += "/";
  return s;
}

export type TreeNode = {
  name: string;
  path: string;
  /** true when the sitemap lists this path (a folder can exist only because its children are listed) */
  listed: boolean;
  views: number;
  /** views of this page and everything under it */
  total: number;
  children: TreeNode[];
};

/** A tree of the sitemap's pages with views per page (from analytics_top_pages, any path spelling). */
export function sitemapTree(paths: string[], pages: PageRow[]): TreeNode {
  const views = new Map<string, number>();
  for (const p of pages) {
    const k = normPath(p.path);
    views.set(k, (views.get(k) ?? 0) + (Number(p.views) || 0));
  }
  const root: TreeNode = { name: "epsilon-labs.co", path: "/", listed: false, views: 0, total: 0, children: [] };
  const byPath = new Map<string, TreeNode>([["/", root]]);
  const ensure = (path: string): TreeNode => {
    const hit = byPath.get(path);
    if (hit) return hit;
    const parts = path.replace(/\/$/, "").split("/").filter(Boolean);
    const parentPath = parts.length > 1 ? `/${parts.slice(0, -1).join("/")}/` : "/";
    const node: TreeNode = { name: parts[parts.length - 1] ?? "/", path, listed: false, views: 0, total: 0, children: [] };
    ensure(parentPath).children.push(node);
    byPath.set(path, node);
    return node;
  };
  for (const p of paths) {
    const node = ensure(normPath(p));
    node.listed = true;
    node.views = views.get(node.path) ?? 0;
  }
  const finish = (n: TreeNode): number => {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.total = n.views + n.children.reduce((s, c) => s + finish(c), 0);
    return n.total;
  };
  finish(root);
  return root;
}

/** Listed pages with no views, in tree order. */
export function zeroViewPages(root: TreeNode): string[] {
  const out: string[] = [];
  const walk = (n: TreeNode) => {
    if (n.listed && n.views === 0) out.push(n.path);
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

/** Viewed paths that the sitemap does not list (old links, typos, pages missing from the sitemap). */
export function unlistedPages(paths: string[], pages: PageRow[]): PageRow[] {
  const listed = new Set(paths.map(normPath));
  return pages.filter((p) => !listed.has(normPath(p.path)));
}
