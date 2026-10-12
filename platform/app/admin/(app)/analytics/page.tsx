import type { Metadata } from "next";
import { MenuButton } from "@/app/components/ShellControls";
import { AutoRefresh } from "@/app/components/AutoRefresh";
import { Sparkline } from "@/app/components/Sparkline";
import { TrendChart } from "@/app/components/TrendChart";
import { getSession } from "@/lib/session";
import {
  changeText, conversion, countryLabel, dayLabels, deviceLabel, funnelRows, parseSitemap, pct, sitemapTree, sourceLabel,
  unlistedPages, utmLabel, weekTrend, zeroViewPages,
  type DayRow, type Funnel, type PageRow, type TreeNode,
} from "@/lib/analytics";

export const metadata: Metadata = { title: "Analytics" };

// The site's own sitemap, fetched from the live site (cached for an hour). SITE_URL overrides it for a preview.
const SITE = (process.env.SITE_URL || "https://epsilon-labs.co").replace(/\/$/, "");

type Sources = { referrers: { host: string; sessions: number }[]; utm: { source: string; medium: string; campaign: string; sessions: number }[]; sessions: number };
type Live = { sessions: number; pages: { path: string; sessions: number }[] };
type Breakdown = { devices: { device: string; sessions: number }[]; countries: { country: string; sessions: number }[] };

