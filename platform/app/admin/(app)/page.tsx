import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/app/components/Icon";
import type { IconName } from "@/app/components/icons";
import { PageHeader } from "@/app/components/PageHeader";
import { KpiTile } from "@/app/components/KpiTile";
import { CountUp } from "@/app/components/CountUp";
import { ArcGauge } from "@/app/components/ArcGauge";
import { TrendChart } from "@/app/components/TrendChart";
import { Empty } from "@/app/components/Empty";
import { Note } from "@/app/components/Note";
import { firstName, getSession } from "@/lib/session";
import { dayMonth, greeting, longDate } from "@/lib/dates";
import { ago, hhmm, isVerify, money, pktMidnight, until, workerOnline } from "@/lib/admin-ops";
import { AGENT_CATALOG, agentRow, type Beat, type JobSnap } from "@/lib/admin-agents";
import { dayLabels, lastDays, perDay, weekDelta } from "@/lib/series";
import { TodayCommands } from "./TodayCommands";

export const metadata: Metadata = { title: "Today" };

const TZ = "Asia/Karachi"; // the founder's clock (Epsilon OS runs on PKT)
const GOAL_USD = 100_000; // design review D9: $100k signed (deals.won) by 31 Dec 2026
const GOAL_END = "2026-12-31T23:59:59+05:00";
const PERIOD_START_DEFAULT = "2026-10-01"; // settings key revenue.period_start overrides it
const SCHEDULE: [string, string, IconName][] = [
  ["outreach", "Outreach sends", "send"], ["tenders", "Tender scan", "globe"], ["prospector", "Prospector", "search"],
  ["brief", "Morning brief", "mail"], ["inbox", "Inbox", "inbox"], ["outbox", "Outbox", "upload"], ["backup", "Backup", "clip"],
];
const LIVE_DRAFT = ["pending", "approved", "edited_approved", "edited_pending_lint", "sending", "sent"];
const QUOTE_AGEING_DAYS = 7;

type Touch = { id: string; type: string; direction: string; deal_id: string | null; classifier: { label?: string } | null; occurred_at: string };
type Deal = { id: string; title: string; value_usd: number | string | null; quoted_at: string | null; updated_at: string; companies: { name: string } | { name: string }[] | null };
type Proposal = { id: string; title: string; total: number | string; status: string; viewed_at: string | null };
type Invoice = { id: string; number: string | null; total: number | string; currency: string; due_date: string | null; status: string; organizations: { name: string } | { name: string }[] | null };
type Need = { key: string; n: number; label: string; context: string; href: string; tone?: "warn" | "bad" };
const sum = (rows: { value_usd?: number | string | null }[] | null) => (rows ?? []).reduce((s, d) => s + Number(d.value_usd ?? 0), 0);
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

