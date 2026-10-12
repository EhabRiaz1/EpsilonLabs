import type { Metadata } from "next";
import { MenuButton } from "@/app/components/ShellControls";
import { AutoRefresh } from "@/app/components/AutoRefresh";
import { TrendChart } from "@/app/components/TrendChart";
import { getSession } from "@/lib/session";
import { relativeDay } from "@/lib/tickets";
import { dayMonth } from "@/lib/dates";
import { deckOrder, kindLabel, pktDate, pktMidnight } from "@/lib/admin-ops";
import { ApprovalQueue, type Card, type View } from "./ApprovalQueue";

export const metadata: Metadata = { title: "Approvals" };

type Row = {
  id: string; agent: string; kind: string | null; status: string; held: boolean; held_reason: string | null;
  to_email: string | null; subject: string | null; draft: string; final_text: string | null; lint: { type: string; text: string }[] | null;
  deal_id: string | null; contact_id: string | null; in_reply_to_touch_id: string | null; sequence_step: number | null;
  sequence_parent: string | null; created_at: string;
};
type Named = { id: string; [k: string]: unknown };
const WEDGE: Record<string, string> = { fuel_retail: "W1", industrial_monitoring: "W2", protocol_decode: "W3", other: "Other" };
const VIEWS: View[] = ["all", "cold", "replies", "held"];

