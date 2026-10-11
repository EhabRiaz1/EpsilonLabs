// Shapes exchanged between the deal-room RPCs (migration 009), the server actions and the page. Pure types.
import type { Line } from "./packages";
import type { Stage } from "./money";

export type ProposalState = "open" | "accepted" | "expired" | "void" | "declined" | "not_found";

export type PublicProposal = {
  state: ProposalState;
  id: string;
  version: number;
  title: string;
  client_company: string;
  contact_name: string;
  email_masked: string;
  summary: string;
  scope_md: string;
  timeline_md: string;
  changes_md: string;
  lines: Line[];
  schedule: Stage[];
  currency: string;
  total: number | string;
  valid_until: string;
  sent_at: string;
  sha256: string;
  status: string;
  terms: { version: string; title: string; pdf_path: string; active: boolean };
  acceptance: { name: string; accepted_at: string; sha256: string; terms_version: string } | null;
  invoice: { number: string; total: number | string; currency: string; due_date: string } | null;
};

/** What the browser learns after a confirmed acceptance (never the full email or internal ids). */
export type AcceptedView = {
  name: string;
  stamp: string;
  record: string;
  termsVersion: string;
  invoice: { number: string; total: number; currency: string } | null;
  emailMasked: string;
  portalSent: boolean | null;
};

export type SendResult =
  | { ok: true; emailMasked: string }
  | { ok: false; reason: "terms_inactive" | "rate_limited" | "mail_failed" | "gone" | "accepted" | "invalid" | "error"; message: string };

export type ConfirmResult =
  | { ok: true; accepted: AcceptedView }
  | { ok: false; reason: "wrong_code" | "locked" | "code_expired" | "terms_inactive" | "gone" | "invalid" | "error"; message: string };
