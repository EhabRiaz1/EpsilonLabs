// The sales pipeline table (design review D7): stage groups, the "next step" line and the needs-a-touch order.
// Pure (unit-tested in deals.test.ts). deals has no next-touch column, so the order is derived from what the page
// already reads: the last touch per deal, its direction, and whether a draft for the deal waits in Approvals.

export const STAGES: readonly (readonly [string, string])[] = [
  ["lead", "Lead"], ["conversation", "Conversation"], ["scoping_call", "Scoping"], ["quote_out", "Quote out"],
  ["won_lost", "Won / Lost"], ["dormant", "Dormant"],
];
export const STAGE_LABEL: Readonly<Record<string, string>> = {
  lead: "Lead", conversation: "Conversation", scoping_call: "Scoping", quote_out: "Quote out", won: "Won", lost: "Lost", dormant: "Dormant",
};
/** The order shown in the deal sheet's stage strip. */
export const STAGE_STEPS: readonly (readonly [string, string])[] = [
  ["lead", "Lead"], ["conversation", "Conv."], ["scoping_call", "Scoping"], ["quote_out", "Quote"], ["won", "Won"],
];
const OPEN = new Set(["lead", "conversation", "scoping_call", "quote_out"]);
export const STALE_WARN = 7;
export const STALE_BAD = 14;

// dashboard/data.py CHANNELS / STRATEGY tags
export const CHANNELS = ["referral", "inbound", "outbound", "dream25", "pre_existing"] as const;
export const CH_LABEL: Readonly<Record<string, string>> = { referral: "Referral", inbound: "Inbound", outbound: "Outbound", dream25: "Dream 25", pre_existing: "Existing" };
export const STRATEGY_TAG: Readonly<Record<string, string>> = {
  s2_trigger: "S2 trigger", s3_regulation: "S3 regulation", s4_partner: "S4 partner", s5_intent: "S5 intent", s7_orphaned: "S7 orphaned",
  s8_tradeshow: "S8 tradeshow", s9_crowdfund: "S9 crowdfund", s10_accelerator: "S10 accelerator", s11_software: "S11 software",
  s12_devpartner: "S12 dev partner", s13_hn: "S13 HN", legacy: "legacy",
};

export function isOpenStage(stage: string): boolean {
  return OPEN.has(stage);
}

/** Won and lost share one tab and one stage-bar segment. */
export function stageGroup(stage: string): string {
  return stage === "won" || stage === "lost" ? "won_lost" : stage;
}

/** Pill tone per stage (dot + word). */
export function stageTone(stage: string): string {
  if (stage === "quote_out") return "pill-warn";
  if (stage === "won") return "pill-good";
  if (stage === "lost") return "pill-bad";
  if (stage === "conversation" || stage === "scoping_call") return "pill-accent";
  return "";
}

/** Whole days since `iso` (0 for today or the future). */
export function daysSince(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000));
}

/** "today" / "1 d" / "21 d" */
export function ageText(days: number): string {
  return days === 0 ? "today" : `${days} d`;
}

/** Stale is the age text colour only (D7), and only for deals still open. */
export function ageTone(days: number, stage: string): "" | "c-warn" | "c-bad" {
  if (!isOpenStage(stage)) return "";
  return days >= STALE_BAD ? "c-bad" : days >= STALE_WARN ? "c-warn" : "";
}

/** Stage-bar segment width: grows with the count but stays readable for 1-deal stages (mockup: 108 → 40, 1 → 11). */
export function stageFlex(n: number): number {
  return Math.round(8 + 3 * Math.sqrt(Math.max(0, n)));
}

export type LastTouch = { type: string; direction: string; subject: string | null; occurred_at: string } | null;
export type DealFacts = { stage: string; quoted_at?: string | null; closed_at?: string | null; lost_reason?: string | null };
export type NextStep = { lead: string | null; rest: string; who: "you" | "them" | "none"; rank: number };

/** The "Next step" line and the needs-a-touch rank (0 first):
 *  0 they replied and nothing answers it yet · 1 a draft for the deal waits in Approvals · 2 open and stale (≥ 7 d) ·
 *  3 open · 4 won, lost or dormant. `fmt` formats a date ("12 Oct"). */
export function nextStep(d: DealFacts, last: LastTouch, draftWaiting: boolean, ageDays: number, fmt: (iso: string) => string): NextStep {
  if (d.stage === "won") return { lead: "Won", rest: d.closed_at ? `closed ${fmt(d.closed_at)}` : "", who: "none", rank: 4 };
  if (d.stage === "lost") return { lead: null, rest: d.lost_reason ? `Lost · ${d.lost_reason}` : "Lost", who: "none", rank: 4 };
  if (d.stage === "dormant") return { lead: null, rest: last ? `Dormant · last touch ${fmt(last.occurred_at)}` : "Dormant", who: "none", rank: 4 };
  if (draftWaiting) return { lead: "Draft waiting", rest: "in Approvals", who: "you", rank: 1 };
  if (last && last.direction === "inbound" && last.type === "human_reply") return { lead: "Reply", rest: `they wrote ${fmt(last.occurred_at)}`, who: "you", rank: 0 };
  const stale = ageDays >= STALE_WARN;
  if (d.stage === "quote_out")
    return { lead: stale ? "Follow up quote" : null, rest: d.quoted_at ? `${stale ? "" : "Quote out · "}sent ${fmt(d.quoted_at)}` : "Quote out", who: stale ? "you" : "them", rank: stale ? 2 : 3 };
  if (!last) return { lead: "First touch", rest: "nothing sent yet", who: "you", rank: stale ? 2 : 3 };
  if (stale) return { lead: "Nudge", rest: `last touch ${fmt(last.occurred_at)}`, who: "you", rank: 2 };
  return { lead: null, rest: `Waiting · ${last.subject?.trim() || `${last.direction === "outbound" ? "sent" : "touch"} ${fmt(last.occurred_at)}`}`, who: "them", rank: 3 };
}

/** Needs a touch first: by rank; within a rank, the longest-waiting first for ranks 0-2, the latest touch first after. */
export function byNeed<T extends { rank: number; touchedAt: string }>(a: T, b: T): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  return a.rank <= 2 ? a.touchedAt.localeCompare(b.touchedAt) : b.touchedAt.localeCompare(a.touchedAt);
}
