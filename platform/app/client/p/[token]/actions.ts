"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { FOUNDER_EMAIL, sendMail, sendMailLogged } from "@/lib/mail";
import { acceptCodeEmail, founderNotice, portalReadyEmail } from "@/lib/mail-templates";
import { ensureInvoicePdf } from "@/lib/invoice-pdf";
import { clientIp, isToken, normaliseCode, shortHash } from "@/lib/tokens";
import { formatMoney } from "@/lib/money";
import { stamp } from "@/lib/dates";
import { publicUrl } from "@/lib/host";
import type { AcceptedView, ConfirmResult, SendResult } from "@/lib/deal-room";

// The public deal room's only write paths. They run with the service role (see lib/supabase/service.ts) because
// start_acceptance returns the plain code for us to email, and confirm_acceptance records the caller's IP: neither
// RPC is callable with the public key. The browser only ever sends the token, a name and a code.

const ADMIN = "https://admin.epsilon-labs.co";
const GONE = "This proposal link is no longer active. Reload the page to see why.";
const FAILED = "Something went wrong on our side. Try again in a minute.";

function cleanName(name: unknown): string | null {
  const n = String(name ?? "").replace(/\s+/g, " ").trim();
  return n.length >= 2 && n.length <= 200 ? n : null;
}

type StartRow = {
  state: string;
  code?: string;
  email?: string;
  email_masked?: string;
  title?: string;
  client_company?: string;
  terms_version?: string;
  notify?: boolean;
  retry_at?: string;
};

export async function sendCode(token: string, name: string): Promise<SendResult> {
  if (!isToken(token)) return { ok: false, reason: "gone", message: GONE };
  const n = cleanName(name);
  if (!n) return { ok: false, reason: "invalid", message: "Type your full name as it should appear on the record." };
  const svc = createServiceClient();
  const { data, error } = await svc.rpc("start_acceptance", { p_token: token, p_name: n });
  if (error) {
    console.error("start_acceptance failed:", error.message);
    return { ok: false, reason: "error", message: FAILED };
  }
  const r = data as StartRow;
  switch (r.state) {
    case "code_sent":
      try {
        await sendMail(r.email!, acceptCodeEmail({ code: r.code!, title: r.title!, minutes: 10 }));
      } catch (e) {
        console.error("accept code mail failed:", e instanceof Error ? e.message : e);
        return { ok: false, reason: "mail_failed", message: "We couldn't send the code just now. Try again in a minute." };
      }
      return { ok: true, emailMasked: r.email_masked! };
    case "terms_inactive": {
      let told = true;
      if (r.notify) {
        told = await sendMailLogged(
          FOUNDER_EMAIL,
          founderNotice({
            subject: `Acceptance blocked: terms ${r.terms_version} are not active`,
            lines: [`${r.client_company} tried to accept "${r.title}".`, `Activate ${r.terms_version} in admin, then let them know.`],
            link: `${ADMIN}/terms`,
          }),
          "terms-inactive notice",
        );
      }
      return {
        ok: false,
        reason: "terms_inactive",
        message: told
          ? "This proposal can't be accepted yet; Ehab has been notified and will be in touch."
          : "This proposal can't be accepted yet. Please let Ehab know at er@epsilon-labs.co.",
      };
    }
    case "rate_limited":
      return {
        ok: false,
        reason: "rate_limited",
        message: `Too many codes requested. You can ask for a new one after ${r.retry_at ? stamp(r.retry_at).split(", ")[1] : "an hour"}.`,
      };
    case "accepted":
      return { ok: false, reason: "accepted", message: "This proposal has already been accepted. Reload the page." };
    default:
      return { ok: false, reason: "gone", message: GONE };
  }
}

type ConfirmRow = {
  state: string;
  replay?: boolean;
  attempts_left?: number | null;
  org_id?: string;
  email?: string;
  email_masked?: string;
  title?: string;
  client_company?: string;
  invite_id?: string | null;
  acceptance?: { name: string; accepted_at: string; sha256: string; terms_version: string };
  invoice?: { id: string; number: string; total: number | string; currency: string; due_date: string } | null;
};

