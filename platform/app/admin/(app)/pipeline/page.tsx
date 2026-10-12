import type { Metadata } from "next";
import Link from "next/link";
import { MenuButton } from "@/app/components/ShellControls";
import { Icon } from "@/app/components/Icon";
import { getSession } from "@/lib/session";
import { ago, money } from "@/lib/admin-ops";
import { stamp } from "@/lib/dates";

export const metadata: Metadata = { title: "Pipeline" };

// dashboard/data.py STAGES / CHANNELS
const STAGES: [string, string][] = [
  ["lead", "Lead"], ["conversation", "Conversation"], ["scoping_call", "Scoping"], ["quote_out", "Quote out"],
  ["won_lost", "Won / Lost"], ["dormant", "Dormant"],
];
const CHANNELS = ["referral", "inbound", "outbound", "dream25", "pre_existing"];
const CH_LABEL: Record<string, string> = { referral: "Referral", inbound: "Inbound", outbound: "Outbound", dream25: "Dream 25", pre_existing: "Existing" };
const STRATEGY_TAG: Record<string, string> = {
  s2_trigger: "S2", s3_regulation: "S3", s4_partner: "S4", s5_intent: "S5", s7_orphaned: "S7", s8_tradeshow: "S8", s9_crowdfund: "S9",
  s10_accelerator: "S10", s11_software: "S11", s12_devpartner: "S12", s13_hn: "S13", legacy: "LEGACY",
};
const UUID = /^[0-9a-f-]{36}$/i;

