import type { Metadata } from "next";
import { MenuButton } from "@/app/components/ShellControls";
import { AutoRefresh } from "@/app/components/AutoRefresh";
import { getSession } from "@/lib/session";
import { ago, hhmm, pktMidnight, until, workerOnline } from "@/lib/admin-ops";
import { AGENT_CATALOG, agentRow, PLANNED_AGENTS, STATE_PILL, type Beat, type JobSnap } from "@/lib/admin-agents";
import { stamp } from "@/lib/dates";
import { RunNow } from "./RunNow";

export const metadata: Metadata = { title: "Agents" };

type Job = { id: string; params: { agent?: string }; status: string; created_at: string; finished_at: string | null; error: string | null };
const JOB_PILL: Record<string, string> = { queued: "pill-warn", claimed: "pill-accent", running: "pill-accent", done: "pill-good", failed: "pill-bad", expired: "" };

export default async function AgentsPage() {
  const { supabase } = await getSession();
  const now = new Date();
  const entries = AGENT_CATALOG.flatMap(([cat, items]) => items.map((a) => ({ cat, a })));
  const [worker, calls, jobs, ...beats] = await Promise.all([
    supabase.from("agent_heartbeats").select("agent, last_run, status, detail").eq("agent", "worker").order("last_run", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("actions").select("agent").eq("action", "llm_call").gte("at", pktMidnight(now)).limit(1000),
    supabase.from("jobs").select("id, params, status, created_at, finished_at, error").eq("type", "run_agent").order("created_at", { ascending: false }).limit(8),
    ...entries.map(({ a }) =>
      a.hb
        ? supabase.from("agent_heartbeats").select("agent, last_run, status, detail").eq("agent", a.hb).order("last_run", { ascending: false }).limit(8)
        : Promise.resolve({ data: [] as Beat[] }),
    ),
  ]);
  const w = worker.data as Beat | null;
  const online = workerOnline(w?.last_run, now);
  const snap = ((w?.detail as { jobs?: Record<string, JobSnap> } | null)?.jobs ?? null) as Record<string, JobSnap> | null;
  const perAgent = new Map<string, number>();
  for (const r of (calls.data ?? []) as { agent: string }[]) perAgent.set(r.agent, (perAgent.get(r.agent) ?? 0) + 1);
  const rows = entries.map(({ cat, a }, i) => ({
    cat,
    ...agentRow(a, (beats[i]?.data ?? []) as Beat[], snap?.[a.job ?? ""] ?? null, perAgent.get(a.hb ?? a.key) ?? 0, now),
  }));
  const counts = { ok: 0, amber: 0, red: 0, idle: 0 };
  for (const r of rows) counts[r.state] += 1;
  const soonest = rows.filter((r) => r.next).sort((x, y) => String(x.next).localeCompare(String(y.next)))[0];
  const recentJobs = (jobs.data ?? []) as Job[];

  return (
    <>
      <header className="page-head">
        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
          <MenuButton />
          <div>
            <h1 className="display">Agents</h1>
            <div className="sub">
              {counts.ok} healthy · {counts.amber} need a look · {counts.red} failing · {counts.idle} idle
              {soonest?.next ? ` · next: ${soonest.label} ${until(soonest.next, now)}` : ""}
            </div>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <span className={`pill ${online ? "pill-good" : "pill-warn"}`}>
            <span className={`dot${online ? " live" : ""}`} />
            {online ? `Worker online · heartbeat ${ago(w?.last_run, now)} ago` : w ? `Worker offline since ${hhmm(w.last_run)} · Run now is queued until the Mac is back` : "Worker not running yet"}
          </span>
          <AutoRefresh seconds={30} />
        </div>
      </header>

      {AGENT_CATALOG.map(([cat]) => (
        <section key={cat} className="panel" style={{ marginBottom: 14, overflow: "hidden" }}>
          <div className="panel-head"><h2>{cat}</h2></div>
          <table className="table">
            <tbody>
              {rows.filter((r) => r.cat === cat).map((r) => (
                <tr key={r.key}>
                  <td>
                    <div className="row wrap" style={{ gap: 8 }}>
                      <span className="w-600">{r.label}</span>
                      <span className={`pill ${STATE_PILL[r.state]}`}><span className={`dot${r.running ? " live" : ""}`} />{r.text}</span>
                    </div>
                    <div className="c-3 t-12" style={{ marginTop: 4 }}>{r.what}</div>
                    {(r.summary || r.issue) && (
                      <div className="t-12" style={{ marginTop: 4 }}>
                        {r.summary && <span className="c-2">{r.summary}</span>}
                        {r.issue && <span className="c-bad">{r.summary ? " · " : ""}{r.issue}</span>}
                      </div>
                    )}
                    <div className="hist" aria-label={`Last runs: ${r.history.join(", ") || "none"}`}>
                      {r.history.map((h, k) => <i key={k} data-s={h} />)}
                    </div>
                  </td>
                  <td className="hide-m t-12 c-2" style={{ whiteSpace: "nowrap" }}>
                    <div>{r.cadence || "—"}</div>
                    <div className="c-3">last {r.last === "never" ? "never" : `${r.last} ago`}{r.calls ? ` · ${r.calls} LLM calls today` : ""}</div>
                    {r.next && <div className="c-3">next {hhmm(r.next)} · {until(r.next, now)}</div>}
                    {r.exit && r.exit !== "0" && <div className="c-warn">last exit {r.exit}</div>}
                  </td>
                  <td style={{ textAlign: "right", width: 1 }}>
                    {r.runnable && r.job ? <RunNow agent={r.job} label={r.label} online={online} /> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <div className="grid-main" style={{ marginTop: 0 }}>
        <section className="panel">
          <div className="panel-head"><h2>Run-now requests</h2></div>
          <div className="list-rows" style={{ padding: "0 18px 14px" }}>
            {recentJobs.length ? recentJobs.map((j) => (
              <div key={j.id}>
                <span className={`pill ${JOB_PILL[j.status] ?? ""}`}><span className="dot" />{j.status === "queued" && !online ? "queued until the Mac is back" : j.status}</span>
                <span className="grow">{j.params?.agent ?? "?"}</span>
                <span className="c-3 t-12">{stamp(j.created_at)}{j.error ? ` · ${j.error}` : ""}</span>
              </div>
            )) : <p className="c-3 t-13">None yet. Run now starts the job on the Mac within a minute.</p>}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Planned</h2></div>
          <div className="list-rows" style={{ padding: "0 18px 14px" }}>
            {PLANNED_AGENTS.map(([n, d]) => (
              <div key={n}><span className="grow"><strong className="t-13">{n}</strong><span className="c-3 t-12" style={{ display: "block" }}>{d}</span></span></div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
