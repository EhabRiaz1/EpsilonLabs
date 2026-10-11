import type { Metadata } from "next";
import Link from "next/link";
import { MenuButton } from "@/app/components/ShellControls";
import { Icon } from "@/app/components/Icon";
import { getSession } from "@/lib/session";
import { countdown, oppValue, safeUrl } from "@/lib/admin-ops";
import { TENDER_SOURCE_LABEL } from "@/lib/admin-settings";
import { findPackage } from "@/lib/packages";
import { OppActions } from "./OppActions";

export const metadata: Metadata = { title: "Opportunities" };

type Fit = {
  score?: number; offer_slug?: string; reasons?: string[]; requirements?: string[]; what_we_need?: string[]; effort?: string;
  eligibility?: { status?: string; notes?: string[] };
};
type Opp = {
  id: string; source: string; title: string; buyer: string | null; country: string | null; url: string | null;
  published_at: string | null; deadline_at: string | null; value_min: number | null; value_max: number | null; currency: string | null;
  summary: string | null; fit: Fit | null; status: string; notes: string | null; cpv_or_naics: string[] | null;
};
const COLS = "id, source, title, buyer, country, url, published_at, deadline_at, value_min, value_max, currency, summary, fit, status, notes, cpv_or_naics";
const ELIG: Record<string, [string, string]> = { ok: ["OK", "pill-good"], flag: ["CHECK", "pill-warn"], exclude: ["EXCLUDED", "pill-bad"] };
const UUID = /^[0-9a-f-]{36}$/i;
const TONE: Record<string, string> = { red: "c-bad", amber: "c-warn", "": "c-3" };

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const sp = await searchParams;
  const id = UUID.test(sp.id ?? "") ? (sp.id as string) : null;
  const { supabase } = await getSession();
  const now = new Date();
  const [fresh, active, closed, passed, one] = await Promise.all([
    supabase.from("opportunities").select(COLS).eq("status", "new").limit(500),
    supabase.from("opportunities").select(COLS).in("status", ["bid", "submitted"]).limit(200),
    supabase.from("opportunities").select("status").in("status", ["won", "lost"]).limit(1000),
    supabase.from("opportunities").select("id", { count: "exact", head: true }).eq("status", "pass"),
    id ? supabase.from("opportunities").select(COLS).eq("id", id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const score = (o: Opp) => Math.trunc(Number(o.fit?.score ?? 0));
  const newList = ((fresh.data ?? []) as Opp[]).sort((a, b) => score(b) - score(a) || countdown(a.deadline_at, now)[0].localeCompare(countdown(b.deadline_at, now)[0]));
  const activeList = (active.data ?? []) as Opp[];
  const closedRows = (closed.data ?? []) as { status: string }[];
  const sel = one.data as Opp | null;
  const worth = newList.filter((o) => score(o) >= 60).length;

  const row = (o: Opp) => {
    const [cd, tone] = countdown(o.deadline_at, now);
    const el = ELIG[o.fit?.eligibility?.status ?? "ok"] ?? ELIG.ok;
    return (
      <Link key={o.id} href={`/opportunities?id=${o.id}`} aria-current={o.id === id ? "true" : undefined}>
        <span className={`score${score(o) >= 60 ? " hi" : score(o) < 40 ? " lo" : ""}`}>{score(o)}</span>
        <span className="grow">
          <span className="w-600 t-13" style={{ display: "block" }}>{o.title}</span>
          <span className="c-3 t-12 truncate" style={{ display: "block" }}>
            {[o.buyer, o.country, TENDER_SOURCE_LABEL[o.source] ?? o.source, oppValue(o)].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span className="t-12" style={{ textAlign: "right" }}>
          <span className={`pill ${el[1]}`} style={{ marginBottom: 4 }}><span className="dot" />{el[0]}</span>
          <span className={TONE[tone]} style={{ display: "block" }}>{cd}</span>
        </span>
      </Link>
    );
  };

  return (
    <>
      <header className="page-head">
        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
          <MenuButton />
          <div>
            <h1 className="display">Opportunities</h1>
            <div className="sub">
              {newList.length} new · {worth} worth a look · {activeList.length} active · {closedRows.filter((r) => r.status === "won").length} won ·{" "}
              {closedRows.filter((r) => r.status === "lost").length} lost · {passed.count ?? 0} passed
            </div>
          </div>
        </div>
      </header>

      {sel && (
        <section className="panel deal-panel" aria-label="Tender">
          <div className="panel-head">
            <div className="grow">
              <h2>{sel.title}</h2>
              <div className="c-3 t-12">{[sel.buyer, sel.country, TENDER_SOURCE_LABEL[sel.source] ?? sel.source].filter(Boolean).join(" · ")}</div>
            </div>
            <Link className="btn btn-secondary btn-icon" href="/opportunities" aria-label="Close"><Icon name="x" /></Link>
          </div>
          <div className="detail-body" style={{ paddingTop: 0 }}>
            <div className="stack" style={{ minWidth: 0 }}>
              {sel.summary && (
                <div className="untrusted">
                  <div className="untrusted-tag"><Icon name="alert" className="i-sm" />Notice text · untrusted</div>
                  <div className="pre">{sel.summary.slice(0, 2000)}</div>
                </div>
              )}
              {[["Why it fits", sel.fit?.reasons], ["Eligibility", sel.fit?.eligibility?.notes], ["Requirements", sel.fit?.requirements], ["What we need", sel.fit?.what_we_need]].map(([h, items]) =>
                Array.isArray(items) && items.length ? (
                  <div key={h as string}>
                    <div className="eyebrow">{h as string}</div>
                    <ul className="t-13" style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
                      {(items as string[]).map((x, k) => <li key={k}>{x}</li>)}
                    </ul>
                  </div>
                ) : null,
              )}
            </div>
            <div className="side">
              <dl className="fields">
                <dt>Fit</dt><dd>{score(sel)} / 100</dd>
                <dt>Offer</dt><dd>{sel.fit?.offer_slug ? (findPackage(sel.fit.offer_slug)?.name ?? sel.fit.offer_slug) : "—"}</dd>
                <dt>Value</dt><dd>{oppValue(sel)}</dd>
                <dt>Deadline</dt><dd>{sel.deadline_at ? `${sel.deadline_at.slice(0, 10)} · ${countdown(sel.deadline_at, now)[0]}` : "Not stated"}</dd>
                {sel.fit?.effort && (<><dt>Effort</dt><dd>{sel.fit.effort}</dd></>)}
                <dt>Status</dt><dd>{sel.status}</dd>
                {sel.notes && (<><dt>Notes</dt><dd>{sel.notes}</dd></>)}
              </dl>
              {safeUrl(sel.url) && (
                <a className="btn btn-secondary" href={safeUrl(sel.url)} target="_blank" rel="noopener noreferrer nofollow">
                  <Icon name="external" className="i-sm" />Open the notice
                </a>
              )}
              <OppActions id={sel.id} status={sel.status} />
            </div>
          </div>
        </section>
      )}

      {fresh.error && <p className="auth-error" role="alert">Couldn&apos;t load tenders. Reload to retry.</p>}

      <div className="grid-main">
        <section className="panel">
          <div className="panel-head"><h2>New</h2><span className="more c-3 t-12">by fit, then deadline</span></div>
          <div className="list-rows" style={{ padding: "0 12px 12px" }}>
            {newList.length ? newList.slice(0, 150).map(row) : <p className="c-3 t-13" style={{ padding: "8px 10px" }}>No new tenders. The scan runs daily at 06:00 PKT.</p>}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Active</h2><span className="more c-3 t-12">bid or submitted</span></div>
          <div className="list-rows" style={{ padding: "0 12px 12px" }}>
            {activeList.length ? activeList.map(row) : <p className="c-3 t-13" style={{ padding: "8px 10px" }}>Nothing in progress.</p>}
          </div>
        </section>
      </div>
    </>
  );
}
