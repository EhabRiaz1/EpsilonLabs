import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { Money } from "@/app/components/Money";
import { StatusPill } from "@/app/components/StatusPill";
import { PageHeader } from "@/app/components/PageHeader";
import { Note } from "@/app/components/Note";
import { getSession } from "@/lib/session";
import { PACKAGES } from "@/lib/packages";
import { scheduleAmounts, scheduleError, type Stage } from "@/lib/money";
import { dayMonth, dayMonthYear, daysUntil, stamp } from "@/lib/dates";
import { shortHash } from "@/lib/tokens";
import { clientOrigin } from "@/lib/host";
import type { PublicProposal } from "@/lib/deal-room";
import type { Line } from "@/lib/packages";
import { DealRoom } from "@/app/client/p/[token]/DealRoom";
import "@/app/client/p/[token]/deal-room.css";
import { ProposalForm } from "../ProposalForm";
import { ProposalActions } from "./ProposalActions";
import { saveDraft } from "../actions";

export const metadata: Metadata = { title: "Proposal" };

type Row = Omit<PublicProposal, "state" | "email_masked" | "terms" | "acceptance" | "invoice"> & {
  deal_id: string;
  org_id: string | null;
  contact_email: string;
  terms_version: string;
  viewed_at: string | null;
  created_at: string;
  sha256: string | null;
  sent_at: string | null;
};

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await getSession();
  const { data } = await supabase.from("proposals").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const p = data as Row;
  const [terms, acceptance, invoice, versions] = await Promise.all([
    supabase.from("terms_versions").select("version, title, pdf_path, active").eq("version", p.terms_version).maybeSingle(),
    supabase.from("acceptances").select("name, email, ip, accepted_at, sha256, terms_version").eq("proposal_id", id).maybeSingle(),
    supabase.from("invoices").select("id, number, total, currency, status").eq("proposal_id", id).order("created_at").limit(1).maybeSingle(),
    supabase.from("proposals").select("id, version, status").eq("deal_id", p.deal_id).order("version", { ascending: false }),
  ]);
  const h = await headers();
  const origin = clientOrigin({ host: h.get("host"), forwardedHost: h.get("x-forwarded-host"), forwardedProto: h.get("x-forwarded-proto") });
  const editable = p.status === "draft" || p.status === "approved";
  const schedule = p.schedule as Stage[];
  const schedOk = !scheduleError(schedule);
  const t = terms.data as PublicProposal["terms"] | null;

  const preview: PublicProposal = {
    ...p,
    state: "open",
    email_masked: p.contact_email,
    sent_at: p.sent_at ?? p.created_at,
    sha256: p.sha256 ?? "",
    terms: t ? { ...t, pdf_path: `${origin}${t.pdf_path}` } : { version: p.terms_version, title: "Services Agreement", pdf_path: "#", active: false },
    acceptance: null,
    invoice: null,
  };

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Proposals", href: "/proposals" }, { label: p.title }]}
        title={p.title}
        pills={<StatusPill status={p.status} />}
        sub={
          <>
            <span>{p.client_company}</span>
            <span aria-hidden="true">·</span>
            <span>{p.contact_name}</span>
            <span aria-hidden="true">·</span>
            <span>v{p.version}</span>
            <span aria-hidden="true">·</span>
            <Money value={p.total} currency={p.currency} />
          </>
        }
      />

      <section className="panel panel-pad stack" style={{ gap: 16, marginBottom: 14 }}>
        <dl className="kv-list">
          <dt>Sends to</dt>
          <dd className="mono">{p.contact_email}</dd>
          <dt>Terms</dt>
          <dd>
            {p.terms_version} {t?.active ? <span className="pill pill-good"><span className="dot" />Active</span> : <span className="pill pill-warn"><span className="dot" />Not active: can&apos;t be accepted yet</span>}
          </dd>
          <dt>Trail</dt>
          <dd>
            {p.sent_at ? `Sent ${stamp(p.sent_at)}` : "Not sent"}
            {p.viewed_at ? ` · viewed ${stamp(p.viewed_at)}` : ""}
            {acceptance.data ? ` · accepted ${stamp(acceptance.data.accepted_at)}` : ""}
          </dd>
          <dt>Valid until</dt>
          <dd>
            {dayMonthYear(p.valid_until)} ({daysUntil(p.valid_until, new Date())} days)
          </dd>
          {p.sha256 && (
            <>
              <dt>Fingerprint</dt>
              <dd className="mono">{p.sha256}</dd>
            </>
          )}
          {acceptance.data && (
            <>
              <dt>Accepted by</dt>
              <dd>
                {acceptance.data.name} · <span className="mono">{acceptance.data.email}</span> · IP <span className="mono">{String(acceptance.data.ip ?? "–")}</span> · record{" "}
                <span className="mono">{shortHash(acceptance.data.sha256)}</span> under {acceptance.data.terms_version}
              </dd>
            </>
          )}
          {invoice.data && (
            <>
              <dt>Deposit invoice</dt>
              <dd>
                <Link className="link-btn" href={`/invoices/${invoice.data.id}`}>
                  {invoice.data.number}
                </Link>{" "}
                · <Money value={invoice.data.total} currency={invoice.data.currency} /> · {invoice.data.status}
              </dd>
            </>
          )}
          {(versions.data ?? []).length > 1 && (
            <>
              <dt>Versions</dt>
              <dd className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {(versions.data ?? []).map((v) => (
                  <Link key={v.id} href={`/proposals/${v.id}`} className={`pill ${v.id === id ? "pill-accent" : ""}`}>
                    v{v.version} · {v.status}
                  </Link>
                ))}
              </dd>
            </>
          )}
        </dl>
        <ProposalActions id={id} status={p.status} email={p.contact_email} />
      </section>

      {editable && (
        <ProposalForm
          packages={[...PACKAGES]}
          action={saveDraft.bind(null, id)}
          submitLabel={p.status === "approved" ? "Save (back to draft)" : "Save draft"}
          showChanges={p.version > 1}
          initial={{
            title: p.title,
            client_company: p.client_company,
            contact_name: p.contact_name,
            contact_email: p.contact_email,
            summary: p.summary,
            scope_md: p.scope_md,
            timeline_md: p.timeline_md,
            changes_md: p.changes_md,
            valid_until: p.valid_until,
            lines: (p.lines as Line[]).map((l) => ({ slug: l.slug, qty: l.qty, description: l.description })),
            schedule,
          }}
        />
      )}

      <section style={{ marginTop: 18 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <div className="eyebrow">Preview · what {p.contact_name.split(" ")[0] || "the client"} sees{editable ? " (save to update)" : ""}</div>
          <span className="c-3 t-12">Accepting is disabled in the preview</span>
        </div>
        {schedOk ? (
          <div className="preview-wrap">
            <DealRoom
              token=""
              preview
              p={preview}
              stageAmounts={scheduleAmounts(p.total, schedule)}
              labels={{
                validUntil: dayMonth(p.valid_until),
                daysLeft: Math.max(0, daysUntil(p.valid_until, new Date())),
                sent: dayMonthYear(p.sent_at ?? new Date().toISOString()),
                fingerprint: p.sha256 ? shortHash(p.sha256) : "set when sent",
                acceptedOn: "",
              }}
              initialAccepted={null}
            />
          </div>
        ) : (
          <Note tone="error">The payment schedule is invalid; fix it to see the preview.</Note>
        )}
      </section>
    </>
  );
}
