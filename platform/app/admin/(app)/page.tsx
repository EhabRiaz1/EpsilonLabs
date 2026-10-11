import type { Metadata } from "next";
import Link from "next/link";
import { MenuButton } from "@/app/components/ShellControls";
import { AutoRefresh } from "@/app/components/AutoRefresh";
import { Icon } from "@/app/components/Icon";
import type { IconName } from "@/app/components/icons";
import { firstName, getSession } from "@/lib/session";
import { greeting, longDate } from "@/lib/dates";
import { ago, hhmm, isVerify, money, pktMidnight, until, workerOnline } from "@/lib/admin-ops";
import { AGENT_CATALOG, agentRow, STATE_PILL, type Beat, type JobSnap } from "@/lib/admin-agents";

export const metadata: Metadata = { title: "Today" };

const TZ = "Asia/Karachi"; // the founder's clock (Epsilon OS runs on PKT)
const SCHEDULE: [string, string][] = [
  ["prospector", "Prospector"], ["tenders", "Tender scan"], ["brief", "Morning brief"], ["outreach", "Outreach sends"],
  ["inbox", "Inbox"], ["outbox", "Outbox"], ["backup", "Backup"],
];
type Touch = { type: string; direction: string; deal_id: string | null; classifier: { label?: string } | null; occurred_at: string };
const sum = (rows: { value_usd: number | string | null }[] | null) => (rows ?? []).reduce((s, d) => s + Number(d.value_usd ?? 0), 0);

