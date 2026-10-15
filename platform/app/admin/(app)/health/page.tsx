import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/app/components/PageHeader";
import { KpiTile } from "@/app/components/KpiTile";
import { TrendChart } from "@/app/components/TrendChart";
import { Icon } from "@/app/components/Icon";
import { Note } from "@/app/components/Note";
import { getSession } from "@/lib/session";
import { dayMonth } from "@/lib/dates";
import { fmtBytes, hhmm, pktDate, pktMidnight, usagePct, usageTone } from "@/lib/admin-ops";
import { AGENT_CATALOG } from "@/lib/admin-agents";
import { AUDIT_PAGE, auditSince, consoleUrl, healthProblems } from "@/lib/health";
import { fmtTokens } from "@/lib/pipeline";
import { AgentBudgetForm } from "./AgentBudget";
import { AuditButton, AuditSheet } from "./AuditLog";
import type { AuditRow } from "./actions";
import { QueueVolume } from "../approvals/QueueVolume";

export const metadata: Metadata = { title: "Health" };

type Usage = { db_bytes: number; db_cap: number; storage_bytes: number; storage_cap: number };
type Push = { sent_at: string | null; error: string | null; claimed_at: string | null; kind: string };
type AgentUsage = { budget: number; used_today: number; enabled: boolean; paused: boolean; days: { day: string; tokens: number; runs: number; cost_usd: number }[] };
type FailedBeat = { agent: string; last_run: string; detail: Record<string, unknown> | null };
type Send = { status: string; claimed_at: string | null; send_error: string | null };

/** Health (design review Phase 3): problems first, or one "All systems normal" line; then the usage numbers, the
 *  model-call, queue and agent-token charts; the audit log lives in a Sheet. Recent runs are on Agents. */
