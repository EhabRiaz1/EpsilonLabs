import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/app/components/Icon";
import { MenuButton } from "@/app/components/ShellControls";
import { ActionForm } from "@/app/components/Forms";
import { getSession } from "@/lib/session";
import { formatMoney } from "@/lib/money";
import { isoDaysFromNow } from "@/lib/dates";
import { createAdhocInvoice, createScheduleInvoice } from "../actions";
import { InvoiceFields } from "../InvoiceFields";

export const metadata: Metadata = { title: "New invoice" };

type Proposal = { id: string; title: string; client_company: string; total: number; currency: string; schedule: { label: string; pct: number }[]; org_id: string };
type Inv = { proposal_id: string | null; schedule_stage: number | null; kind: string; status: string };

export default async function NewInvoice() {
  const { supabase } = await getSession();
  const [props, invs, orgs] = await Promise.all([
    supabase.from("proposals").select("id, title, client_company, total, currency, schedule, org_id").eq("status", "accepted").order("created_at", { ascending: false }).limit(100),
    supabase.from("invoices").select("proposal_id, schedule_stage, kind, status").not("proposal_id", "is", null).neq("status", "void").limit(1000),
    supabase.from("organizations").select("id, name").eq("status", "active").eq("is_demo", false).order("name"),
  ]);
  const used = new Set(((invs.data ?? []) as Inv[]).filter((i) => i.kind === "invoice").map((i) => `${i.proposal_id}:${i.schedule_stage ?? 0}`));
  const stages = ((props.data ?? []) as Proposal[]).flatMap((p) =>
    (p.schedule ?? []).map((s, i) => ({ key: `${p.id}:${i}`, label: `${p.client_company} · ${p.title} · stage ${i + 1}: ${s.pct}% ${s.label}`, done: used.has(`${p.id}:${i}`), total: p.total, currency: p.currency, pct: s.pct })),
  );
  const open = stages.filter((s) => !s.done);
  const os = (orgs.data ?? []) as { id: string; name: string }[];

  return (
    <>
      <header className="page-head">
        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
          <MenuButton />
          <div>
            <h1 className="display">New invoice</h1>
            <div className="sub">Drafts never use a number. Approve, then issue: the number is assigned and the client is notified.</div>
          </div>
        </div>
        <div className="actions-bar">
          <Link className="btn btn-ghost" href="/invoices"><Icon name="arrowL" className="i-sm" />Invoices</Link>
        </div>
      </header>
      <div className="grid-main" style={{ marginTop: 0 }}>
        <div className="col">
          <section className="panel panel-pad">
            <h2 className="t-16 w-600" style={{ marginBottom: 6 }}>From a proposal&apos;s payment schedule</h2>
            <p className="hint" style={{ marginBottom: 12 }}>Milestone and final invoices. The last stage takes the rounding remainder, so the stages add up to the proposal total.</p>
            {open.length === 0 ? (
              <p className="c-3 t-13">No uninvoiced stages on accepted proposals.</p>
            ) : (
              <ActionForm action={createScheduleInvoice} submit="Create draft" icon="receipt">
                <div className="stack" style={{ gap: 10 }}>
                  <div className="field">
                    <label className="label" htmlFor="inv-stage">Stage</label>
                    <select className="select" id="inv-stage" name="stage" required defaultValue="">
                      <option value="" disabled>Pick a stage</option>
                      {open.map((s) => (
                        <option key={s.key} value={s.key}>{s.label} (≈ {formatMoney((Number(s.total) * s.pct) / 100, s.currency)})</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="inv-due-s">Due date <span className="c-3">(default: 14 days after issue)</span></label>
                    <input className="input" type="date" id="inv-due-s" name="due_date" />
                  </div>
                </div>
              </ActionForm>
            )}
          </section>
        </div>
        <div className="col">
          <section className="panel panel-pad">
            <h2 className="t-16 w-600" style={{ marginBottom: 6 }}>Ad-hoc invoice</h2>
            <ActionForm action={createAdhocInvoice} submit="Create draft" icon="receipt">
              <div className="stack" style={{ gap: 10 }}>
                <div className="field">
                  <label className="label" htmlFor="inv-org">Client</label>
                  <select className="select" id="inv-org" name="org_id" required defaultValue="">
                    <option value="" disabled>Pick a client</option>
                    {os.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
                <InvoiceFields v={{ bill_company: "", bill_contact: "", project_label: "", lines: "", tax_label: "", tax_rate: "0", currency: "USD", due_date: isoDaysFromNow(14) }} />
              </div>
            </ActionForm>
          </section>
        </div>
      </div>
    </>
  );
}
