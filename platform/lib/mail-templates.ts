// Branded notification emails from notifications@ (F9): short, fixed templates (F13). Pure (unit-tested).
// Every interpolated value is escaped in the HTML part.
import { esc } from "./html";

export type Mail = { subject: string; html: string; text: string };

const FOOT_TEXT = "Epsilon Labs · epsilon-labs.co\nThis is an automatic message from notifications@epsilon-labs.co. Replies go to Ehab.";

function layout(preheader: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>Epsilon Labs</title></head>
<body style="margin:0;padding:0;background:#efede9;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#1b1a18">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efede9;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:24px;padding:32px 30px">
<tr><td style="padding-bottom:22px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:34px;height:34px;border-radius:10px;background:#1b1a18;color:#ffffff;font:400 20px/34px Georgia,'Times New Roman',serif;text-align:center">ε</td>
<td style="padding-left:10px;font-weight:600;font-size:14px">Epsilon Labs</td></tr></table></td></tr>
<tr><td style="font-size:14px;line-height:1.6;color:#3d3b37">${body}</td></tr>
</table>
<p style="max-width:520px;margin:18px auto 0;font-size:11px;line-height:1.6;color:#8a867f;text-align:center">
Epsilon Labs · <a href="https://epsilon-labs.co" style="color:#8a867f">epsilon-labs.co</a><br>
This is an automatic message from notifications@epsilon-labs.co. Replies go to Ehab.</p>
</td></tr></table></body></html>`;
}

const h1 = (t: string) => `<h1 style="margin:0 0 10px;font-size:22px;font-weight:500;color:#1b1a18">${esc(t)}</h1>`;
const p = (t: string) => `<p style="margin:0 0 14px">${t}</p>`;
const button = (href: string, label: string) =>
  `<p style="margin:22px 0"><a href="${esc(href)}" style="display:inline-block;background:#d9532f;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:13px 24px;border-radius:999px">${esc(label)}</a></p>`;

/** OV4: the 6-digit code that confirms an acceptance. */
export function acceptCodeEmail(o: { code: string; title: string; minutes: number }): Mail {
  const spaced = `${o.code.slice(0, 3)} ${o.code.slice(3)}`;
  return {
    subject: `${spaced} is your code to accept "${o.title}"`,
    html: layout(
      `Your code: ${spaced}`,
      h1("Your acceptance code") +
        p(`Enter this code on the proposal page to accept <strong>${esc(o.title)}</strong>. It expires in ${esc(o.minutes)} minutes.`) +
        `<p style="margin:20px 0;font:500 32px/1 'SF Mono',Menlo,Consolas,monospace;letter-spacing:.18em;color:#1b1a18">${esc(spaced)}</p>` +
        p(`<span style="color:#8a867f;font-size:12px">If you didn't ask for this, ignore this email. Nothing is accepted without the code.</span>`),
    ),
    text: `Your code to accept "${o.title}": ${spaced}\nIt expires in ${o.minutes} minutes. If you didn't ask for this, ignore this email.\n\n${FOOT_TEXT}`,
  };
}

/** F13: the proposal link, sent when the founder clicks "Approve & send". */
export function proposalLinkEmail(o: { contactName: string; title: string; link: string; validUntil: string; version: number }): Mail {
  const first = o.contactName.trim().split(/\s+/)[0] || "there";
  const v = o.version > 1 ? ` (version ${o.version})` : "";
  return {
    subject: `Proposal: ${o.title}${v}`,
    html: layout(
      `Your proposal from Epsilon Labs, valid until ${o.validUntil}`,
      h1(`Hi ${first},`) +
        p(`Your proposal for <strong>${esc(o.title)}</strong>${esc(v)} is ready. It sets out the scope, timeline and price, and you can accept it on the page.`) +
        button(o.link, "Open the proposal") +
        p(`<span style="color:#8a867f;font-size:12px">Valid until ${esc(o.validUntil)}. The link is personal to you; questions go to Ehab by reply.</span>`),
    ),
    text: `Hi ${first},\n\nYour proposal for "${o.title}"${v} is ready:\n${o.link}\n\nValid until ${o.validUntil}. Questions go to Ehab by reply.\n\n${FOOT_TEXT}`,
  };
}

/** After acceptance: the portal login is ready (sign in with a magic link, F3). */
export function portalReadyEmail(o: { contactName: string; company: string; loginUrl: string; invoiceNumber: string; invoiceAmount: string }): Mail {
  const first = o.contactName.trim().split(/\s+/)[0] || "there";
  return {
    subject: `Your Epsilon portal for ${o.company} is ready`,
    html: layout(
      "Thank you. Your portal and deposit invoice are ready.",
      h1(`Thank you, ${first}`) +
        p(`Your acceptance is recorded. The deposit invoice <strong>${esc(o.invoiceNumber)}</strong> (${esc(o.invoiceAmount)}) and your project are in the ${esc(o.company)} portal.`) +
        button(o.loginUrl, "Open the portal") +
        p(`<span style="color:#8a867f;font-size:12px">Sign in with this email address; we send a one-time link, no password needed.</span>`),
    ),
    text: `Thank you, ${first}.\n\nYour acceptance is recorded. Deposit invoice ${o.invoiceNumber} (${o.invoiceAmount}) and your project are in the portal:\n${o.loginUrl}\nSign in with this email address.\n\n${FOOT_TEXT}`,
  };
}

/** Internal notice to the founder (acceptance, blocked acceptance, failures). */
export function founderNotice(o: { subject: string; lines: string[]; link?: string }): Mail {
  return {
    subject: `[Epsilon] ${o.subject}`,
    html: layout(o.subject, h1(o.subject) + o.lines.map((l) => p(esc(l))).join("") + (o.link ? button(o.link, "Open in admin") : "")),
    text: `${o.subject}\n\n${o.lines.join("\n")}${o.link ? `\n\n${o.link}` : ""}\n`,
  };
}

/** Portal invite (F3, F9): the link signs the person in and adds them to the organisation. Valid 7 days, once. */
export function inviteEmail(o: { orgName: string; inviter: string; link: string; expiresOn: string; role: "owner" | "member" }): Mail {
  const who = o.inviter.trim() || "Epsilon Labs";
  return {
    subject: `${who} invited you to the ${o.orgName} portal`,
    html: layout(
      `Join ${o.orgName} on Epsilon Labs`,
      h1(`Join ${o.orgName}`) +
        p(`${esc(who)} invited you to the <strong>${esc(o.orgName)}</strong> portal on Epsilon Labs${o.role === "owner" ? " as an owner" : ""}. It is where requests, files, progress and invoices for your projects live.`) +
        button(o.link, "Accept and sign in") +
        p(`<span style="color:#8a867f;font-size:12px">The link works once and expires on ${esc(o.expiresOn)}. No password is needed; next time, sign in at client.epsilon-labs.co with this email address. If you weren't expecting this, ignore it.</span>`),
    ),
    text: `${who} invited you to the ${o.orgName} portal on Epsilon Labs.\n\nAccept and sign in:\n${o.link}\n\nThe link works once and expires on ${o.expiresOn}. If you weren't expecting this, ignore it.\n\n${FOOT_TEXT}`,
  };
}