export default async function HealthPage() {
  const { supabase } = await getSession();
  const now = new Date();
  const days = Array.from({ length: 14 }, (_, i) => 13 - i); // days back
  const [usage, agentUse, push, failedRuns, sends, audit, auditKeys, ...llmDays] = await Promise.all([
    supabase.rpc("platform_usage"),
    supabase.rpc("agent_usage_daily", { p_days: 14 }),
    supabase.from("push_queue").select("sent_at, error, claimed_at, kind").gte("created_at", new Date(now.getTime() - 86_400_000).toISOString()).limit(1000),
    supabase.from("agent_heartbeats").select("agent, last_run, detail").eq("status", "error").gte("last_run", new Date(now.getTime() - 86_400_000).toISOString()).limit(500),
    supabase.from("approval_queue").select("status, claimed_at, send_error").in("status", ["failed", "sending"]).limit(500),
    supabase.from("actions").select("id, at, agent, action, target_table, cost_usd").gte("at", auditSince("24h", now)).order("at", { ascending: false }).range(0, AUDIT_PAGE),
    supabase.from("actions").select("agent, action").gte("at", auditSince("7d", now)).order("at", { ascending: false }).limit(5000),
    ...days.map((b) =>
      supabase.from("actions").select("id", { count: "exact", head: true }).eq("action", "llm_call").gte("at", pktMidnight(now, b)).lt("at", b ? pktMidnight(now, b - 1) : new Date(now.getTime() + 60_000).toISOString()),
    ),
  ]);
  const llm = llmDays.map((r) => (r as { count: number | null }).count ?? 0);
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
  const agentLabels = new Map(AGENT_CATALOG.flatMap(([, a]) => a.filter((x) => x.hb).map((x) => [x.hb as string, x.label] as const)));
  const dash = consoleUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const problems = healthProblems({
    failedBeats: (failedRuns.data ?? []) as FailedBeat[],
    labels: agentLabels,
    sends: (sends.data ?? []) as Send[],
    meters,
    usageError: !u,
    agentPaused: Boolean(au?.enabled && au.paused),
    consoleUrl: dash,
    now,
  });
  const checkFailed = failedRuns.error || sends.error;
  const keys = (auditKeys.data ?? []) as { agent: string; action: string }[];
  const actors = [...new Set(keys.map((k) => k.agent))].sort();
  const kinds = [...new Set(keys.map((k) => k.action))].sort();
  const auditRows = (audit.data ?? []) as AuditRow[];

  return (
    <>
      <PageHeader
        title="Health"
        sub="Problems first, then model calls, the approval queue, the project agent's budget and the free-plan caps."
        actions={
          <>
            <Link className="btn btn-secondary btn-sm" href="/agents">
              <Icon name="cpu" className="i-sm" />
              Agent runs
            </Link>
            <AuditButton />
          </>
        }
      />

      {checkFailed && (
        <Note tone="error" retry>
          Couldn&apos;t run every check (agent runs or sends); the list below may be incomplete.
        </Note>
      )}
      {problems.length ? (
        <section className="panel health-problems" aria-label="Problems">
          <div className="panel-head">
            <h2>
              Problems <span className="c-3">· {problems.length} · checked {hhmm(now.toISOString())}</span>
            </h2>
          </div>
          <div className="rows">
            {problems.map((p) => {
              const body = (
                <>
                  <span className={`ic ${p.tone}`}>
                    <Icon name="alert" className="i-sm" />
                  </span>
                  <span className="grow">
                    <span className="t">{p.title}</span>
                    <span className="m">{p.detail}</span>
                  </span>
                  <span className="when">
                    <strong>{p.action} →</strong>
                  </span>
                </>
              );
              return p.external ? (
                <a key={p.key} href={p.href} target="_blank" rel="noopener noreferrer">
                  {body}
                </a>
              ) : (
                <Link key={p.key} href={p.href}>
                  {body}
                </Link>
              );
            })}
          </div>
        </section>
      ) : (
        <p className="health-ok" role="status">
          <span className="dot" aria-hidden="true" />
          All systems normal · checked {hhmm(now.toISOString())}
        </p>
      )}

      <section className="kpi kpi-4 health-kpi">
        {meters.map((m) => {
          const pct = usagePct(m.used, m.cap);
          const tone = usageTone(pct);
          return (
            <KpiTile
              key={m.label}
              label={`${m.label} · free plan`}
              value={`${pct}%`}
              context={
                <>
                  <span className="meter tile-meter" data-tone={tone}>
                    <span style={{ width: `${Math.min(100, pct)}%` }} />
                  </span>
                  {fmtBytes(m.used)} of {fmtBytes(m.cap)}
                </>
              }
            />
          );
        })}
        {!u && <KpiTile label="Database and storage" value="–" error />}
        <KpiTile label="Push · last 24 h" value={pushStats.sent} context={`${pushStats.pending} waiting · ${pushStats.failed} failed`} />
        <KpiTile label="LLM calls · today" value={llm[13]} context={`${llm.reduce((a, b) => a + b, 0)} in 14 days`} />
      </section>

      <section className="panel chart-panel health-chart" aria-label="LLM calls per day">
        <div className="row between">
          <h2 className="t-16">LLM calls · last 14 days</h2>
          <span className="c-3 t-12 mono">{llm[13]} today</span>
        </div>
        <TrendChart labels={labels} series={[{ name: "Calls", data: llm }]} aria="LLM calls per day, last 14 days" />
      </section>

      {/* moved here from Approvals (design review D5) */}
      <QueueVolume />

      <section className="panel chart-panel health-chart" id="budget" aria-label="Project agent tokens per day">
        <div className="row between wrap g-10">
          <h2 className="t-16">Project agent · tokens per day</h2>
          {au ? (
            <span className={`pill ${au.paused ? "pill-warn" : "pill-good"}`}>
              <span className="dot" />
              {!au.enabled ? "off" : au.paused ? "paused: budget reached" : "running"} · {fmtTokens(au.used_today)} of {fmtTokens(au.budget)} today
            </span>
          ) : null}
        </div>
        {au ? (
          <>
            <div className="meter mt-10" data-tone={usageTone(auPct)}>
              <span style={{ width: `${Math.min(100, auPct)}%` }} />
            </div>
            <TrendChart
              labels={au.days.map((d, i) => (i === au.days.length - 1 ? "Today" : i === 0 || i === 7 ? dayMonth(d.day) : ""))}
              series={[{ name: "Tokens", data: au.days.map((d) => d.tokens) }]}
              aria="Project agent tokens per day, last 14 days"
            />
            <div className="c-3 t-12 mt-6">
              {au.days.reduce((s, d) => s + d.runs, 0)} runs · ${au.days.reduce((s, d) => s + Number(d.cost_usd || 0), 0).toFixed(2)} reported cost, last 14 days
            </div>
            <div className="mt-14">
              <AgentBudgetForm budget={au.budget} enabled={au.enabled} />
            </div>
          </>
        ) : (
          <Note tone="error" retry>
            Couldn&apos;t read the project agent&apos;s usage.
          </Note>
        )}
      </section>

      <AuditSheet
        initial={audit.error ? { rows: [], more: false, error: "Couldn't read the audit log." } : { rows: auditRows.slice(0, AUDIT_PAGE), more: auditRows.length > AUDIT_PAGE }}
        actors={actors}
        kinds={kinds}
      />
    </>
  );
}