export default async function AdminToday() {
  const { supabase, claims } = await getSession();
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const days = lastDays(now, 14);
  const since14 = pktMidnight(now, 13);
  const midnight = pktMidnight(now);
  const entries = AGENT_CATALOG.flatMap(([, a]) => a);
  const withBeat = entries.filter((a) => a.hb);
  const [
    touches, quotes, collected, won, quoted14, pendingQ, failed, sending, intake, tickets, calls, settings, worker, lastSent, decided,
    proposals, invoices, drafts, ...beats
  ] = await Promise.all([
    supabase.from("touches").select("id, type, direction, deal_id, classifier, occurred_at").gte("occurred_at", since).in("type", ["human_reply", "sent"]).limit(2000),
    supabase.from("deals").select("id, title, value_usd, quoted_at, updated_at, companies(name)").eq("stage", "quote_out").order("quoted_at", { ascending: true }).limit(1000),
    supabase.from("deals").select("value_usd").gte("collected_at", since).limit(1000),
    supabase.from("deals").select("value_usd, closed_at").eq("stage", "won").limit(1000),
    supabase.from("deals").select("quoted_at").gte("quoted_at", since14).limit(1000),
    supabase.from("approval_queue").select("created_at, kind, held").eq("status", "pending").order("created_at", { ascending: true }).limit(1000),
    supabase.from("approval_queue").select("id", { count: "exact", head: true }).eq("status", "failed"),
    supabase.from("approval_queue").select("status, claimed_at, send_error").eq("status", "sending").limit(50),
    supabase.from("intake").select("name, company, created_at", { count: "exact" }).eq("status", "new").order("created_at", { ascending: false }).limit(1),
    supabase.from("tickets").select("ref, organizations(name)", { count: "exact" }).in("status", ["new", "triaged", "briefed", "planned", "approved", "in_progress"]).order("created_at", { ascending: true }).limit(1),
    supabase.from("actions").select("cost_usd", { count: "exact" }).eq("action", "llm_call").gte("at", midnight).limit(1000),
    supabase.rpc("get_settings"),
    supabase.from("agent_heartbeats").select("agent, last_run, status, detail").eq("agent", "worker").order("last_run", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("touches").select("occurred_at").eq("type", "sent").order("occurred_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("approval_queue").select("status").gte("decided_at", midnight).limit(1000),
    // D6 money items: proposals viewed but not accepted, invoices due or overdue, drafts that answer a reply
    supabase.from("proposals").select("id, title, total, status, viewed_at").in("status", ["sent", "viewed"]).not("viewed_at", "is", null).order("viewed_at", { ascending: true }).limit(100),
    supabase.from("invoices").select("id, number, total, currency, due_date, status, organizations(name)").in("status", ["sent", "overdue"]).order("due_date", { ascending: true }).limit(100),
    supabase.from("approval_queue").select("deal_id, created_at").in("status", LIVE_DRAFT).not("deal_id", "is", null).gte("created_at", since).limit(2000),
    ...withBeat.map((a) => supabase.from("agent_heartbeats").select("agent, last_run, status, detail").eq("agent", a.hb as string).order("last_run", { ascending: false }).limit(7)),
  ]);
  const choresError = [pendingQ, intake, tickets, failed].some((r) => r.error);
  const moneyError = [proposals, invoices, drafts, quotes].some((r) => r.error);
  const funnelError = Boolean(touches.error);

  // settings: revenue period (D9; replaces the hard-coded 1 Oct)
  const s = (settings.data ?? {}) as Record<string, unknown>;
  const periodStart = /^\d{4}-\d{2}-\d{2}$/.test(String(s["revenue.period_start"] ?? "")) ? String(s["revenue.period_start"]) : PERIOD_START_DEFAULT;
  const budget = Number(s["llm.daily_budget"] ?? 250);
  const callCount = calls.count ?? 0;
  const callCost = ((calls.data ?? []) as { cost_usd: number | null }[]).reduce((t, a) => t + Number(a.cost_usd ?? 0), 0);

  // funnel, 30 days + 14-day series
  const t = (touches.data ?? []) as Touch[];
  const human = t.filter((x) => x.type === "human_reply" && x.direction === "inbound");
  const sentRows = t.filter((x) => x.type === "sent" && x.direction === "outbound");
  const inquiries = human.filter((x) => x.classifier?.label === "inquiry");
  const quoteRows = (quotes.data ?? []) as Deal[];
  const wonRows = ((won.data ?? []) as { value_usd: number | null; closed_at: string | null }[]);
  const wonPeriod = wonRows.filter((d) => d.closed_at && d.closed_at >= `${periodStart}T00:00:00+05:00`);
  const won30 = wonRows.filter((d) => d.closed_at && d.closed_at >= since);
  const wonUsd = sum(wonPeriod);
  const quotedUsd = sum(quoteRows);
  const collectedUsd = sum(collected.data as { value_usd: number | null }[]);
  const series = {
    sent: perDay(sentRows.map((x) => x.occurred_at), days),
    replies: perDay(human.map((x) => x.occurred_at), days),
    interested: perDay(inquiries.map((x) => x.occurred_at), days),
    quotes: perDay(((quoted14.data ?? []) as { quoted_at: string | null }[]).map((d) => d.quoted_at), days),
    won: perDay(won30.map((d) => d.closed_at), days),
  };

  // goal (D9)
  const endMs = Date.parse(GOAL_END);
  const startMs = Date.parse(`${periodStart}T00:00:00+05:00`);
  const daysLeft = Math.max(0, Math.ceil((endMs - now.getTime()) / 86_400_000));
  const elapsedPct = Math.max(0, Math.min(100, ((now.getTime() - startMs) / Math.max(1, endMs - startMs)) * 100));
  const wonPct = (wonUsd / GOAL_USD) * 100;
  const perWeek = daysLeft ? Math.max(0, GOAL_USD - wonUsd) / Math.max(1, daysLeft / 7) : 0;

  // chores (D1) then money items (D6); each hidden at zero
  const pendingRows = (pendingQ.data ?? []) as { created_at: string; kind: string | null; held: boolean }[];
  const ready = pendingRows.filter((r) => !r.held);
  const heldN = pendingRows.length - ready.length;
  const decidedRows = (decided.data ?? []) as { status: string }[];
  const approvedToday = decidedRows.filter((r) => ["approved", "edited_approved", "edited_pending_lint", "sending", "sent"].includes(r.status)).length;
  const trouble = (failed.count ?? 0) + ((sending.data ?? []) as { status: string; claimed_at: string | null }[]).filter((r) => isVerify(r, now)).length;
  const newest = one((intake.data ?? []) as { name: string; company: string | null; created_at: string }[]);
  const oldestTicket = one((tickets.data ?? []) as { ref: string; organizations: { name: string } | { name: string }[] | null }[]);

  const draftsBy = new Map<string, string[]>();
  for (const d of (drafts.data ?? []) as { deal_id: string; created_at: string }[]) draftsBy.set(d.deal_id, [...(draftsBy.get(d.deal_id) ?? []), d.created_at]);
  // the newest inquiry per deal is waiting when no draft for that deal was made after it
  const lastInquiry = new Map<string, Touch>();
  for (const x of inquiries) if (x.deal_id && (!lastInquiry.get(x.deal_id) || lastInquiry.get(x.deal_id)!.occurred_at < x.occurred_at)) lastInquiry.set(x.deal_id, x);
  const repliesWaiting = [...lastInquiry.values()].filter((x) => !(draftsBy.get(x.deal_id as string) ?? []).some((at) => at >= x.occurred_at));
  const ageCut = new Date(now.getTime() - QUOTE_AGEING_DAYS * 86_400_000).toISOString();
  const ageing = quoteRows.filter((d) => (d.quoted_at ?? d.updated_at) < ageCut);
  const viewed = (proposals.data ?? []) as Proposal[];
  const invoiceRows = (invoices.data ?? []) as Invoice[];
  const overdue = invoiceRows.filter((i) => i.status === "overdue");

  const needs: Need[] = [
    { key: "approvals", n: ready.length, label: "Approvals", context: ready[0] ? `oldest ${hhmm(ready[0].created_at)} · ${ready.filter((r) => r.kind === "outbound").length} cold` : "", href: "/approvals" },
    { key: "held", n: heldN, label: "Held drafts", context: "lint, injection or suppressed", href: "/approvals?view=held", tone: "warn" },
    { key: "failed", n: trouble, label: "Failed sends", context: "check the Mac cockpit", href: "/approvals", tone: "bad" },
    { key: "intake", n: intake.count ?? 0, label: (intake.count ?? 0) > 1 ? "New enquiries" : "New enquiry", context: newest ? `${newest.company || newest.name} · ${ago(newest.created_at, now)} ago` : "", href: "/intake" },
    { key: "tickets", n: tickets.count ?? 0, label: "Tickets", context: oldestTicket ? `${oldestTicket.ref} ${one(oldestTicket.organizations)?.name ?? ""}`.trim() : "", href: "/tickets" },
    { key: "replies", n: repliesWaiting.length, label: "Replies waiting", context: "interested, no draft yet", href: "/pipeline" },
    { key: "quotes", n: ageing.length, label: "Quotes ageing", context: `out over ${QUOTE_AGEING_DAYS} days · ${money(sum(ageing))}`, href: "/pipeline" },
    { key: "proposals", n: viewed.length, label: "Proposals viewed", context: "opened, not signed yet", href: "/proposals" },
    { key: "invoices", n: overdue.length, label: "Invoices overdue", context: money(overdue.reduce((a, i) => a + Number(i.total), 0)), href: "/invoices", tone: "bad" },
  ];
  const open = needs.filter((x) => x.n > 0);

  // money in play: the next invoice due, the open quotes, replies waiting (goal panel rows)
  const due = invoiceRows[0];
  const play: { key: string; tag: string; title: string; when: string; amt: string; href: string }[] = [
    ...(due ? [{ key: `i-${due.id}`, tag: due.status === "overdue" ? "overdue" : "due", title: `${due.number ?? "Invoice"} · ${one(due.organizations)?.name ?? ""}`, when: due.due_date ? dayMonth(`${due.due_date}T12:00:00+05:00`) : "no date", amt: usd(Number(due.total)), href: `/invoices/${due.id}` }] : []),
    ...[...quoteRows].sort((a, b) => Number(b.value_usd ?? 0) - Number(a.value_usd ?? 0)).slice(0, 2).map((d) => ({
      key: `q-${d.id}`, tag: "quote", title: `${one(d.companies)?.name ?? ""} · ${d.title}`, when: d.quoted_at ? `sent ${dayMonth(d.quoted_at)}` : "", amt: d.value_usd ? usd(Number(d.value_usd)) : "–", href: `/pipeline?deal=${d.id}`,
    })),
    ...repliesWaiting.slice(0, 2).map((x) => ({ key: `r-${x.id}`, tag: "reply", title: "Interested reply · no draft yet", when: dayMonth(x.occurred_at), amt: "", href: `/pipeline?deal=${x.deal_id}` })),
  ].slice(0, 4);

  // agents (two columns, last 7 runs) and the schedule
  const w = worker.data as Beat | null;
  const online = workerOnline(w?.last_run, now);
  const snap = ((w?.detail as { jobs?: Record<string, JobSnap> } | null)?.jobs ?? null) as Record<string, JobSnap> | null;
  const beatsBy = new Map(withBeat.map((a, i) => [a.key, ((beats[i]?.data ?? []) as Beat[])]));
  const agents = entries.map((a) => agentRow(a, beatsBy.get(a.key) ?? [], snap?.[a.job ?? ""] ?? null, 0, now));
  const needLook = agents.filter((a) => a.state === "red" || a.state === "amber").length;
  const half = Math.ceil(agents.length / 2);
  const cols = [agents.slice(0, half), agents.slice(half)];
  const schedule = SCHEDULE.map(([job, label, icon]) => ({ job, label, icon, j: snap?.[job] }))
    .filter((x) => x.j?.next || x.j?.running)
    .sort((a, b) => (a.j?.running ? -1 : b.j?.running ? 1 : String(a.j?.next).localeCompare(String(b.j?.next))))
    .slice(0, 5);
  const nextBrief = snap?.brief?.next;

  const sentWord = lastSent.data ? ` · last send ${ago((lastSent.data as { occurred_at: string }).occurred_at, now)} ago` : "";
  const workerPill = (
    <span className={`pill pill-white hide-m worker-pill${online ? "" : " off"}`} title={w ? `Mac worker heartbeat ${ago(w.last_run, now)} ago` : "The Mac worker has not reported"}>
      <span className={`dot${online ? " live c-good" : ""}`} />
      {online ? "Worker online · Mac" : w ? `Mac offline since ${hhmm(w.last_run)}` : "Mac not reporting"}
    </span>
  );

  return (
    <>
      <TodayCommands />
      <PageHeader
        variant="greet"
        title={`${greeting(now, TZ)}, ${claims ? firstName(claims) : "there"}`}
        sub={`${longDate(now, TZ)} · ${ready.length} waiting · ${approvedToday} approved today${sentWord}`}
        refresh={30}
        quietRefresh
        below={
          <div className="ring-sm">
            {wonUsd > 0 && (
              <span className="ring" data-pct={Math.min(100, wonPct).toFixed(1)}>
                <svg viewBox="0 0 40 40" aria-hidden="true">
                  <circle className="track" cx="20" cy="20" r="16" />
                  <circle className="bar" cx="20" cy="20" r="16" style={{ strokeDasharray: 100.53, strokeDashoffset: 100.53 * (1 - Math.min(100, wonPct) / 100) }} />
                </svg>
                <span className="val">{Math.round(wonPct)}%</span>
              </span>
            )}
            <span className="lbl">
              <strong>{usd(wonUsd)} of $100k</strong>by 31 Dec · {daysLeft} days left
            </span>
          </div>
        }
        actions={
          <>
            {workerPill}
            <Link className="btn btn-primary" href="/approvals">
              <Icon name="inbox" className="i-sm" />
              Approvals{ready.length ? ` · ${ready.length}` : ""}
            </Link>
          </>
        }
      />

      <div className="sec-head">
        <h2>
          Needs you <span className="c-3">· {open.length}</span>
        </h2>
        <span className="sub">chores first, then money</span>
        <span className="more hide-m">
          <span className="kbd">A</span> approvals <span className="kbd">⌘K</span> everything
        </span>
      </div>
      {choresError && <Note tone="error" retry>Some of these counts couldn&apos;t load; the tiles below are what did.</Note>}
      {open.length ? (
        <section className="needs" data-stagger="" aria-label="Needs you">
          {open.map((x, i) => (
            <Link key={x.key} className={`panel need lift${x.tone ? ` ${x.tone}` : ""}`} href={x.href} style={{ ["--i" as string]: Math.min(i, 7) }}>
              <CountUp value={x.n} className="n big num" />
              <span className="grow">
                <span className="t">{x.label}</span>
                {x.context && <span className="c">{x.context}</span>}
              </span>
              <span className="go">
                <Icon name="chevR" className="i-sm" />
              </span>
            </Link>
          ))}
        </section>
      ) : (
        <section className="panel">
          <Empty title="All clear">
            <p className="c-2">Nothing waits on you.</p>
            <p className="c-3 t-12 mono">next run: {nextBrief ? `Morning brief ${hhmm(nextBrief)}` : "Morning brief 08:30"}</p>
          </Empty>
        </section>
      )}
      {moneyError && <Note tone="warn" retry className="mt-8">Money items (replies, quotes, proposals, invoices) couldn&apos;t all load.</Note>}

      <div className="mid">
        <section className={`panel goal${wonUsd > 0 ? "" : " goal-line"}`} aria-label="Revenue goal">
          <div className="row between">
            <h2>
              {wonUsd > 0 ? (
                <>
                  Q4 goal <span className="c-3">· $100,000 signed by 31 Dec</span>
                </>
              ) : (
                <>
                  Q4 goal <span className="c-3">· $100k signed by 31 Dec</span>
                </>
              )}
            </h2>
            <span className="pill pill-white mono">{daysLeft} days left</span>
          </div>
          <div className="goal-body">
            {wonUsd > 0 && <ArcGauge pct={wonPct} label={`${wonPct.toFixed(1)}% of goal`} value={usd(wonUsd)} />}
            <div className="stats">
              <div><span className="k" title={`Signed since ${periodStart}`}>Won</span><span className="v">{usd(wonUsd)}</span></div>
              <div><span className="k">Quoted · {quoteRows.length} open</span><span className="v">{usd(quotedUsd)}</span></div>
              <div><span className="k">Collected · 30 d</span><span className="v">{usd(collectedUsd)}</span></div>
              <div><span className="k">Needed / week</span><span className="v">{usd(perWeek)}</span></div>
            </div>
          </div>
          <div className="due" aria-label="Money in play">
            {play.length ? (
              play.map((p) => (
                <Link key={p.key} href={p.href}>
                  <span className="tag">{p.tag}</span>
                  <span className="t">{p.title}</span>
                  <span className="when">{p.when}</span>
                  <span className="amt">{p.amt}</span>
                </Link>
              ))
            ) : (
              <Empty variant="inline" action={<Link href="/pipeline">Pipeline →</Link>}>Nothing in play: no open quotes, invoices or replies.</Empty>
            )}
          </div>
          <div className="pace" aria-label={`Pace: ${wonPct.toFixed(1)}% won, ${Math.round(elapsedPct)}% of the quarter elapsed`}>
            <span>pace</span>
            <span className="bar">
              <i style={{ width: `${Math.min(100, wonPct)}%` }} />
              <b style={{ left: `${elapsedPct}%` }} title={`${Math.round(elapsedPct)}% of Q4 elapsed`} />
            </span>
            <span>
              {wonPct.toFixed(1)}% won · {Math.round(elapsedPct)}% of Q4 gone
            </span>
          </div>
        </section>

        <section className="funnel" aria-label="Funnel, last 30 days">
          <div className="sec-head">
            <h2>
              Funnel <span className="c-3">· 30 days</span>
            </h2>
            <span className="sub">cold email · Mac outbox</span>
            <Link className="more hide-m" href="/pipeline">
              Pipeline →
            </Link>
          </div>
          <div className="kpi" data-stagger="">
            <KpiTile label="Sent" value={sentRows.length} error={funnelError} context={`${(sentRows.length / 30).toFixed(1)} / day avg`} delta={weekDelta(series.sent)} series={series.sent} />
            <KpiTile label="Replies" value={human.length} error={funnelError} context={sentRows.length ? `${((human.length / sentRows.length) * 100).toFixed(1)}% of sent` : "no sends yet"} delta={weekDelta(series.replies)} series={series.replies} />
            <KpiTile label="Interested" value={inquiries.length} error={funnelError} context={`${inquiries.length} of ${human.length} replies`} delta={weekDelta(series.interested)} series={series.interested} />
            <KpiTile label="Quotes" value={quoteRows.length} error={Boolean(quotes.error)} context={`${money(quotedUsd)} open`} delta={weekDelta(series.quotes)} series={series.quotes} />
            <KpiTile label="Won" value={won30.length} error={Boolean(won.error)} context={wonUsd ? `${money(wonUsd)} since ${dayMonth(`${periodStart}T12:00:00+05:00`)}` : quoteRows[0]?.quoted_at ? `first quote out ${dayMonth(quoteRows[0].quoted_at)}` : "none yet"} delta={weekDelta(series.won)} series={series.won} />
          </div>
          <div className="panel trend" aria-label="Sent and replies per day, last 14 days">
            <div className="row between">
              <h3>Sent vs replies · 14 days</h3>
            </div>
            <TrendChart labels={dayLabels(days)} series={[{ name: "Sent", data: series.sent }, { name: "Replies", data: series.replies }]} aria="Cold emails sent and human replies per day, last 14 days" />
          </div>
        </section>
      </div>

      <div className="bottom">
        <section className="panel" aria-label="Agents">
          <div className="panel-head">
            <h2>
              Agents <span className="c-3">· {agents.length} on the Mac{needLook ? ` · ${needLook} need${needLook === 1 ? "s" : ""} a look` : ""}</span>
            </h2>
            <Link className="more t-12 c-3" href="/agents">
              All agents →
            </Link>
          </div>
          <div className="agents">
            {cols.map((col, ci) => (
              <div className="col" key={ci}>
                {col.map((a) => {
                  const warn = a.state === "red" || a.state === "amber";
                  const hist = a.history.slice(-7);
                  return (
                    <Link key={a.key} href="/agents" className={`agent${warn ? " warn" : ""}${a.state === "red" ? " bad" : ""}${a.state === "idle" ? " idle" : ""}`} title={a.summary || a.text}>
                      <span className="dot" />
                      <span className="name">{a.label}</span>
                      <span className="last">
                        {a.running ? "running" : a.last === "never" ? a.text || "never" : `${a.last} ago`}
                        {warn ? ` · ${a.text}` : ""}
                      </span>
                      <span className="hist" aria-label={`Last ${hist.length} runs: ${hist.join(", ") || "none"}`}>
                        {hist.map((h, k) => (
                          <i key={k} className={h === "error" ? "b" : h === "warn" ? "w" : undefined} />
                        ))}
                      </span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="panel-foot">
            LLM&nbsp;<strong>{callCount} / {budget}</strong>&nbsp;·&nbsp;<strong>${callCost.toFixed(2)}</strong>&nbsp;today
            {callCount >= budget ? " · budget reached: agents wait until midnight PKT" : ""}
          </div>
        </section>

        <section className="panel" aria-label="Schedule">
          <div className="panel-head">
            <h2>
              Schedule <span className="c-3">· next {schedule.length || 5}</span>
            </h2>
            <span className={`pill ${online ? "pill-good" : "pill-warn"} more`} aria-live="polite">
              <span className="dot" />
              {online ? "Mac online" : w ? `Mac offline since ${hhmm(w.last_run)}` : "Mac not reporting"}
            </span>
          </div>
          {schedule.length ? (
            <div className="rows" data-stagger="">
              {schedule.map((x, i) => (
                <Link key={x.job} href="/agents" style={{ ["--i" as string]: i }}>
                  <span className="ic">
                    <Icon name={x.icon} className="i-sm" />
                  </span>
                  <span className="grow">
                    <span className="t">{x.label}</span>
                    <span className="m">{x.j?.cadence || "—"}</span>
                  </span>
                  <span className="when">
                    {x.j?.running ? (
                      <span className="pill pill-accent">
                        <span className="dot live" />
                        running now
                      </span>
                    ) : (
                      <>
                        <strong>{hhmm(x.j?.next as string)}</strong>
                        <span>{until(x.j?.next, now)}</span>
                      </>
                    )}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <Empty variant="inline">{snap ? "Nothing scheduled in the worker's snapshot." : "Waiting for the Mac worker to report its schedule."}</Empty>
          )}
        </section>
      </div>
    </>
  );
}
