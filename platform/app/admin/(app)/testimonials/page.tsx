import type { Metadata } from "next";
import { Icon } from "@/app/components/Icon";
import { PageHeader } from "@/app/components/PageHeader";
import { Empty } from "@/app/components/Empty";
import { Note } from "@/app/components/Note";
import { Sheet } from "@/app/components/Sheet";
import { SheetButton } from "@/app/components/SheetButton";
import { ActionButton, ActionForm, CopyButton } from "@/app/components/Forms";
import { getSession } from "@/lib/session";
import { dayMonth } from "@/lib/dates";
import { websiteSnippet } from "@/lib/testimonials";
import { markTestimonialPublished, requestTestimonial, withdrawTestimonialAdmin } from "./actions";

export const metadata: Metadata = { title: "Testimonials" };

type Row = { id: string; org_id: string; quote: string; author_name: string; author_role: string; status: string; created_at: string; approved_at: string | null; published_at: string | null; organizations: { name: string } | { name: string }[] | null; projects: { name: string } | { name: string }[] | null };
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const TONE: Record<string, string> = { requested: "pill-warn", client_approved: "pill-good", published: "pill-accent", withdrawn: "" };
const LABEL: Record<string, string> = { requested: "Requested", client_approved: "Approved by client", published: "On the website", withdrawn: "Withdrawn" };

export default async function TestimonialsPage() {
  const { supabase } = await getSession();
  const [ts, orgs] = await Promise.all([
    supabase.from("testimonials").select("id, org_id, quote, author_name, author_role, status, created_at, approved_at, published_at, organizations(name), projects(name)").order("created_at", { ascending: false }).limit(200),
    supabase.from("organizations").select("id, name, projects(id, name)").eq("status", "active").eq("is_demo", false).order("name"),
  ]);
  const rows = (ts.data ?? []) as unknown as Row[];
  const approved = rows.filter((r) => r.status === "client_approved" || r.status === "published");
  const others = rows.filter((r) => !(r.status === "client_approved" || r.status === "published"));
  const os = (orgs.data ?? []) as unknown as { id: string; name: string; projects: { id: string; name: string }[] }[];

  return (
    <>
      <PageHeader
        title="Testimonials"
        sub={
          <>
            <span>{approved.length} approved by clients</span>
            <span aria-hidden="true">·</span>
            <span>copy an approved one into the site source yourself; nothing edits epsilon-labs.co automatically</span>
          </>
        }
        actions={
          <SheetButton sheet="testimonial-ask" className="btn btn-primary">
            <Icon name="sparkle" className="i-sm" />
            Ask for one
          </SheetButton>
        }
      />
      {ts.error && <Note retry>Couldn&apos;t load testimonials.</Note>}
      <div className="stack gap-12">
          <section className="panel">
            <div className="panel-head"><h2>Approved by clients</h2><span className="c-3 t-12 more">{approved.length}</span></div>
            {approved.length === 0 && (
              <Empty
                icon="sparkle"
                title="None yet"
                action={
                  <SheetButton sheet="testimonial-ask" className="btn btn-primary">
                    <Icon name="sparkle" className="i-sm" />
                    Ask for one
                  </SheetButton>
                }
              >
                <p>Referral asks after a project closes also point clients to their Testimonial page.</p>
              </Empty>
            )}
            {approved.map((t) => {
              const org = one(t.organizations)?.name ?? "";
              const snip = websiteSnippet({ quote: t.quote, author_name: t.author_name, author_role: t.author_role, org_name: org });
              return (
                <div key={t.id} style={{ borderTop: "1px solid var(--line)", padding: "16px 22px" }}>
                  <blockquote className="t-16" style={{ margin: "0 0 8px", fontStyle: "italic" }}>&ldquo;{t.quote}&rdquo;</blockquote>
                  <div className="c-3 t-12" style={{ marginBottom: 10 }}>
                    {[t.author_name, t.author_role, org].filter(Boolean).join(", ")} · approved {t.approved_at ? dayMonth(t.approved_at) : ""}
                    {t.published_at ? ` · on the website since ${dayMonth(t.published_at)}` : ""}
                  </div>
                  <div className="row wrap" style={{ gap: 8 }}>
                    <span className={`pill ${TONE[t.status]}`}><span className="dot" />{LABEL[t.status]}</span>
                    <CopyButton text={snip.html} label="Copy for website (HTML)" />
                    <CopyButton text={snip.text} label="Copy text" />
                    {t.status === "client_approved" && <ActionButton className="btn btn-ghost btn-sm" label="Mark as on the website" action={markTestimonialPublished.bind(null, t.id)} />}
                    <ActionButton className="btn btn-ghost btn-sm" label="Withdraw" confirmText="Withdraw this testimonial? Remove it from the website too." action={withdrawTestimonialAdmin.bind(null, t.id)} />
                  </div>
                </div>
              );
            })}
          </section>
          {others.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2>Requested and withdrawn</h2></div>
              <div className="list-rows" style={{ padding: "0 18px 10px" }}>
                {others.map((t) => (
                  <div key={t.id}>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="w-600">{one(t.organizations)?.name}{one(t.projects)?.name ? ` · ${one(t.projects)?.name}` : ""}</span>
                      <span className="c-3 t-12 truncate" style={{ display: "block" }}>{t.quote ? `“${t.quote}”` : "No wording suggested"} · {dayMonth(t.created_at)}</span>
                    </span>
                    <span className={`pill ${TONE[t.status]}`}><span className="dot" />{LABEL[t.status]}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
      </div>

      <Sheet id="testimonial-ask" title="Ask for a testimonial" sub="The client's team gets a portal notification and a Testimonial page with your suggested wording, which they can rewrite before approving.">
            <ActionForm action={requestTestimonial} submit="Send the request" icon="sparkle">
              <div className="stack" style={{ gap: 10 }}>
                <div className="field">
                  <label className="label" htmlFor="t-org">Client</label>
                  <select className="select" id="t-org" name="org_id" required defaultValue="">
                    <option value="" disabled>Pick a client</option>
                    {os.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="label" htmlFor="t-project">Project <span className="c-3">(optional)</span></label>
                  <select className="select" id="t-project" name="project_id" defaultValue="">
                    <option value="">Any</option>
                    {os.flatMap((o) => (o.projects ?? []).map((p) => <option key={p.id} value={p.id}>{o.name} · {p.name}</option>))}
                  </select>
                </div>
                <div className="field">
                  <label className="label" htmlFor="t-suggested">Suggested wording <span className="c-3">(optional)</span></label>
                  <textarea className="textarea" id="t-suggested" name="suggested" rows={4} maxLength={1200} />
                </div>
              </div>
            </ActionForm>
      </Sheet>
    </>
  );
}