async function sitemapPaths(): Promise<{ paths: string[]; error: string | null }> {
  try {
    const r = await fetch(`${SITE}/sitemap.xml`, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { paths: [], error: `sitemap.xml answered ${r.status}` };
    const paths = parseSitemap(await r.text());
    return { paths, error: paths.length ? null : "sitemap.xml lists no pages" };
  } catch (e) {
    return { paths: [], error: `couldn't fetch sitemap.xml (${e instanceof Error ? e.message : "error"})` };
  }
}

function Bars({ rows, empty }: { rows: { key: string; label: string; value: number; note?: string }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <div className="an-rows"><p className="c-3 t-13" style={{ padding: "6px 0 4px" }}>{empty}</p></div>;
  return (
    <div className="an-rows">
      {rows.map((r) => (
        <div key={r.key} className="an-row">
          <span className="truncate">{r.label}</span>
          <span className="num c-2">{r.value.toLocaleString("en-US")}{r.note ? <span className="c-3"> · {r.note}</span> : null}</span>
          <div className="meter" aria-hidden="true"><span style={{ width: `${pct(r.value, max)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function Tree({ node }: { node: TreeNode }) {
  const label = node.path === "/" ? "/ (home)" : `${node.name}/`;
  const row = (
    <span className={`node${node.listed ? (node.views === 0 ? " zero" : "") : " folder"}`}>
      <span className="name">{node.listed ? label : `${label} (not listed)`}</span>
      {node.listed && node.views === 0 ? <span className="pill pill-bad">0 views</span> : null}
      <span className="views c-2">
        {node.listed ? node.views.toLocaleString("en-US") : "–"}
        {node.children.length ? <span className="c-3"> · {node.total.toLocaleString("en-US")} incl. below</span> : null}
      </span>
    </span>
  );
  if (!node.children.length) return <li>{row}</li>;
  return (
    <li>
      <details open={node.path === "/"}>
        <summary>{row}</summary>
        <ul className="tree">{node.children.map((c) => <Tree key={c.path} node={c} />)}</ul>
      </details>
    </li>
  );
}

export default async function AnalyticsPage() {
  const { supabase } = await getSession();
  const [pages30, all30, sources, funnel, daily, live, breakdown, map] = await Promise.all([
    supabase.rpc("analytics_top_pages", { p_days: 30, p_limit: 15 }),
    supabase.rpc("analytics_top_pages", { p_days: 30, p_limit: 1000 }),
    supabase.rpc("analytics_sources", { p_days: 30 }),
    supabase.rpc("analytics_funnel", { p_days: 30 }),
    supabase.rpc("analytics_daily", { p_days: 30 }),
    supabase.rpc("analytics_live", { p_minutes: 5 }),
    supabase.rpc("analytics_breakdown", { p_days: 30 }),
    sitemapPaths(),
  ]);
  const failed = [pages30, all30, sources, funnel, daily, live, breakdown].find((r) => r.error);
  const top = (pages30.data ?? []) as PageRow[];
  const allPages = (all30.data ?? []) as PageRow[];
  const src = (sources.data ?? { referrers: [], utm: [], sessions: 0 }) as Sources;
  const f = (funnel.data ?? null) as Funnel | null;
  const days = (daily.data ?? []) as DayRow[];
  const now = (live.data ?? { sessions: 0, pages: [] }) as Live;
  const br = (breakdown.data ?? { devices: [], countries: [] }) as Breakdown;
  const views = weekTrend(days, "views");
  const sessions = weekTrend(days, "sessions");
  const tree = sitemapTree(map.paths, allPages);
  const zero = zeroViewPages(tree);
  const unlisted = unlistedPages(map.paths, allPages).slice(0, 10);
  const funnelData = funnelRows(f);

  return (
    <>
      <header className="page-head">
        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
          <MenuButton />
          <div>
            <h1 className="display">Analytics</h1>
            <div className="sub">epsilon-labs.co, last 30 days. No cookies and no IP addresses; visitors with Do-Not-Track or GPC are not counted.</div>
          </div>
        </div>
        <AutoRefresh seconds={30} />
      </header>

      {failed?.error ? (
        <div className="panel panel-pad c-bad t-13" role="alert" style={{ marginBottom: 14 }}>Couldn&apos;t load analytics: {failed.error.message}</div>
      ) : null}

      <section className="kpi kpi-4">
        <div className="panel tile">
          <div className="l">
            <div className="k"><span className="dot live c-good" aria-hidden="true" /> Live now · 5 min</div>
            <div className="v big num">{now.sessions}</div>
            <div className="d truncate">{now.pages[0] ? `${now.pages[0].path} · ${now.pages[0].sessions}` : "nobody on the site"}</div>
          </div>
        </div>
        <div className="panel tile">
          <div className="l">
            <div className="k">Page views · 7 days</div>
            <div className="v big num">{views.last7.toLocaleString("en-US")}</div>
            <div className={`d${views.change !== null && views.change < 0 ? " down" : views.change ? " up" : ""}`}>{changeText(views.change, views.prev7)}</div>
          </div>
          <Sparkline data={days.map((d) => d.views)} label="Page views per day, last 30 days" />
        </div>
        <div className="panel tile">
          <div className="l">
            <div className="k">Visits · 7 days</div>
            <div className="v big num">{sessions.last7.toLocaleString("en-US")}</div>
            <div className={`d${sessions.change !== null && sessions.change < 0 ? " down" : sessions.change ? " up" : ""}`}>{changeText(sessions.change, sessions.prev7)}</div>
          </div>
          <Sparkline data={days.map((d) => d.sessions)} label="Visits per day, last 30 days" />
        </div>
        <div className="panel tile">
          <div className="l">
            <div className="k">/start → sent · 30 days</div>
            <div className="v big num">{conversion(f)}</div>
            <div className="d">{f ? `${f.submit} sent of ${f.start} who opened /start` : "no data"}</div>
          </div>
        </div>
      </section>

      <section className="panel an-chart" aria-label="Views per day">
        <div className="row between">
          <h2 className="t-16" style={{ fontFamily: "var(--font-sans)", fontWeight: 600 }}>Views per day · last 30 days</h2>
          <span className="c-3 t-12">{days.at(-1)?.views ?? 0} today</span>
        </div>
        <TrendChart labels={dayLabels(days)} series={[{ name: "Page views", data: days.map((d) => d.views) }, { name: "Visits", data: days.map((d) => d.sessions) }]} aria="Page views and visits per day, last 30 days" />
      </section>

      <div className="an-grid">
        <section className="panel">
          <div className="panel-head"><h2>The /start funnel</h2><span className="more c-3 t-12">visits, 30 days</span></div>
          <Bars
            empty="No visits recorded yet."
            rows={funnelData.map((r) => ({ key: r.key, label: r.label, value: r.sessions, note: r.ofPrev === null ? undefined : `${r.ofPrev}% of previous` }))}
          />
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Top pages</h2><span className="more c-3 t-12">views</span></div>
          <Bars empty="No page views yet." rows={top.map((p) => ({ key: p.path, label: p.path, value: p.views, note: `${p.sessions} visits` }))} />
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Sources</h2><span className="more c-3 t-12">first page of each visit</span></div>
          <Bars empty="No visits yet." rows={src.referrers.map((r) => ({ key: r.host || "-", label: sourceLabel(r.host), value: r.sessions }))} />
          <div className="panel-head" style={{ paddingTop: 4 }}><h2>Campaigns (utm)</h2></div>
          <Bars empty="No tagged links used yet." rows={src.utm.map((u, i) => ({ key: `${i}`, label: utmLabel(u), value: u.sessions }))} />
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Live now</h2><span className="more c-3 t-12">page each visitor is on</span></div>
          <Bars empty="Nobody in the last 5 minutes." rows={now.pages.map((p) => ({ key: p.path, label: p.path, value: p.sessions }))} />
          <div className="panel-head" style={{ paddingTop: 4 }}><h2>Devices</h2></div>
          <Bars empty="No visits yet." rows={br.devices.map((d) => ({ key: d.device, label: deviceLabel(d.device), value: d.sessions }))} />
          <div className="panel-head" style={{ paddingTop: 4 }}><h2>Countries</h2></div>
          <Bars empty="No visits yet." rows={br.countries.map((c) => ({ key: c.country || "-", label: countryLabel(c.country), value: c.sessions }))} />
        </section>
      </div>

      <section className="panel" style={{ marginTop: 14 }} aria-label="Sitemap">
        <div className="panel-head">
          <h2>Sitemap · views per page, 30 days</h2>
          <span className="more c-3 t-12">{map.paths.length} pages · {zero.length} with no views</span>
        </div>
        {map.error ? <p className="c-bad t-13" style={{ padding: "0 22px 12px" }}>{map.error}</p> : null}
        {map.paths.length ? (
          <div className="tree-root"><ul className="tree"><Tree node={tree} /></ul></div>
        ) : null}
        {unlisted.length ? (
          <>
            <div className="panel-head" style={{ paddingTop: 4 }}><h2>Viewed but not in the sitemap</h2></div>
            <Bars empty="" rows={unlisted.map((p) => ({ key: p.path, label: p.path, value: p.views }))} />
          </>
        ) : null}
      </section>
    </>
  );
}
