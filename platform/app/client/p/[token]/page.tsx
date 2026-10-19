import type { Metadata } from "next";
import { cache } from "react";
import { connection } from "next/server";
import { createAnonClient } from "@/lib/supabase/anon";
import { isToken, shortHash } from "@/lib/tokens";
import { dayMonth, dayMonthYear, daysUntil, stamp } from "@/lib/dates";
import { scheduleAmounts } from "@/lib/money";
import type { AcceptedView, PublicProposal } from "@/lib/deal-room";
import { Icon } from "@/app/components/Icon";
import { ThemePill } from "@/app/components/ThemePill";
import { DealRoom } from "./DealRoom";
import "./deal-room.css";

export const maxDuration = 60;

// The prospect holds only the link: the page reads through get_proposal_by_token() as the anon role, which returns
// that proposal's public fields and marks it viewed. cache() keeps metadata and page to one call per request.
const load = cache(async (token: string): Promise<PublicProposal | null> => {
  if (!isToken(token)) return null;
  const { data, error } = await createAnonClient().rpc("get_proposal_by_token", { p_token: token });
  if (error) throw new Error(`proposal lookup failed: ${error.message}`);
  return data as PublicProposal;
});

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await connection();
  const p = await load((await params).token);
  const title = p && (p.state === "open" || p.state === "accepted") ? `${p.title} · Proposal` : "Proposal";
  return { title, referrer: "no-referrer" };
}

export default async function ProposalPage({ params }: Props) {
  await connection();
  const { token } = await params;
  const p = await load(token);
  if (!p || p.state === "not_found") return <Gone icon="lock" title="This link doesn't work" body="Check that you copied the whole link from the email. If it still doesn't open, reply to Epsilon's email and we'll send it again." />;
  if (p.state === "void")
    return (
      <Gone
        icon="layers"
        title="This link is no longer active"
        body="This version of the proposal was withdrawn or replaced. If Epsilon sent you a newer version, use the link in the latest email; otherwise reply and ask for it."
      />
    );
  if (p.state === "declined") return <Gone icon="x" title="This proposal was declined" body="If you'd like to pick it up again, reply to Epsilon's email." />;
  if (p.state === "expired")
    return (
      <Gone
        icon="clock"
        title="This proposal has expired"
        body={`It was valid until ${dayMonthYear(p.valid_until)}. Reply to the email it came with, or write to er@epsilon-labs.co, and Epsilon will send a current version.`}
      />
    );

  const now = new Date();
  const accepted: AcceptedView | null = p.acceptance
    ? {
        name: p.acceptance.name,
        stamp: stamp(p.acceptance.accepted_at),
        record: shortHash(p.acceptance.sha256),
        termsVersion: p.acceptance.terms_version,
        invoice: p.invoice ? { number: p.invoice.number, total: Number(p.invoice.total), currency: p.invoice.currency } : null,
        emailMasked: p.email_masked,
        portalSent: null,
      }
    : null;
  return (
    <DealRoom
      token={token}
      p={p}
      stageAmounts={scheduleAmounts(p.total, p.schedule)}
      labels={{
        validUntil: dayMonth(p.valid_until),
        daysLeft: Math.max(0, daysUntil(p.valid_until, now)),
        sent: dayMonthYear(p.sent_at),
        fingerprint: shortHash(p.sha256),
        acceptedOn: p.acceptance ? dayMonth(p.acceptance.accepted_at) : "",
      }}
      initialAccepted={accepted}
    />
  );
}

function Gone({ icon, title, body }: { icon: "lock" | "layers" | "x" | "clock"; title: string; body: string }) {
  return (
    <div className="dr">
      <header className="dr-top">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-word">
            <strong>Epsilon Labs</strong>
            <span>client.epsilon-labs.co</span>
          </span>
        </span>
        <div className="row" style={{ marginLeft: "auto" }}>
          <ThemePill />
        </div>
      </header>
      <main className="panel gone">
        <div className="empty" style={{ padding: 0 }}>
          <div className="orb">
            <span className="wave" />
            <span className="wave" />
            <span className="core">
              <Icon name={icon} className="i-lg" />
            </span>
          </div>
        </div>
        <h1 className="display">{title}</h1>
        <p>{body}</p>
      </main>
    </div>
  );
}