export default async function AdminToday() {
  const { supabase, claims } = await getSession();
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const week = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const midnight = pktMidnight(now);
  const entries = AGENT_CATALOG.flatMap(([, a]) => a).filter((a) => a.hb);
  const [touches, quotes, collected, won, pending, held, failed, sending, intake, tickets, calls, settings, worker, lastSent, decided, ...beats] =
    await Promise.all([
      supabase.from("touches").select("type, direction, deal_id, classifier, occurred_at").gte("occurred_at", since).in("type", ["human_reply", "sent"]).limit(1000),
      supabase.from("deals").select("value_usd").eq("stage", "quote_out").limit(1000),
      supabase.from("deals").select("value_usd").gte("collected_at", since).limit(1000),
      supabase.from("deals").select("value_usd").eq("stage", "won").gte("closed_at", "2026-10-01").limit(1000),
      supabase.from("approval_queue").select("id", { count: "exact", head: true }).eq("status", "pending").eq("held", false),
      supabase.from("approval_queue").select("id", { count: "exact", head: true }).eq("status", "pending").eq("held", true),
      supabase.from("approval_queue").select("id", { count: "exact", head: true }).eq("status", "failed"),
      supabase.from("approval_queue").select("status, claimed_at, send_error").eq("status", "sending").limit(50),
      supabase.from("intake").select("id", { count: "exact", head: true }).eq("status", "new"),
      supabase.from("tickets").select("id", { count: "exact", head: true }).in("status", ["new", "triaged", "briefed", "planned", "approved", "in_progress"]),
      supabase.from("actions").select("id", { count: "exact", head: true }).eq("action", "llm_call").gte("at", midnight),
      supabase.rpc("get_settings"),
      supabase.from("agent_heartbeats").select("agent, last_run, status, detail").eq("agent", "worker").order("last_run", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("touches").select("occurred_at").eq("type", "sent").order("occurred_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("approval_queue").select("status").gte("decided_at", midnight).limit(1000),
      ...entries.map((a) => supabase.from("agent_heartbeats").select("agent, last_run, status, detail").eq("agent", a.hb as string).order("last_run", { ascending: false }).limit(1)),
    ]);
  const loadError = [touches, quotes, pending, settings].some((r) => r.error);

  // KPIs (data.kpis)
  const t = (touches.data ?? []) as Touch[];
  const human = t.filter((x) => x.type === "human_reply" && x.direction === "inbound");
  const convs = new Set(human.map((x) => x.deal_id).filter(Boolean)).size;
  const convWeek = new Set(human.filter((x) => x.occurred_at >= week).map((x) => x.deal_id).filter(Boolean)).size;
  const sent = t.filter((x) => x.type === "sent" && x.direction === "outbound").length;
  const interested = human.filter((x) => x.classifier?.label === "inquiry").length;
  const quoteRows = (quotes.data ?? []) as { value_usd: number | null }[];
  const decidedRows = (decided.data ?? []) as { status: string }[];
  const approvedToday = decidedRows.filter((r) => ["approved", "edited_approved", "edited_pending_lint", "sending", "sent"].includes(r.status)).length;
  const rejectedToday = decidedRows.filter((r) => r.status === "rejected").length;
  const trouble = (failed.count ?? 0) + ((sending.data ?? []) as { status: string; claimed_at: string | null }[]).filter((r) => isVerify(r, now)).length;
  const s = (settings.data ?? {}) as Record<string, unknown>;
  const budget = Number(s["llm.daily_budget"] ?? 250);
  const callCount = calls.count ?? 0;

  const w = worker.data as Beat | null;
  const online = workerOnline(w?.last_run, now);
  const snap = ((w?.detail as { jobs?: Record<string, JobSnap> } | null)?.jobs ?? null) as Record<string, JobSnap> | null;
  const agents = entries.map((a, i) => agentRow(a, ((beats[i]?.data ?? []) as Beat[]), snap?.[a.job ?? ""] ?? null, 0, now));
  const bad = agents.filter((a) => a.state === "red" || a.state === "amber");

  const needs: { n: number; label: string; href: string; icon: IconName; tone?: string }[] = [
    { n: pending.count ?? 0, label: "drafts waiting for approval", href: "/approvals", icon: "inbox" },
    { n: held.count ?? 0, label: "held drafts (lint, injection or suppressed)", href: "/approvals?view=held", icon: "alert", tone: "c-warn" },
    { n: trouble, label: "sends failed or unverified (check on the Mac cockpit)", href: "/approvals", icon: "alert", tone: "c-bad" },
    { n: intake.count ?? 0, label: "new enquiries", href: "/intake", icon: "zap" },
    { n: tickets.count ?? 0, label: "client tickets waiting on you", href: "/tickets", icon: "ticket" },
  ];
  const open = needs.filter((x) => x.n > 0);

  return (
    <>
      <header className="greet">
        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
          <MenuButton />
          <div>
            <h1>
              {greeting(now, TZ)}, {claims ? firstName(claims) : "there"}
            </h1>
            <div className="date">
              {longDate(now, TZ)} · {pending.count ?? 0} waiting · {approvedToday} approved, {rejectedToday} rejected today
              {lastSent.data ? ` · last send ${ago((lastSent.data as { occurred_at: string }).occurred_at, now)} ago` : ""}
            </div>
          </div>
        </div>
        <div className="actions">
          <AutoRefresh seconds={30} />
          <Link className="btn btn-primary" href="/approvals">
            <Icon name="inbox" className="i-sm" />
            Approvals {pending.count ? `· ${pending.count}` : ""}
          </Link>
        </div>
      </header>

      {loadError && <p className="auth-error" role="alert">Some numbers couldn&apos;t load. Reload to retry.</p>}

      <section className="kpi">
        <div className="panel tile"><div className="l"><div className="k">Conversations · 30 days</div><div className="v big num">{convs}</div><div className="d">{convWeek} this week</div></div></div>
        <div className="panel tile"><div className="l"><div className="k">Quotes out</div><div className="v big num">{quoteRows.length}</div><div className="d">{money(sum(quoteRows))} on the table</div></div></div>
        <div className="panel tile"><div className="l"><div className="k">Won since 1 Oct</div><div className="v big num">{money(sum(won.data as { value_usd: number | null }[]))}</div><div className="d">{money(sum(collected.data as { value_usd: number | null }[]))} collected · 30 days</div></div></div>
        <div className="panel tile"><div className="l"><div className="k">Interested replies</div><div className="v big num">{sent ? `${((interested / sent) * 100).toFixed(1)}%` : "–"}</div><div className="d">{interested} of {sent} sent · 30 days</div></div></div>
      </section>

      <div className="grid-main">
        <div className="col">
          <section className="panel">
            <div className="panel-head"><h2>Needs you</h2></div>
            {open.length ? (
              <div className="list-rows" style={{ padding: "0 18px 14px" }}>
                {open.map((x) => (
                  <Link key={x.label} href={x.href}>
                    <Icon name={x.icon} className={x.tone ? `i-sm ${x.tone}` : "i-sm"} />
                    <span className="grow"><strong className="num">{x.n}</strong> {x.label}</span>
                    <Icon name="chevR" className="i-sm c-3" />
                  </Link>
                ))}
              </div>
            ) : (
              <p className="c-2 t-13" style={{ padding: "0 22px 20px" }}>All clear. Nothing waits on you.</p>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Agents</h2>
              <Link className="more t-12" href="/agents">All agents</Link>
            </div>
            <div className="list-rows" style={{ padding: "0 18px 14px" }}>
              {(bad.length ? bad : agents.slice(0, 6)).map((a) => (
                <Link key={a.key} href="/agents">
                  <span className={`pill ${STATE_PILL[a.state]}`}><span className="dot" />{a.text}</span>
                  <span className="grow truncate">{a.label}</span>
                  <span className="c-3 t-12">{a.last === "never" ? "never" : `${a.last} ago`}</span>
                </Link>
              ))}
              {!bad.length && <p className="c-3 t-12" style={{ padding: "8px 4px 0" }}>Every agent reported OK.</p>}
            </div>
          </section>
        </div>

        <div className="col">
          <section className="panel">
            <div className="panel-head"><h2>LLM calls today</h2></div>
            <div style={{ padding: "0 22px 20px" }}>
              <div className="big num" style={{ fontSize: "var(--t-36)" }}>
                {callCount}<span className="dec"> / {budget}</span>
              </div>
              <div className="meter" style={{ marginTop: 12 }} data-tone={callCount >= budget ? "bad" : callCount >= budget * 0.7 ? "warn" : "good"}>
                <span style={{ width: `${Math.min(100, (callCount / Math.max(budget, 1)) * 100)}%` }} />
              </div>
              <p className="c-3 t-12" style={{ marginTop: 8 }}>{callCount >= budget ? "Budget reached: agents stop calling the model until midnight PKT." : "Daily budget from Settings."}</p>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Schedule</h2>
              <span className={`pill ${online ? "pill-good" : "pill-warn"} more`}><span className="dot" />{online ? "Mac online" : w ? `Mac offline since ${hhmm(w.last_run)}` : "Mac not reporting"}</span>
            </div>
            <table className="table">
              <tbody>
                {SCHEDULE.map(([job, label]) => {
                  const j = snap?.[job];
                  return (
                    <tr key={job}>
                      <td>
                        <div className="w-600">{label}</div>
                        <div className="c-3 t-12">{j?.cadence || "—"}</div>
                      </td>
                      <td style={{ textAlign: "right" }} className="t-12">
                        {j?.running ? <span className="pill pill-accent"><span className="dot live" />running now</span> : j?.next ? <><div>{hhmm(j.next)}</div><div className="c-3">{until(j.next, now)}</div></> : <span className="c-3">{snap ? "not scheduled" : "waiting for the worker"}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </>
  );
}
