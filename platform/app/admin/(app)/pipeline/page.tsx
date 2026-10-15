import type { Metadata } from "next";
import { PageHeader } from "@/app/components/PageHeader";
import { KpiTile } from "@/app/components/KpiTile";
import { Money } from "@/app/components/Money";
import { Note } from "@/app/components/Note";
import { getSession } from "@/lib/session";
import { dayMonth } from "@/lib/dates";
import { pktMidnight } from "@/lib/admin-ops";
import { lastDays, perDay, weekDelta } from "@/lib/series";
import { byNeed, CHANNELS, CH_LABEL, daysSince, nextStep, stageGroup, STRATEGY_TAG, type LastTouch } from "@/lib/deals";
import { PipelineTable, type DealRow } from "./PipelineTable";
import type { DealDetail } from "./DealSheet";

export const metadata: Metadata = { title: "Pipeline" };

const UUID = /^[0-9a-f-]{36}$/i;
const PERIOD_START_DEFAULT = "2026-10-01"; // settings key revenue.period_start overrides it (same as Today)
const DRAFT_LIVE = ["pending", "edited_pending_lint"];

type Deal = {
  id: string; title: string; stage: string; source_channel: string; value_usd: number | string | null; strategy: string | null; company_id: string;
  quoted_at: string | null; closed_at: string | null; lost_reason: string | null; created_at: string; updated_at: string;
  companies: { name: string; country: string | null } | { name: string; country: string | null }[] | null;
  contacts: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null;
};
type Touch = { id: string; deal_id: string | null; type: string; direction: string; subject: string | null; body_excerpt: string | null; occurred_at: string };
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const COLS = "id, title, stage, source_channel, value_usd, strategy, company_id, quoted_at, closed_at, lost_reason, created_at, updated_at, companies(name, country), contacts:primary_contact_id(full_name, email)";

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ channel?: string; deal?: string }> }) {
  const sp = await searchParams;
  const channel = (CHANNELS as readonly string[]).includes(sp.channel ?? "") ? (sp.channel as string) : "";
  const dealId = UUID.test(sp.deal ?? "") ? (sp.deal as string) : null;
  const { supabase } = await getSession();
  const now = new Date();
  const days = lastDays(now, 14);
  const since14 = pktMidnight(now, 13);
  const [deals, touches, drafts, recent, settings] = await Promise.all([
    supabase.from("deals").select(COLS).order("updated_at", { ascending: false }).limit(1000),
    supabase.from("touches").select("deal_id, type, direction, subject, occurred_at").not("deal_id", "is", null).order("occurred_at", { ascending: false }).limit(1000),
    supabase.from("approval_queue").select("deal_id").in("status", DRAFT_LIVE).not("deal_id", "is", null).limit(1000),
    supabase.from("touches").select("type, direction, occurred_at").gte("occurred_at", since14).in("type", ["human_reply", "sent"]).limit(2000),
    supabase.rpc("get_settings"),
  ]);
  const list = (deals.data ?? []) as unknown as Deal[];
  const last = new Map<string, NonNullable<LastTouch>>();
  for (const t of (touches.data ?? []) as Touch[]) if (t.deal_id && !last.has(t.deal_id)) last.set(t.deal_id, t);
  const waiting = new Set(((drafts.data ?? []) as { deal_id: string }[]).map((d) => d.deal_id));

  const rows: DealRow[] = list
    .map((d) => {
      const lt = last.get(d.id) ?? null;
      const touchedAt = lt?.occurred_at ?? d.updated_at ?? d.created_at;
      const age = daysSince(touchedAt, now);
      const nx = nextStep(d, lt, waiting.has(d.id), age, dayMonth);
      const co = one(d.companies);
      const ct = one(d.contacts);
      return {
        id: d.id,
        company: co?.name ?? d.title,
        place: co?.country ?? "",
        title: d.title,
        stage: d.stage,
        group: stageGroup(d.stage),
        channel: d.source_channel,
        strategy: d.strategy ? (STRATEGY_TAG[d.strategy] ?? d.strategy) : (CH_LABEL[d.source_channel] ?? d.source_channel).toLowerCase(),
        contact: ct?.full_name || ct?.email || "",
        value: d.value_usd == null ? null : Number(d.value_usd),
        age,
        touchedAt,
        rank: nx.rank,
        next: { lead: nx.lead, rest: nx.rest },
      };
    })
    .sort(byNeed);

  // KPI row (D10: sparklines only with signal; KpiTile decides)
  const s = (settings.data ?? {}) as Record<string, unknown>;
  const periodStart = /^\d{4}-\d{2}-\d{2}$/.test(String(s["revenue.period_start"] ?? "")) ? String(s["revenue.period_start"]) : PERIOD_START_DEFAULT;
  const newLeads = perDay(list.filter((d) => d.created_at >= since14).map((d) => d.created_at), days);
  const nNew = newLeads.reduce((a, b) => a + b, 0);
  const tr = (recent.data ?? []) as { type: string; direction: string; occurred_at: string }[];
  const human = tr.filter((t) => t.type === "human_reply" && t.direction === "inbound");
  const sent = tr.filter((t) => t.type === "sent" && t.direction === "outbound");
  const replies = perDay(human.map((t) => t.occurred_at), days);
  const quotes = list.filter((d) => d.stage === "quote_out");
  const quotedUsd = quotes.reduce((a, d) => a + Number(d.value_usd ?? 0), 0);
  const wonPeriod = list.filter((d) => d.stage === "won" && d.closed_at && d.closed_at >= `${periodStart}T00:00:00+05:00`);
  const wonUsd = wonPeriod.reduce((a, d) => a + Number(d.value_usd ?? 0), 0);
  const firstQuote = list.map((d) => d.quoted_at).filter((x): x is string => Boolean(x)).sort()[0];
  const activeDays = newLeads.filter((n) => n > 0).length;

  // the deal sheet (deep link ?deal=; J/K swap it without closing)
  let detail: DealDetail | null = null;
  if (dealId) {
    const d = list.find((x) => x.id === dealId) ?? ((await supabase.from("deals").select(COLS).eq("id", dealId).maybeSingle()).data as unknown as Deal | null);
    if (d) {
      const [co, ct, tt] = await Promise.all([
        supabase.from("companies").select("name, domain, country, sector").eq("id", d.company_id).maybeSingle(),
        supabase.from("contacts").select("full_name, email, role, opted_out").eq("company_id", d.company_id).limit(20),
        supabase.from("touches").select("id, deal_id, type, direction, subject, body_excerpt, occurred_at").eq("deal_id", dealId).order("occurred_at", { ascending: false }).limit(10),
      ]);
      const row = rows.find((r) => r.id === d.id);
      const lt = last.get(d.id) ?? null;
      const nx = row?.next ?? nextStep(d, lt, waiting.has(d.id), daysSince(lt?.occurred_at ?? d.updated_at, now), dayMonth);
      detail = {
        id: d.id,
        title: d.title,
        stage: d.stage,
        channel: CH_LABEL[d.source_channel] ?? d.source_channel,
        strategy: d.strategy ? (STRATEGY_TAG[d.strategy] ?? d.strategy) : null,
        value: d.value_usd == null ? null : Number(d.value_usd),
        opened: d.created_at,
        quotedAt: d.quoted_at,
        closedAt: d.closed_at,
        lostReason: d.lost_reason,
        draftWaiting: waiting.has(d.id),
        next: nx,
        company: (co.data as { name: string; domain: string | null; country: string | null; sector: string | null } | null) ?? { name: one(d.companies)?.name ?? d.title, domain: null, country: null, sector: null },
        contacts: (ct.data ?? []) as DealDetail["contacts"],
        touches: (tt.data ?? []) as Touch[],
        error: Boolean(co.error || ct.error || tt.error),
      };
    }
  }

  return (
    <>
      <PageHeader
        title="Pipeline"
        sub={
          <>
            <span>{list.length} deals</span>
            <span aria-hidden="true">·</span>
            <span>
              <Money value={quotedUsd} currency="USD" /> quoted
            </span>
            <span aria-hidden="true">·</span>
            <span>sorted by needs a touch</span>
          </>
        }
      />
      {deals.error && <Note retry>Couldn&apos;t load deals.</Note>}

      <PipelineTable
        rows={rows}
        initialChannel={channel}
        selected={dealId}
        detail={detail}
        kpis={
          <section className="kpi4" aria-label="Pipeline numbers">
            <KpiTile
              label="New leads · 14 d"
              value={nNew}
              context={nNew ? `${Math.round(nNew / Math.max(1, activeDays))} / day` : "none in 14 days"}
              delta={weekDelta(newLeads)}
              series={newLeads}
              error={Boolean(deals.error)}
            />
            <KpiTile
              label="Human replies · 14 d"
              value={human.length}
              context={sent.length ? `${((human.length / sent.length) * 100).toFixed(1)}% of ${sent.length} sent` : "nothing sent in 14 days"}
              series={replies}
              error={Boolean(recent.error)}
            />
            <KpiTile
              label="Quotes out"
              value={quotes.length}
              context={quotes.length ? <><Money value={quotedUsd} currency="USD" /> on the table</> : "none out"}
              error={Boolean(deals.error)}
            />
            <KpiTile
              label={`Won since ${dayMonth(`${periodStart}T12:00:00+05:00`)}`}
              value={<Money value={wonUsd} currency="USD" />}
              context={wonPeriod.length ? `${wonPeriod.length} deal${wonPeriod.length === 1 ? "" : "s"}` : firstQuote ? `first quote out ${dayMonth(firstQuote)}` : "no quote out yet"}
              error={Boolean(deals.error)}
            />
          </section>
        }
      />
    </>
  );
}
