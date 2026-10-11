import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/app/components/Icon";
import { MenuButton } from "@/app/components/ShellControls";
import { getSession } from "@/lib/session";
import { PACKAGES } from "@/lib/packages";
import { DEFAULT_SCHEDULE } from "@/lib/money";
import { isoDaysFromNow } from "@/lib/dates";
import { ProposalForm } from "../ProposalForm";
import { createProposal } from "../actions";

export const metadata: Metadata = { title: "New proposal" };

type Deal = { id: string; title: string; stage: string; value_usd: number | null; companies: { name: string } | { name: string }[] | null };

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export default async function NewProposal({ searchParams }: { searchParams: Promise<{ q?: string; deal?: string }> }) {
  const { q = "", deal = "" } = await searchParams;
  const { supabase } = await getSession();

  if (/^[0-9a-f-]{36}$/i.test(deal)) {
    // staff read of the deal, its company and primary contact to prefill the form
    const { data: d } = await supabase
      .from("deals")
      .select("id, title, companies(name), contacts:primary_contact_id(full_name, email)")
      .eq("id", deal)
      .maybeSingle();
    if (d) {
      const company = one(d.companies as { name: string } | { name: string }[] | null);
      const contact = one(d.contacts as { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null);
      const valid = isoDaysFromNow(30);
      return (
        <>
          <Head title="New proposal" sub={`For ${company?.name ?? "the deal"} · ${d.title}`} />
          <ProposalForm
            packages={[...PACKAGES]}
            action={createProposal.bind(null, d.id)}
            submitLabel="Create draft"
            showChanges={false}
            initial={{
              title: d.title,
              client_company: company?.name ?? "",
              contact_name: contact?.full_name ?? "",
              contact_email: contact?.email ?? "",
              summary: "",
              scope_md: "",
              timeline_md: "",
              changes_md: "",
              valid_until: valid,
              lines: [],
              schedule: [...DEFAULT_SCHEDULE],
            }}
          />
        </>
      );
    }
  }

  // pick a deal: search deal titles and company names
  const term = q.trim().replace(/[%,()]/g, " ").slice(0, 80);
  let deals: Deal[] = [];
  let failed = false;
  const select = "id, title, stage, value_usd, companies(name)";
  if (term) {
    const [byTitle, byCompany] = await Promise.all([
      supabase.from("deals").select(select).ilike("title", `%${term}%`).limit(30),
      supabase.from("companies").select("id").ilike("name", `%${term}%`).limit(30),
    ]);
    const ids = (byCompany.data ?? []).map((c) => c.id as string);
    const viaCompany = ids.length ? await supabase.from("deals").select(select).in("company_id", ids).limit(30) : { data: [], error: null };
    failed = Boolean(byTitle.error || byCompany.error || viaCompany.error);
    const seen = new Set<string>();
    deals = [...((byTitle.data ?? []) as Deal[]), ...((viaCompany.data ?? []) as Deal[])].filter((x) => !seen.has(x.id) && seen.add(x.id));
  } else {
    const r = await supabase.from("deals").select(select).order("updated_at", { ascending: false }).limit(30);
    failed = Boolean(r.error);
    deals = (r.data ?? []) as Deal[];
  }

  return (
    <>
      <Head title="New proposal" sub="Pick the deal this proposal is for." />
      <section className="panel">
        <form className="row panel-pad" style={{ gap: 8 }} method="get">
          <input className="input grow" name="q" defaultValue={q} placeholder="Search deals or companies" aria-label="Search deals or companies" autoFocus />
          <button className="btn btn-secondary" type="submit">
            <Icon name="search" className="i-sm" />
            Search
          </button>
        </form>
        {failed ? (
          <p className="c-bad t-13 panel-pad">Couldn&apos;t load deals. Reload to retry.</p>
        ) : deals.length === 0 ? (
          <p className="c-3 t-13 panel-pad">{term ? "No deals match." : "No deals yet."}</p>
        ) : (
          <div className="deals">
            {deals.map((d) => (
              <Link key={d.id} href={`/proposals/new?deal=${d.id}`}>
                <span className="grow">
                  <span className="w-500">{d.title}</span>
                  <span className="c-3 t-12" style={{ display: "block" }}>
                    {one(d.companies)?.name ?? "No company"}
                  </span>
                </span>
                <span className="pill">
                  <span className="dot" />
                  {d.stage.replace("_", " ")}
                </span>
                <Icon name="chevR" className="i-sm" />
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Head({ title, sub }: { title: string; sub: string }) {
  return (
    <header className="page-head">
      <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
        <MenuButton />
        <div>
          <h1 className="display">{title}</h1>
          <div className="sub">{sub}</div>
        </div>
      </div>
      <Link className="btn btn-ghost" href="/proposals">
        <Icon name="arrowL" className="i-sm" />
        Proposals
      </Link>
    </header>
  );
}