type Deal = {
  id: string; title: string; stage: string; source_channel: string; value_usd: number | null; strategy: string | null;
  company_id: string; created_at: string; updated_at: string; companies: { name: string } | { name: string }[] | null;
};
type Touch = { id: string; deal_id: string | null; type: string; direction: string; subject: string | null; body_excerpt: string | null; occurred_at: string };
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ channel?: string; deal?: string }> }) {
  const sp = await searchParams;
  const channel = CHANNELS.includes(sp.channel ?? "") ? (sp.channel as string) : null;
  const dealId = UUID.test(sp.deal ?? "") ? (sp.deal as string) : null;
  const { supabase } = await getSession();
  const now = new Date();
  let q = supabase
    .from("deals")
    .select("id, title, stage, source_channel, value_usd, strategy, company_id, created_at, updated_at, companies(name)")
    .order("updated_at", { ascending: false })
    .limit(1000);
  if (channel) q = q.eq("source_channel", channel);
  const [deals, touches] = await Promise.all([
    q,
    supabase.from("touches").select("deal_id, subject, occurred_at").not("deal_id", "is", null).order("occurred_at", { ascending: false }).limit(1000),
  ]);
  const list = (deals.data ?? []) as Deal[];
  const latest = new Map<string, string>();
  for (const t of (touches.data ?? []) as Touch[]) if (t.deal_id && !latest.has(t.deal_id)) latest.set(t.deal_id, t.subject ?? "");
  const groups = new Map<string, Deal[]>(STAGES.map(([k]) => [k, []]));
  for (const d of list) groups.get(d.stage === "won" || d.stage === "lost" ? "won_lost" : d.stage)?.push(d);

  // deal panel (data.deal_panel)
  let panel: { deal: Deal; company: Record<string, unknown> | null; contacts: Record<string, string | null>[]; touches: Touch[] } | null = null;
  if (dealId) {
    const { data: d } = await supabase.from("deals").select("id, title, stage, source_channel, value_usd, strategy, company_id, created_at, updated_at, companies(name)").eq("id", dealId).maybeSingle();
    if (d) {
      const deal = d as Deal;
      const [co, ct, tt] = await Promise.all([
        supabase.from("companies").select("name, domain, country, sector, notes").eq("id", deal.company_id).maybeSingle(),
        supabase.from("contacts").select("full_name, email, role, opted_out").eq("company_id", deal.company_id).limit(20),
        supabase.from("touches").select("id, deal_id, type, direction, subject, body_excerpt, occurred_at").eq("deal_id", dealId).order("occurred_at", { ascending: false }).limit(10),
      ]);
      panel = { deal, company: co.data as Record<string, unknown> | null, contacts: (ct.data ?? []) as Record<string, string | null>[], touches: (tt.data ?? []) as Touch[] };
    }
  }
  const href = (p: { channel?: string | null; deal?: string | null }) => {
    const u = new URLSearchParams();
    if (p.channel) u.set("channel", p.channel);
    if (p.deal) u.set("deal", p.deal);
    const s = u.toString();
    return s ? `/pipeline?${s}` : "/pipeline";
  };

  return (
    <>
      <header className="page-head">
        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
          <MenuButton />
          <div>
            <h1 className="display">Pipeline</h1>
            <div className="sub">{list.length} deals{channel ? ` · ${CH_LABEL[channel]}` : ""} · amber after 7 days still, red after 14</div>
          </div>
        </div>
      </header>

      <nav className="tabs scroll-x" aria-label="Channel" style={{ marginBottom: 14 }}>
        <Link className="tab" href={href({})} aria-current={!channel ? "page" : undefined}>All</Link>
        {CHANNELS.map((c) => (
          <Link key={c} className="tab" href={href({ channel: c })} aria-current={channel === c ? "page" : undefined}>{CH_LABEL[c]}</Link>
        ))}
      </nav>

      {deals.error && <p className="auth-error" role="alert">Couldn&apos;t load deals. Reload to retry.</p>}

      {panel && (
        <section className="panel deal-panel" aria-label="Deal">
          <div className="panel-head">
            <div className="grow">
              <h2>{one(panel.deal.companies)?.name ?? panel.deal.title}</h2>
              <div className="c-3 t-12">{panel.deal.title}</div>
            </div>
            <Link className="btn btn-secondary btn-icon" href={href({ channel })} aria-label="Close deal"><Icon name="x" /></Link>
          </div>
          <div className="detail-body" style={{ paddingTop: 0 }}>
            <div className="stack" style={{ minWidth: 0 }}>
              <div className="eyebrow">Last touches</div>
              {panel.touches.length ? panel.touches.map((t) => (
                <div key={t.id} className={t.direction === "inbound" ? "untrusted" : "comment"}>
                  {t.direction === "inbound" && <div className="untrusted-tag"><Icon name="alert" className="i-sm" />They wrote · untrusted</div>}
                  <div className="c-3 t-12">{t.type.replace(/_/g, " ")} · {t.direction} · {ago(t.occurred_at, now)} ago</div>
                  {t.subject && <div className="w-600 t-13">{t.subject}</div>}
                  {t.body_excerpt && <div className="pre t-13">{t.body_excerpt.slice(0, 600)}</div>}
                </div>
              )) : <p className="c-3 t-13">No touches yet.</p>}
            </div>
            <div className="side">
              <dl className="fields">
                <dt>Stage</dt><dd>{panel.deal.stage.replace(/_/g, " ")}</dd>
                <dt>Channel</dt><dd>{CH_LABEL[panel.deal.source_channel] ?? panel.deal.source_channel}</dd>
                <dt>Value</dt><dd>{panel.deal.value_usd != null ? money(Number(panel.deal.value_usd)) : "—"}</dd>
                {panel.deal.strategy && (<><dt>Strategy</dt><dd>{STRATEGY_TAG[panel.deal.strategy] ?? panel.deal.strategy}</dd></>)}
                <dt>Opened</dt><dd>{stamp(panel.deal.created_at)}</dd>
                {panel.company?.domain ? (<><dt>Domain</dt><dd>{String(panel.company.domain)}</dd></>) : null}
                {panel.company?.country ? (<><dt>Country</dt><dd>{String(panel.company.country)}</dd></>) : null}
              </dl>
              <div className="eyebrow">Contacts</div>
              {panel.contacts.length ? panel.contacts.map((c, k) => (
                <div key={k} className="t-13">
                  <strong>{c.full_name || c.email}</strong> {c.role ? <span className="c-3">· {c.role}</span> : null}
                  <div className="c-3 t-12">{c.email}{c.opted_out ? " · opted out" : ""}</div>
                </div>
              )) : <p className="c-3 t-13">None on file.</p>}
            </div>
          </div>
        </section>
      )}

      <div className="board">
        {STAGES.map(([k, label]) => {
          const g = groups.get(k) ?? [];
          return (
            <section key={k} className="panel board-col" aria-label={label}>
              <div className="panel-head">
                <h2>{label}</h2>
                <span className="more c-3 t-12">{g.length}{g.length ? ` · ${money(g.reduce((s, d) => s + Number(d.value_usd ?? 0), 0))}` : ""}</span>
              </div>
              <div className="list-rows" style={{ padding: "0 12px 12px" }}>
                {g.slice(0, 60).map((d) => {
                  const days = Math.max(0, Math.floor((now.getTime() - Date.parse(d.updated_at || d.created_at)) / 86_400_000));
                  const tone = days > 14 ? "c-bad" : days > 7 ? "c-warn" : "c-3";
                  return (
                    <Link key={d.id} href={href({ channel, deal: d.id })} aria-current={d.id === dealId ? "true" : undefined}>
                      <span className="grow">
                        <span className="w-600 t-13 truncate" style={{ display: "block" }}>{one(d.companies)?.name ?? d.title}</span>
                        <span className="c-3 t-12 truncate" style={{ display: "block" }}>
                          {CH_LABEL[d.source_channel] ?? d.source_channel}
                          {d.strategy ? ` · ${STRATEGY_TAG[d.strategy] ?? d.strategy}` : ""}
                          {latest.get(d.id) ? ` · ${latest.get(d.id)}` : ""}
                        </span>
                      </span>
                      <span className="t-12" style={{ textAlign: "right" }}>
                        <span style={{ display: "block" }}>{d.value_usd != null ? money(Number(d.value_usd)) : ""}</span>
                        <span className={tone}>{days}d</span>
                      </span>
                    </Link>
                  );
                })}
                {!g.length && <p className="c-3 t-12" style={{ padding: "8px 4px" }}>None.</p>}
                {g.length > 60 && <p className="c-3 t-12" style={{ padding: "8px 4px" }}>{g.length - 60} more not shown.</p>}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