async function byId(supabase: Awaited<ReturnType<typeof getSession>>["supabase"], table: string, cols: string, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter(Boolean))] as string[];
  if (!list.length) return new Map<string, Named>();
  const { data } = await supabase.from(table).select(cols).in("id", list.slice(0, 300));
  return new Map(((data ?? []) as unknown as Named[]).map((r) => [r.id, r]));
}

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const sp = await searchParams;
  const view: View = VIEWS.includes(sp.view as View) ? (sp.view as View) : "all";
  const { supabase } = await getSession();
  const now = new Date();
  const midnight = pktMidnight(now);
  const since14 = pktMidnight(now, 13);
  const [q, later, decided, sentToday, spend, created14, decided14, upd, reps] = await Promise.all([
    supabase
      .from("approval_queue")
      .select("id, agent, kind, status, held, held_reason, to_email, subject, draft, final_text, lint, deal_id, contact_id, in_reply_to_touch_id, sequence_step, sequence_parent, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(500),
    supabase.from("actions").select("target_id, at").eq("action", "later").order("at", { ascending: true }).limit(1000),
    supabase.from("approval_queue").select("id", { count: "exact", head: true }).gte("decided_at", midnight),
    supabase.from("touches").select("id", { count: "exact", head: true }).eq("type", "sent").gte("occurred_at", midnight),
    supabase.from("actions").select("cost_usd").eq("action", "llm_call").gte("at", midnight).limit(1000),
    supabase.from("approval_queue").select("created_at").gte("created_at", since14).limit(1000),
    supabase.from("approval_queue").select("decided_at").gte("decided_at", since14).limit(1000),
    supabase.from("updates").select("id, title, body_md, source, week_of, inputs, lint, created_at, projects(name), organizations(name)").eq("status", "draft").order("created_at").limit(100),
    supabase.from("reports").select("id, title, period_label, content, created_at, projects(name), organizations(name)").eq("status", "draft").order("created_at").limit(50),
  ]);
  const rows = (q.data ?? []) as Row[];
  const laterAt = new Map(((later.data ?? []) as { target_id: string; at: string }[]).map((a) => [a.target_id, a.at]));

  const [touches, contacts, deals, parents] = await Promise.all([
    byId(supabase, "touches", "id, subject, body_excerpt, classifier", rows.map((r) => r.in_reply_to_touch_id)),
    byId(supabase, "contacts", "id, full_name, company_id", rows.map((r) => r.contact_id)),
    byId(supabase, "deals", "id, title, company_id, wedge, source_channel", rows.map((r) => r.deal_id)),
    byId(supabase, "approval_queue", "id, draft, final_text", rows.filter((r) => (r.sequence_step ?? 0) >= 2).map((r) => r.sequence_parent)),
  ]);
  const companies = await byId(
    supabase,
    "companies",
    "id, name, wedge, notes",
    [...deals.values()].map((d) => d.company_id as string).concat([...contacts.values()].map((c) => c.company_id as string)),
  );

  const toCard = (r: Row): Card => {
    const t: Partial<Named> = touches.get(r.in_reply_to_touch_id ?? "") ?? {};
    const c: Partial<Named> = contacts.get(r.contact_id ?? "") ?? {};
    const d: Partial<Named> = deals.get(r.deal_id ?? "") ?? {};
    const co: Partial<Named> = companies.get((d.company_id as string) ?? "") ?? companies.get((c.company_id as string) ?? "") ?? {};
    const who = (c.full_name as string) || "";
    const company = (co.name as string) || "";
    const step = (r.sequence_step ?? 0) >= 2 ? r.sequence_step : null;
    const parent = step ? parents.get(r.sequence_parent ?? "") : undefined;
    const cls = (t.classifier ?? null) as { label?: string; confidence?: number } | null;
    const subject = String((t.subject as string) || (d.title as string) || r.subject || "").replace(/^(re|fwd?):\s*/i, "");
    return {
      id: r.id,
      kind: r.kind || "reply",
      label: kindLabel(r.kind, r.sequence_step),
      who: who || company || r.to_email || "Unknown sender",
      company: who ? company : "",
      to: r.to_email ?? "",
      subject,
      thread: r.subject ?? "",
      when: relativeDay(r.created_at, now),
      wedge: WEDGE[(d.wedge as string) || (co.wedge as string) || ""] ?? "",
      channel: (d.source_channel as string) || "",
      theyWrote: ((t.body_excerpt as string) || (r.kind === "outbound" && !step ? (co.notes as string) || "" : "")).slice(0, 2000),
      ours: parent ? String(parent.final_text || parent.draft || "") : "",
      draft: r.final_text ?? r.draft,
      edited: r.final_text != null,
      lint: Array.isArray(r.lint) ? r.lint : [],
      held: r.held,
      heldReason: r.held_reason ?? "",
      classifier: cls?.label ? `${cls.label}${typeof cls.confidence === "number" ? ` ${Math.round(cls.confidence * 100)}%` : ""}` : "",
      agent: r.agent,
    };
  };
  // 012: client-portal drafts in the same queue (weekly updates publish from here; reports open their page)
  type U = { id: string; title: string; body_md: string; source: string; week_of: string | null; inputs: Record<string, unknown> | null; lint: { type: string; text: string }[] | null; created_at: string; projects: { name: string } | { name: string }[] | null; organizations: { name: string } | { name: string }[] | null };
  type Rp = { id: string; title: string; period_label: string; content: { summary?: string[] } | null; created_at: string; projects: { name: string } | { name: string }[] | null; organizations: { name: string } | { name: string }[] | null };
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const updateCards: Card[] = ((upd.data ?? []) as unknown as U[]).map((u) => ({
    id: u.id, kind: "update", source: "update", label: u.source === "weekly" ? "Weekly update" : "Update", who: one(u.organizations)?.name ?? "",
    company: one(u.projects)?.name ?? "", to: `Publishes to the ${one(u.organizations)?.name ?? "client"} portal`, subject: u.title, thread: "",
    when: relativeDay(u.created_at, now), wedge: "", channel: "", theyWrote: "", ours: "", draft: u.body_md, edited: false,
    lint: Array.isArray(u.lint) ? u.lint : [], held: false, heldReason: "",
    classifier: u.inputs ? `${u.inputs.tickets_done ?? 0} done · ${u.inputs.commits ?? 0} commits` : "", agent: u.source === "weekly" ? "worker" : "you",
  }));
  const reportCards: Card[] = ((reps.data ?? []) as unknown as Rp[]).map((r) => ({
    id: r.id, kind: "report", source: "report", href: `/reports/${r.id}`, label: "Delivery report", who: one(r.organizations)?.name ?? "",
    company: one(r.projects)?.name ?? "", to: `Publishes to the ${one(r.organizations)?.name ?? "client"} portal`, subject: `${r.title}${r.period_label ? ` · ${r.period_label}` : ""}`,
    thread: "", when: relativeDay(r.created_at, now), wedge: "", channel: "", theyWrote: "", ours: "",
    draft: (r.content?.summary ?? []).join("\n\n") || "(open the report to review it)", edited: false, lint: [], held: false, heldReason: "", classifier: "", agent: "worker",
  }));
  const ready = [...deckOrder(rows.filter((r) => !r.held), laterAt).map(toCard), ...updateCards, ...reportCards];
  const held = rows.filter((r) => r.held).map(toCard);
  const cost = ((spend.data ?? []) as { cost_usd: number | null }[]).reduce((s, a) => s + Number(a.cost_usd ?? 0), 0);

  // queue volume, last 14 days (PKT days)
  const days = Array.from({ length: 14 }, (_, i) => pktDate(new Date(now.getTime() - (13 - i) * 86_400_000)));
  const per = (list: (string | null)[]) => days.map((day) => list.filter((x) => x && pktDate(new Date(x)) === day).length);
  const received = per(((created14.data ?? []) as { created_at: string }[]).map((r) => r.created_at));
  const done = per(((decided14.data ?? []) as { decided_at: string | null }[]).map((r) => r.decided_at));

  return (
    <>
      <header className="greet">
        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
          <MenuButton />
          <div>
            <h1>Approvals</h1>
            <div className="date">
              {ready.length ? `${ready.length} waiting` : "nothing waiting"} · {decided.count ?? 0} decided today · {held.length} held
            </div>
          </div>
        </div>
        <div className="actions">
          <AutoRefresh seconds={30} />
        </div>
      </header>

      <div className="top-grid">
        <section className="kpi kpi-2">
          <div className="panel tile"><div className="l"><div className="k">Waiting on you</div><div className="v big num">{ready.length}</div><div className="d">{ready[0] ? `oldest ${ready[0].when}` : "all clear"}</div></div></div>
          <div className="panel tile"><div className="l"><div className="k">Decided today</div><div className="v big num">{decided.count ?? 0}</div><div className="d">{held.length} held for a look</div></div></div>
          <div className="panel tile"><div className="l"><div className="k">Sent today</div><div className="v big num">{sentToday.count ?? 0}</div><div className="d">from the Mac outbox</div></div></div>
          <div className="panel tile"><div className="l"><div className="k">AI spend today</div><div className="v big num">${Math.floor(cost)}<span className="dec">.{String(Math.round((cost % 1) * 100)).padStart(2, "0")}</span></div><div className="d">llm calls since midnight PKT</div></div></div>
        </section>
        <section className="panel chart-panel" aria-label="Queue volume">
          <div className="row between">
            <h2 className="t-16" style={{ fontFamily: "var(--font-sans)", fontWeight: 600 }}>Queue · last 14 days</h2>
          </div>
          <TrendChart
            labels={days.map((d, i) => (i === 0 || i === 7 ? dayMonth(d) : i === 13 ? "Today" : ""))}
            series={[{ name: "Received", data: received }, { name: "Decided", data: done }]}
            aria="Queue items received and decided per day, last 14 days"
          />
        </section>
      </div>

      {q.error ? (
        <section className="panel q-panel"><p className="c-bad t-13 panel-pad">Couldn&apos;t load the queue. Reload to retry.</p></section>
      ) : (
        <ApprovalQueue ready={ready} held={held} initialView={view} decidedToday={decided.count ?? 0} />
      )}
    </>
  );
}
