import type { Metadata } from "next";
import { Icon } from "@/app/components/Icon";
import { PageHeader } from "@/app/components/PageHeader";
import { Note } from "@/app/components/Note";
import { getSession } from "@/lib/session";
import { countdown, oppValue, safeUrl } from "@/lib/admin-ops";
import { TENDER_SOURCE_LABEL } from "@/lib/admin-settings";
import { findPackage } from "@/lib/packages";
import { dayMonth } from "@/lib/dates";
import { OppActions } from "./OppActions";
import { OppTable, type OppRow, type OppTab } from "./OppTable";

export const metadata: Metadata = { title: "Opportunities" };

type Fit = {
  score?: number; offer_slug?: string; reasons?: string[]; requirements?: string[]; what_we_need?: string[]; effort?: string;
  eligibility?: { status?: string; notes?: string[] };
};
type Opp = {
  id: string; source: string; title: string; buyer: string | null; country: string | null; url: string | null;
  published_at: string | null; deadline_at: string | null; value_min: number | null; value_max: number | null; currency: string | null;
  summary: string | null; fit: Fit | null; status: string; notes: string | null; cpv_or_naics: string[] | null; decided_at?: string | null;
};
const LIST = "id, source, title, buyer, country, url, deadline_at, value_min, value_max, currency, fit, status, notes, decided_at";
const COLS = "id, source, title, buyer, country, url, published_at, deadline_at, value_min, value_max, currency, summary, fit, status, notes, cpv_or_naics";
const UUID = /^[0-9a-f-]{36}$/i;
const ELIG_RANK: Record<string, number> = { ok: 0, flag: 1, exclude: 2 };
// the tabs over the existing statuses (decide_opportunity): Watching = submitted, waiting on the buyer
const TAB_OF: Record<string, OppTab> = { new: "new", submitted: "watching", bid: "bidding", pass: "passed", won: "closed", lost: "closed", expired: "closed" };

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<{ id?: string; tab?: string }> }) {
  const sp = await searchParams;
  const id = UUID.test(sp.id ?? "") ? (sp.id as string) : null;
  const { supabase } = await getSession();
  const now = new Date();
  const [fresh, active, passed, closed, sel] = await Promise.all([
    supabase.from("opportunities").select(LIST).eq("status", "new").limit(500),
    supabase.from("opportunities").select(LIST).in("status", ["bid", "submitted"]).limit(200),
    supabase.from("opportunities").select(LIST, { count: "exact" }).eq("status", "pass").order("decided_at", { ascending: false, nullsFirst: false }).limit(200),
    supabase.from("opportunities").select(LIST).in("status", ["won", "lost", "expired"]).order("decided_at", { ascending: false, nullsFirst: false }).limit(200),
    id ? supabase.from("opportunities").select(COLS).eq("id", id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  const score = (o: Opp) => Math.trunc(Number(o.fit?.score ?? 0));
  const elig = (o: Opp) => o.fit?.eligibility?.status ?? "ok";
  const deadlineMs = (o: Opp) => (o.deadline_at ? Date.parse(o.deadline_at) : Number.POSITIVE_INFINITY);
  const toRow = (o: Opp): OppRow => {
    const [cd, tone] = countdown(o.deadline_at, now);
    return {
      id: o.id,
      title: o.title,
      buyer: o.buyer ?? "",
      country: o.country ?? "",
      source: TENDER_SOURCE_LABEL[o.source] ?? o.source,
      value: oppValue(o),
      deadline: cd,
      tone,
      score: score(o),
      elig: elig(o),
      status: o.status,
      tab: TAB_OF[o.status] ?? "closed",
      reasons: (o.fit?.reasons ?? []).slice(0, 3),
      eligNotes: (o.fit?.eligibility?.notes ?? []).slice(0, 2),
      url: safeUrl(o.url),
      decided: o.decided_at ? dayMonth(o.decided_at) : "",
    };
  };
  // Eligible first, then fit, then the soonest deadline
  const newList = ((fresh.data ?? []) as Opp[]).sort(
    (a, b) => (ELIG_RANK[elig(a)] ?? 0) - (ELIG_RANK[elig(b)] ?? 0) || score(b) - score(a) || deadlineMs(a) - deadlineMs(b),
  );
  const byDeadline = (a: Opp, b: Opp) => deadlineMs(a) - deadlineMs(b);
  const activeList = ((active.data ?? []) as Opp[]).sort(byDeadline);
  const rows = [...newList, ...activeList, ...((passed.data ?? []) as Opp[]), ...((closed.data ?? []) as Opp[])].map(toRow);
  const s = sel.data as Opp | null;
  const worth = newList.filter((o) => elig(o) !== "exclude" && score(o) >= 60).length;
  const counts = { passed: passed.count ?? rows.filter((r) => r.tab === "passed").length };
  const won = rows.filter((r) => r.status === "won").length;
  const lost = rows.filter((r) => r.status === "lost").length;
  const error = Boolean(fresh.error || active.error);

  const detail = s ? (
    <>
      <dl className="kv">
        <dt>Fit</dt>
        <dd className="mono">{score(s)} / 100</dd>
        <dt>Eligibility</dt>
        <dd>{elig(s) === "exclude" ? "Excluded" : elig(s) === "flag" ? "Check before bidding" : "OK"}</dd>
        <dt>Offer</dt>
        <dd>{s.fit?.offer_slug ? (findPackage(s.fit.offer_slug)?.name ?? s.fit.offer_slug) : "–"}</dd>
        <dt>Value</dt>
        <dd className="mono">{oppValue(s)}</dd>
        <dt>Deadline</dt>
        <dd className="mono">{s.deadline_at ? `${s.deadline_at.slice(0, 10)} · ${countdown(s.deadline_at, now)[0]}` : "Not stated"}</dd>
        {s.fit?.effort && (
          <>
            <dt>Effort</dt>
            <dd>{s.fit.effort}</dd>
          </>
        )}
        <dt>Source</dt>
        <dd>{TENDER_SOURCE_LABEL[s.source] ?? s.source}</dd>
        <dt>Status</dt>
        <dd>{s.status}</dd>
        {s.notes && (
          <>
            <dt>Notes</dt>
            <dd>{s.notes}</dd>
          </>
        )}
      </dl>
      <OppActions id={s.id} status={s.status} />
      {s.summary && (
        <div className="untrusted">
          <div className="untrusted-tag">
            <Icon name="alert" className="i-sm" />
            Notice text · untrusted
          </div>
          <div className="pre">{s.summary.slice(0, 2000)}</div>
        </div>
      )}
      {(
        [
          ["Why it fits", s.fit?.reasons],
          ["Eligibility", s.fit?.eligibility?.notes],
          ["Requirements", s.fit?.requirements],
          ["What we need", s.fit?.what_we_need],
        ] as [string, string[] | undefined][]
      ).map(([h, items]) =>
        Array.isArray(items) && items.length ? (
          <div key={h}>
            <div className="label sheet-label">{h}</div>
            <ul className="bullets">
              {items.map((x, k) => (
                <li key={k}>{x}</li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </>
  ) : null;

  return (
    <>
      <PageHeader
        title="Opportunities"
        sub={
          <>
            <span>{newList.length} new</span>
            <span aria-hidden="true">·</span>
            <span>{worth} eligible and worth a look</span>
            <span aria-hidden="true">·</span>
            <span>{activeList.length} active</span>
            <span aria-hidden="true">·</span>
            <span>
              {won} won · {lost} lost · {counts.passed} passed
            </span>
          </>
        }
      />
      {error && <Note retry>Couldn&apos;t load tenders.</Note>}
      <OppTable
        rows={rows}
        passedTotal={counts.passed}
        initialTab={(["new", "watching", "bidding", "passed", "closed"] as OppTab[]).find((t) => t === sp.tab) ?? (s ? (TAB_OF[s.status] ?? "new") : "new")}
        selected={id}
        detail={s ? { id: s.id, title: s.title, sub: [s.buyer, s.country, TENDER_SOURCE_LABEL[s.source] ?? s.source].filter(Boolean).join(" · "), url: safeUrl(s.url), body: detail } : null}
        detailMissing={Boolean(id && !sel.error && !s)}
      />
    </>
  );
}
