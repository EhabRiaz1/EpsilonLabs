import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  changeText, conversion, countryLabel, dayLabels, deviceLabel, funnelRows, normPath, parseSitemap, pct, sitemapTree,
  sourceLabel, unlistedPages, utmLabel, weekTrend, zeroViewPages, type DayRow,
} from "./analytics";

describe("funnel", () => {
  const f = { visits: 200, start: 40, steps: [2, 1, 3, 4, 5, 6, 7].map((s) => ({ step: s, sessions: [40, 30, 20, 15, 12, 10, 8][s - 1] })), submit: 6 };

  it("orders the steps and gives each row its share of visits and of the row before", () => {
    const rows = funnelRows(f);
    expect(rows.map((r) => r.key)).toEqual(["visits", "start", "step-1", "step-2", "step-3", "step-4", "step-5", "step-6", "step-7", "submit"]);
    expect(rows[0]).toMatchObject({ sessions: 200, ofVisits: 100, ofPrev: null });
    expect(rows[1]).toMatchObject({ label: "Opened /start", ofVisits: 20, ofPrev: 20 });
    expect(rows[3]).toMatchObject({ label: "Step 2 · The work", sessions: 30, ofPrev: 75 });
    expect(rows.at(-1)).toMatchObject({ label: "Sent the enquiry", sessions: 6, ofPrev: 75, ofVisits: 3 });
  });

  it("never divides by zero", () => {
    const rows = funnelRows({ visits: 0, start: 0, steps: [], submit: 0 });
    expect(rows.every((r) => r.ofVisits === 0 && (r.ofPrev === null || r.ofPrev === 0))).toBe(true);
    expect(funnelRows(null)).toEqual([]);
    expect(conversion({ visits: 5, start: 0, steps: [], submit: 0 })).toBe("–");
    expect(conversion(f)).toBe("15.0%");
    expect(pct(1, 3)).toBe(33);
  });
});

describe("labels", () => {
  it("names sources, campaigns, devices and countries", () => {
    expect(sourceLabel("")).toBe("Direct / unknown");
    expect(sourceLabel("www.epsilon-labs.co")).toBe("epsilon-labs.co (new tab)");
    expect(sourceLabel("www.google.com")).toBe("google.com");
    expect(utmLabel({ source: "linkedin", medium: "", campaign: "oct" })).toBe("linkedin / oct");
    expect(utmLabel({ source: "", medium: "", campaign: "" })).toBe("(empty tags)");
    expect(deviceLabel("mobile")).toBe("Phone");
    expect(deviceLabel("unknown")).toBe("Unknown");
    expect(countryLabel("PK")).toBe("Pakistan");
    expect(countryLabel("")).toBe("Unknown");
  });
});

describe("daily trend", () => {
  const days: DayRow[] = Array.from({ length: 14 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, "0")}`, views: i < 7 ? 10 : 15, sessions: 1 }));

  it("compares the last 7 days with the 7 before", () => {
    expect(weekTrend(days)).toEqual({ last7: 105, prev7: 70, change: 50 });
    expect(changeText(50, 70)).toBe("+50% on last week");
    expect(changeText(-8, 70)).toBe("−8% on last week");
    expect(changeText(null, 0)).toBe("first week of data");
    expect(weekTrend(days.slice(0, 5)).change).toBeNull();
  });

  it("labels the first, middle and last day only", () => {
    const l = dayLabels(days);
    expect(l[0]).toBe("1 Oct");
    expect(l[7]).toBe("8 Oct");
    expect(l[13]).toBe("Today");
    expect(l.filter(Boolean)).toHaveLength(3);
  });
});

describe("sitemap", () => {
  it("parses the site's real sitemap.xml into one path per page", () => {
    const xml = readFileSync(new URL("../../sitemap.xml", import.meta.url), "utf8");
    const paths = parseSitemap(xml);
    expect(paths.length).toBe((xml.match(/<loc>/g) ?? []).length);
    expect(paths).toContain("/");
    expect(paths).toContain("/start/");
    expect(paths.every((p) => p.startsWith("/") && !p.includes("epsilon-labs.co"))).toBe(true);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("decodes entities, skips junk and duplicates", () => {
    const xml = `<urlset><url><loc> https://x.co/a/?q=1&amp;b=2 </loc></url><url><loc>https://x.co/a</loc></url>
      <url><loc>not a url</loc></url><url><loc>https://x.co/llms.txt</loc></url><url><loc>https://x.co/b/index.html</loc></url></urlset>`;
    expect(parseSitemap(xml)).toEqual(["/a/", "/llms.txt", "/b/"]);
    expect(parseSitemap("")).toEqual([]);
  });

  it("spells every page one way", () => {
    expect(normPath("/about")).toBe("/about/");
    expect(normPath("/about/")).toBe("/about/");
    expect(normPath("/about/index.html")).toBe("/about/");
    expect(normPath("//work//x")).toBe("/work/x/");
    expect(normPath("/catalogue.json")).toBe("/catalogue.json");
    expect(normPath("")).toBe("/");
  });

  it("builds a tree with views, totals and the pages nobody viewed", () => {
    const paths = ["/", "/hardware/", "/hardware/pcb-design/", "/hardware/sensing/", "/products/crm/", "/start/"];
    const views = [
      { path: "/", views: 10, sessions: 8 },
      { path: "/hardware", views: 4, sessions: 4 },
      { path: "/hardware/pcb-design/", views: 2, sessions: 1 },
      { path: "/start/", views: 5, sessions: 5 },
      { path: "/old-page/", views: 3, sessions: 3 },
    ];
    const tree = sitemapTree(paths, views);
    expect(tree.listed).toBe(true);
    expect(tree.views).toBe(10);
    expect(tree.total).toBe(21);                                         // /old-page/ is not in the sitemap
    expect(tree.children.map((c) => c.name)).toEqual(["hardware", "products", "start"]);
    const hw = tree.children[0];
    expect(hw).toMatchObject({ views: 4, total: 6 });
    expect(tree.children[1]).toMatchObject({ listed: false, views: 0 });  // a folder only because /products/crm/ is listed
    expect(zeroViewPages(tree)).toEqual(["/hardware/sensing/", "/products/crm/"]);
    expect(unlistedPages(paths, views)).toEqual([{ path: "/old-page/", views: 3, sessions: 3 }]);
  });
});
