import type { Metadata } from "next";
import { MenuButton } from "@/app/components/ShellControls";
import { TrendChart } from "@/app/components/TrendChart";
import { getSession } from "@/lib/session";
import { dayMonth } from "@/lib/dates";
import { ago, fmtBytes, fmtDetail, pktDate, pktMidnight, usagePct, usageTone } from "@/lib/admin-ops";
import { AGENT_CATALOG, type Beat } from "@/lib/admin-agents";
import { fmtTokens } from "@/lib/pipeline";
import { AgentBudgetForm } from "./AgentBudget";
import { QueueVolume } from "../approvals/QueueVolume";

export const metadata: Metadata = { title: "Health" };

type Act = { id: string; at: string; agent: string; action: string; target_table: string | null; target_id: string | null; cost_usd: number | null };
type Usage = { db_bytes: number; db_cap: number; storage_bytes: number; storage_cap: number };
type Push = { sent_at: string | null; error: string | null; claimed_at: string | null; kind: string };
type AgentUsage = { budget: number; used_today: number; enabled: boolean; paused: boolean; days: { day: string; tokens: number; runs: number; cost_usd: number }[] };
const BEAT_PILL: Record<string, string> = { ok: "pill-good", warn: "pill-warn", error: "pill-bad" };

export default async function HealthPage() {
  const { supabase } = await getSession();
  const now = new Date();
  const names = [...new Set(AGENT_CATALOG.flatMap(([, a]) => a.map((x) => x.hb)).filter(Boolean))] as string[];
  const days = Array.from({ length: 14 }, (_, i) => 13 - i); // days back
  const [usage, agentUse, acts, push, ...rest] = await Promise.all([
    supabase.rpc("platform_usage"),
    supabase.rpc("agent_usage_daily", { p_days: 14 }),
    supabase.from("actions").select("id, at, agent, action, target_table, target_id, cost_usd").order("at", { ascending: false }).limit(50),
    supabase.from("push_queue").select("sent_at, error, claimed_at, kind").gte("created_at", new Date(now.getTime() - 86_400_000).toISOString()).limit(1000),
    ...days.map((b) =>
      supabase.from("actions").select("id", { count: "exact", head: true }).eq("action", "llm_call").gte("at", pktMidnight(now, b)).lt("at", b ? pktMidnight(now, b - 1) : new Date(now.getTime() + 60_000).toISOString()),
    ),
    ...names.map((n) => supabase.from("agent_heartbeats").select("agent, last_run, status, detail").eq("agent", n).order("last_run", { ascending: false }).limit(20)),
  ]);
  const llm = rest.slice(0, days.length).map((r) => (r as { count: number | null }).count ?? 0);
  const runs = rest.slice(days.length).map((r) => ((r as { data: Beat[] | null }).data ?? []) as Beat[]);
  const u = usage.data as Usage | null;
  const meters = u
    ? [
        { label: "Database", used: u.db_bytes, cap: u.db_cap },
        { label: "Storage", used: u.storage_bytes, cap: u.storage_cap },
      ]
    : [];
  const pushes = (push.data ?? []) as Push[];
  const pushStats = {
    sent: pushes.filter((p) => p.sent_at).length,
    pending: pushes.filter((p) => !p.sent_at && !p.error).length,
    failed: pushes.filter((p) => p.error).length,
  };
  const au = agentUse.data as AgentUsage | null;
  const auPct = au ? usagePct(au.used_today, au.budget) : 0;
  const labels = days.map((b, i) => (i === 13 ? "Today" : i === 0 || i === 7 ? dayMonth(pktDate(new Date(now.getTime() - b * 86_400_000))) : ""));

  return (
    <>
      <header className="page-head">
        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
          <MenuButton />
          <div>
            <h1 className="display">Health</h1>
            <div className="sub">Model calls, agent runs, the audit log and the free-plan caps (warning at 70%).</div>
          </div>
        </div>
      </header>

      <section className="kpi kpi-3">
        {meters.map((m) => {
          const pct = usagePct(m.used, m.cap);
          const tone = usageTone(pct);
          return (
            <div key={m.label} className="panel tile">
              <div className="l">
                <div className="k">{m.label} · free plan</div>
                <div className="v big num">{pct}<span className="dec">%</span></div>
                <div className="meter" data-tone={tone} style={{ marginTop: 8 }}><span style={{ width: `${Math.min(100, pct)}%` }} /></div>
                <div className={`d${tone === "good" ? "" : " down"}`}>{fmtBytes(m.used)} of {fmtBytes(m.cap)}{tone !== "good" ? " · time to upgrade to Pro" : ""}</div>
              </div>
            </div>
          );
        })}
        {!u && <div className="panel tile"><div className="l"><div className="k">Usage</div><div className="d">Couldn&apos;t read DB and Storage size.</div></div></div>}
        <div className="panel tile">
          <div className="l">
            <div className="k">Push · last 24 h</div>
            <div className="v big num">{pushStats.sent}</div>
            <div className="d">{pushStats.pending} waiting · {pushStats.failed} failed</div>
          </div>
        </div>
      </section>

      <section className="panel chart-panel" style={{ marginTop: 14 }} aria-label="LLM calls per day">
        <div className="row between">
          <h2 className="t-16" style={{ fontFamily: "var(--font-sans)", fontWeight: 600 }}>LLM calls · last 14 days</h2>
          <span className="c-3 t-12">{llm[13]} today</span>
        </div>
        <TrendChart labels={labels} series={[{ name: "Calls", data: llm }]} aria="LLM calls per day, last 14 days" />
      </section>

      {/* moved here from Approvals (design review D5) */}
      <QueueVolume />

      <section className="panel chart-panel" style={{ marginTop: 14 }} aria-label="Project agent tokens per day">
        <div className="row between wrap" style={{ gap: 10 }}>
          <h2 className="t-16" style={{ fontFamily: "var(--font-sans)", fontWeight: 600 }}>Project agent · tokens per day</h2>
          {au ? (
            <span className={`pill ${au.paused ? "pill-warn" : "pill-good"}`}>
              <span className="dot" />
              {!au.enabled ? "off" : au.paused ? "paused: budget reached" : "running"} · {fmtTokens(au.used_today)} of {fmtTokens(au.budget)} today
            </span>
          ) : (
            <span className="c-3 t-12">Couldn&apos;t read agent usage.</span>
          )}
        </div>
        {au && (
          <>
            <div className="meter" data-tone={usageTone(auPct)} style={{ marginTop: 10 }}><span style={{ width: `${Math.min(100, auPct)}%` }} /></div>
            <TrendChart
              labels={au.days.map((d, i) => (i === au.days.length - 1 ? "Today" : i === 0 || i === 7 ? dayMonth(d.day) : ""))}
              series={[{ name: "Tokens", data: au.days.map((d) => d.tokens) }]}
              aria="Project agent tokens per day, last 14 days"
            />
            <div className="c-3 t-12" style={{ marginTop: 6 }}>
              {au.days.reduce((s, d) => s + d.runs, 0)} runs · ${au.days.reduce((s, d) => s + Number(d.cost_usd || 0), 0).toFixed(2)} reported cost, last 14 days
            </div>
            <div style={{ marginTop: 14 }}><AgentBudgetForm budget={au.budget} enabled={au.enabled} /></div>
          </>
        )}
      </section>

      <div className="grid-main">
        <section className="panel" style={{ overflow: "hidden" }}>
          <div className="panel-head"><h2>Recent runs</h2></div>
          {names.map((n, i) => (
            <details key={n} className="runs" open={runs[i]?.[0]?.status === "error"}>
              <summary>
                <span className="w-600">{n}</span>
                {runs[i]?.[0] ? (
                  <span className={`pill ${BEAT_PILL[runs[i][0].status] ?? ""}`}><span className="dot" />{runs[i][0].status} · {ago(runs[i][0].last_run, now)} ago</span>
                ) : (
                  <span className="c-3 t-12">no runs</span>
                )}
              </summary>
              <div className="list-rows" style={{ padding: "0 18px 10px" }}>
                {(runs[i] ?? []).map((b, k) => {
                  const [counts, err] = fmtDetail(b.detail);
                  return (
                    <div key={k} className="t-12">
                      <span className={`pill ${BEAT_PILL[b.status] ?? ""}`}><span className="dot" />{b.status}</span>
                      <span className="grow c-2 truncate">{counts || "—"}{err ? <span className="c-bad"> · {err}</span> : null}</span>
                      <span className="c-3">{ago(b.last_run, now)}</span>
                    </div>
                  );
                })}
              </div>
            </details>
          ))}
        </section>

        <section className="panel" style={{ overflow: "hidden" }}>
          <div className="panel-head"><h2>Recent actions</h2><span className="more c-3 t-12">audit log</span></div>
          <div className="list-rows" style={{ padding: "0 18px 14px" }}>
            {((acts.data ?? []) as Act[]).map((a) => (
              <div key={a.id} className="t-12">
                <span className="pill pill-mono">{a.agent}</span>
                <span className="grow truncate">{a.action.replace(/_/g, " ")}{a.target_table ? <span className="c-3"> · {a.target_table}</span> : null}</span>
                <span className="c-3">{a.cost_usd ? `$${Number(a.cost_usd).toFixed(3)} · ` : ""}{ago(a.at, now)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