export async function confirmCode(token: string, code: string, name: string): Promise<ConfirmResult> {
  if (!isToken(token)) return { ok: false, reason: "gone", message: GONE };
  const c = normaliseCode(code);
  if (!c) return { ok: false, reason: "invalid", message: "Enter the 6 digits from the email." };
  const h = await headers();
  const svc = createServiceClient();
  const { data, error } = await svc.rpc("confirm_acceptance", {
    p_token: token,
    p_code: c,
    p_name: cleanName(name) ?? "",
    p_ip: clientIp((k) => h.get(k)),
    p_ua: (h.get("user-agent") ?? "").slice(0, 1000) || null,
  });
  if (error) {
    console.error("confirm_acceptance failed:", error.message);
    return { ok: false, reason: "error", message: FAILED };
  }
  const r = data as ConfirmRow;
  switch (r.state) {
    case "accepted":
      break;
    case "wrong_code":
      return {
        ok: false,
        reason: "wrong_code",
        message:
          r.attempts_left == null
            ? "That code didn't match."
            : `That code didn't match. ${r.attempts_left} ${r.attempts_left === 1 ? "try" : "tries"} left.`,
      };
    case "locked":
      return { ok: false, reason: "locked", message: "Too many wrong codes. Send a new code to try again." };
    case "code_expired":
    case "no_code":
      return { ok: false, reason: "code_expired", message: "This code has expired. Send a new one." };
    case "terms_inactive":
      return { ok: false, reason: "terms_inactive", message: "This proposal can't be accepted yet; Ehab has been notified." };
    default:
      return { ok: false, reason: "gone", message: GONE };
  }

  const loginUrl = publicUrl("/login", { host: h.get("host"), forwardedHost: h.get("x-forwarded-host"), forwardedProto: h.get("x-forwarded-proto") }, "https:").href;
  let portalSent: boolean | null;
  if (r.replay) {
    portalSent = await inviteLinked(svc, r.invite_id ?? null);
  } else {
    portalSent = await provisionPortal(svc, r, loginUrl);
    const inv = r.invoice;
    await sendMailLogged(
      FOUNDER_EMAIL,
      founderNotice({
        subject: `Accepted: ${r.title} (${r.client_company})`,
        lines: [
          `${r.acceptance?.name} accepted "${r.title}" on ${r.acceptance ? stamp(r.acceptance.accepted_at) : "now"}.`,
          inv ? `Deposit invoice ${inv.number}: ${formatMoney(inv.total, inv.currency)}, issued.` : "No deposit invoice was created.",
          portalSent ? "Portal access was sent to the client." : "Portal access was NOT sent: create the login by hand.",
        ],
        link: `${ADMIN}/proposals`,
      }),
      "acceptance notice",
    );
    // F15: render the deposit invoice PDF once, after the response; the download route retries if this fails
    if (inv) after(async () => {
      const res = await ensureInvoicePdf(inv.id);
      if (!res.ok) console.error(`invoice ${inv.number}: PDF pending: ${res.error}`);
    });
  }
  return { ok: true, accepted: acceptedView(r, portalSent) };
}

function acceptedView(r: ConfirmRow, portalSent: boolean | null): AcceptedView {
  return {
    name: r.acceptance?.name ?? "",
    stamp: r.acceptance ? stamp(r.acceptance.accepted_at) : "",
    record: shortHash(r.acceptance?.sha256),
    termsVersion: r.acceptance?.terms_version ?? "",
    invoice: r.invoice ? { number: r.invoice.number, total: Number(r.invoice.total), currency: r.invoice.currency } : null,
    emailMasked: r.email_masked ?? "",
    portalSent,
  };
}

/** Creates the client's login (or reuses an existing one), links the owner invite, and emails the portal link. */
async function provisionPortal(svc: SupabaseClient, r: ConfirmRow, loginUrl: string): Promise<boolean> {
  try {
    if (!r.invite_id || !r.email) throw new Error("no invite to activate");
    const created = await svc.auth.admin.createUser({
      email: r.email,
      email_confirm: true,
      user_metadata: { full_name: r.acceptance?.name ?? "" },
    });
    if (created.error && created.error.code !== "email_exists" && !/already/i.test(created.error.message)) throw created.error;
    const { data, error } = await svc.rpc("activate_invite", { p_invite_id: r.invite_id });
    if (error) throw error;
    if (!(data as { linked?: boolean })?.linked) throw new Error(`invite not linked: ${(data as { reason?: string })?.reason}`);
    await sendMail(
      r.email,
      portalReadyEmail({
        contactName: r.acceptance?.name ?? "",
        company: r.client_company ?? "",
        loginUrl,
        invoiceNumber: r.invoice?.number ?? "",
        invoiceAmount: r.invoice ? formatMoney(r.invoice.total, r.invoice.currency) : "",
      }),
    );
    return true;
  } catch (e) {
    console.error("portal provisioning failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

async function inviteLinked(svc: SupabaseClient, inviteId: string | null): Promise<boolean | null> {
  if (!inviteId) return null;
  const { data } = await svc.from("invites").select("accepted_at").eq("id", inviteId).maybeSingle();
  return data ? Boolean(data.accepted_at) : null;
}
