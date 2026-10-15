import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Fragment } from "react";
import { Icon } from "@/app/components/Icon";
import { PageHeader } from "@/app/components/PageHeader";
import { getSession } from "@/lib/session";
import { answerLines, INTAKE_CHIP, type IntakeStatus } from "@/lib/intake";
import { stamp } from "@/lib/dates";
import { IntakeActions } from "../IntakeActions";

export const metadata: Metadata = { title: "Enquiry" };

type Row = {
  id: string; name: string; email: string; company: string | null; kind: string; budget: string | null; message: string; source: string;
  answers: Record<string, string>; status: IntakeStatus; deal_id: string | null; deal_created: boolean; contacted_at: string | null; created_at: string;
  deals: { title: string; stage: string } | { title: string; stage: string }[] | null;
};

export default async function IntakeDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await getSession();
  const { data } = await supabase
    .from("intake")
    .select("id, name, email, company, kind, budget, message, source, answers, status, deal_id, deal_created, contacted_at, created_at, deals(title, stage)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const r = data as unknown as Row;
  const deal = Array.isArray(r.deals) ? r.deals[0] : r.deals;
  const chip = INTAKE_CHIP[r.status];
  const fields: [string, string][] = [
    ["Email", r.email],
    ["Company", r.company || "–"],
    ["Track", r.kind],
    ...answerLines(r.answers),
    ["Budget", r.budget || "–"],
    ["Received", stamp(r.created_at)],
    ["Source", r.source],
    ...(r.contacted_at ? ([["Contacted", stamp(r.contacted_at)]] as [string, string][]) : []),
  ];
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Intake", href: "/intake" }, { label: r.name }]}
        title={r.name}
        pills={
          <span className={`pill ${chip.tone}`}>
            <span className="dot" />
            {chip.label}
          </span>
        }
        sub={r.company ? <span>{r.company}</span> : <span>{r.email}</span>}
      />
      <div className="grid-main grid-flush">
        <div className="col">
          <section className="panel">
            <div className="panel-head">
              <h2>What they wrote</h2>
            </div>
            <div className="pane">
              <div className="untrusted">
                <div className="untrusted-tag">
                  <Icon name="alert" className="i-sm" />
                  Visitor text · untrusted
                </div>
                <div className="pre-wrap">{r.message || "(no details)"}</div>
              </div>
            </div>
          </section>
          <section className="panel panel-pad">
            <IntakeActions id={r.id} status={r.status} email={r.email} />
            <p className="hint mt-12">
              Convert opens a proposal draft prefilled from this enquiry. Nothing reaches {r.email} until you approve and send it.
            </p>
          </section>
        </div>
        <div className="col">
          <section className="panel panel-pad">
            <dl className="kv-list">
              {fields.map(([k, v]) => (
                <Fragment key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </Fragment>
              ))}
            </dl>
          </section>
          <section className="panel panel-pad">
            <div className="eyebrow mb-8">
              Pipeline
            </div>
            {deal ? (
              <p className="t-13">
                {r.deal_created ? "Opened" : "Joined"} the lead <strong>{deal.title}</strong> · stage {deal.stage.replace("_", " ")}.
              </p>
            ) : (
              <p className="c-3 t-13">No deal linked.</p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
