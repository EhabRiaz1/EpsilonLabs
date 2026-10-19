import type { Metadata } from "next";
import { Icon } from "@/app/components/Icon";
import { ActionButton, ActionForm } from "@/app/components/Forms";
import { displayName } from "@/lib/session";
import { portalContext } from "@/lib/portal-context";
import { dayMonthYear } from "@/lib/dates";
import { submitTestimonial, withdrawTestimonial } from "../actions";
import { PortalHeader } from "../_ui/PortalHeader";
import { NoOrg } from "../_ui/NoOrg";

export const metadata: Metadata = { title: "Testimonial" };

type Row = { id: string; quote: string; author_name: string; author_role: string; status: string; approved_at: string | null; created_at: string };
const LABEL: Record<string, string> = { requested: "Epsilon asked", client_approved: "Approved by you", published: "On epsilon-labs.co", withdrawn: "Withdrawn" };

/** E4: the client writes or approves testimonial wording. Nothing is published until they approve it here. */
export default async function TestimonialPage() {
  const { supabase, claims, org, projects, unread } = await portalContext();
  if (!org) return <NoOrg email={claims.email} />;
  const { data } = await supabase.from("testimonials").select("id, quote, author_name, author_role, status, approved_at, created_at").eq("org_id", org.orgId).order("created_at", { ascending: false });
  const rows = (data ?? []) as Row[];
  const open = rows.find((r) => r.status === "requested") ?? null;
  const me = displayName(claims);
  const form = (id: string | null, quote: string, idp: string) => (
    <ActionForm action={submitTestimonial.bind(null, id, org.orgId)} submit="Approve this wording" icon="check">
      <div className="stack" style={{ gap: 10 }}>
        <div className="field">
          <label className="label" htmlFor={`${idp}-quote`}>In your words</label>
          <textarea className="textarea" id={`${idp}-quote`} name="quote" rows={5} minLength={10} maxLength={1200} required defaultValue={quote} placeholder="What changed for you, in a sentence or two." />
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <div className="field grow"><label className="label" htmlFor={`${idp}-name`}>Your name</label><input className="input" id={`${idp}-name`} name="author_name" required maxLength={120} defaultValue={me === (claims.email ?? "").split("@")[0] ? "" : me} /></div>
          <div className="field grow"><label className="label" htmlFor={`${idp}-role`}>Role <span className="c-3">(optional)</span></label><input className="input" id={`${idp}-role`} name="author_role" maxLength={120} placeholder="Plant manager" /></div>
        </div>
        <label className="row t-13" style={{ gap: 8, alignItems: "flex-start" }}>
          <input type="checkbox" name="consent" required style={{ marginTop: 3 }} />
          <span>Epsilon Labs may quote this with my name, role and {org.name} on epsilon-labs.co and in proposals. I can withdraw it here at any time.</span>
        </label>
      </div>
    </ActionForm>
  );
  return (
    <>
      <PortalHeader title="Testimonial" sub={`${org.name} · only what you approve here is ever quoted`} unread={unread} canRequest={projects.length > 0} />
      <div className="grid-main" style={{ marginTop: 0 }}>
        <div className="col">
          <section className="panel panel-pad">
            {open ? (
              <>
                <h2 className="t-16 w-600" style={{ marginBottom: 6 }}>Epsilon asked for a short testimonial</h2>
                <p className="hint" style={{ marginBottom: 12 }}>{open.quote ? "He suggested the wording below. Change anything, or rewrite it entirely, then approve." : "Two or three sentences is plenty. Approve it when it reads right."}</p>
                {form(open.id, open.quote, "t-open")}
              </>
            ) : (
              <>
                <h2 className="t-16 w-600" style={{ marginBottom: 6 }}>Write a testimonial</h2>
                <p className="hint" style={{ marginBottom: 12 }}>If the work helped, a couple of sentences in your own words helps Epsilon Labs a lot. No obligation.</p>
                {form(null, "", "t-new")}
              </>
            )}
          </section>
        </div>
        <div className="col">
          <section className="panel">
            <div className="panel-head"><h2>Yours</h2></div>
            {rows.filter((r) => r.status !== "requested").length === 0 ? (
              <p className="c-3 t-13" style={{ padding: "0 22px 16px" }}>Nothing approved yet.</p>
            ) : (
              <div className="list-rows" style={{ padding: "0 18px 10px" }}>
                {rows.filter((r) => r.status !== "requested").map((r) => (
                  <div key={r.id} style={{ alignItems: "flex-start" }}>
                    <span className="avatar avatar-soft" aria-hidden="true"><Icon name="sparkle" className="i-sm" /></span>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontStyle: "italic" }}>&ldquo;{r.quote}&rdquo;</span>
                      <span className="c-3 t-12">{[r.author_name, r.author_role].filter(Boolean).join(", ")} · {LABEL[r.status]}{r.approved_at ? ` · ${dayMonthYear(r.approved_at)}` : ""}</span>
                    </span>
                    {(r.status === "client_approved" || r.status === "published") && (
                      <ActionButton className="btn btn-ghost btn-sm" label="Withdraw" confirmText="Withdraw this testimonial? Epsilon is told so it comes off the website." action={withdrawTestimonial.bind(null, r.id)} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
