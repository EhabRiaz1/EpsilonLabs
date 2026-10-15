// Branded notification emails from notifications@ (F9): short, fixed templates (F13). Pure (unit-tested).
// Built on the shared layout (lib/email/layout.ts, the D13 brand). Every interpolated value is escaped in the HTML
// part (text parameters of the blocks, or esc() here), and every mail has a plain-text alternative.
import { esc } from "./html";
import { groupByOrg, itemUrl, kindLabel, subjectFor, type MailItem } from "./digest";
import {
  button,
  codeBlock,
  COMPANY_LINE,
  email,
  eyebrow,
  h1,
  items,
  kv,
  money,
  p,
  signature,
  small,
  strong,
  subhead,
  type Item,
  type Mail,
} from "./email/layout";

export type { Mail };
export { COMPANY_LINE };
export const CLIENT_ORIGIN = "https://client.epsilon-labs.co";
/** Where a portal user changes how often we email them (the account page's email section). */
export const PREFS_PATH = "/account#email";

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "";

/** OV4: the 6-digit code that confirms an acceptance. */
export function acceptCodeEmail(o: { code: string; title: string; minutes: number }): Mail {
  const spaced = `${o.code.slice(0, 3)} ${o.code.slice(3)}`;
  return email({
    subject: `${spaced} is your code to accept "${o.title}"`,
    label: "Verification",
    preheader: `Your Epsilon verification code is ${spaced}. It expires in ${o.minutes} minutes.`,
    title: "Your Epsilon verification code",
    why: "You got this because a code was requested on a proposal sent to this address.",
    html:
      eyebrow("Proposal acceptance") +
      h1("Your verification code") +
      p(`Enter this code on the proposal page to confirm you are accepting ${strong(o.title)}.`) +
      codeBlock(o.code, `Expires in ${o.minutes} minutes · single use`) +
      small("If you didn&rsquo;t ask for this code, ignore this email. Nothing is accepted without it."),
    text: [
      `Your code to accept "${o.title}": ${spaced}`,
      `It expires in ${o.minutes} minutes and works once. If you didn't ask for this, ignore this email.`,
    ],
  });
}

/** F13: the proposal link, sent when the founder clicks "Approve & send". */
export function proposalLinkEmail(o: { contactName: string; title: string; link: string; validUntil: string; version: number }): Mail {
  const first = firstName(o.contactName) || "there";
  const v = o.version > 1 ? ` (version ${o.version})` : "";
  return email({
    subject: `Proposal: ${o.title}${v}`,
    label: "Proposal",
    preheader: `Your proposal from Epsilon Labs, valid until ${o.validUntil}`,
    title: `Proposal: ${o.title}`,
    why: "You got this because you asked Epsilon Labs for a proposal. The link is personal to you; please don’t forward it outside your team.",
    html:
      eyebrow(`Proposal · v${o.version}`) +
      h1(`Your proposal: ${o.title}`) +
      p(`Hi ${esc(first)},`) +
      p(`Your proposal for ${strong(o.title)}${esc(v)} is ready. It sets out the scope, timeline, price and terms on one page you can share with your team, and you can accept it there.`) +
      kv([
        ["Proposal", o.title],
        ["Version", `v${o.version}`],
        ["Valid until", o.validUntil],
      ]) +
      button(o.link, "Review proposal") +
      small("Accepting asks for a 6-digit code sent to this address. Questions go to Ehab by reply.") +
      signature(),
    text: [`Hi ${first},`, `Your proposal for "${o.title}"${v} is ready:\n${o.link}`, `Valid until ${o.validUntil}. Questions go to Ehab by reply.`],
  });
}

/** After acceptance: the portal login is ready (sign in with a magic link, F3). */
export function portalReadyEmail(o: { contactName: string; company: string; loginUrl: string; invoiceNumber: string; invoiceAmount: string }): Mail {
  const first = firstName(o.contactName) || "there";
  return email({
    subject: `Your Epsilon portal for ${o.company} is ready`,
    label: "Client portal",
    preheader: "Thank you. Your portal and deposit invoice are ready.",
    title: `Your Epsilon portal for ${o.company}`,
    why: "You got this because you accepted a proposal from Epsilon Labs with this address.",
    html:
      eyebrow(`${o.company} · client portal`) +
      h1(`Thank you, ${first}`) +
      p(`Your acceptance is recorded. The deposit invoice and your project are in the ${esc(o.company)} portal: requests and their replies, weekly updates, delivery reports and invoices all live there.`) +
      kv([
        ["Organisation", o.company],
        ["Deposit invoice", o.invoiceNumber],
        ["Amount", { html: money(o.invoiceAmount) }],
      ]) +
      button(o.loginUrl, "Open the portal") +
      small("There is no password. Sign in with this email address and we send a one-time link.") +
      signature(),
    text: [
      `Thank you, ${first}.`,
      `Your acceptance is recorded. Deposit invoice ${o.invoiceNumber} (${o.invoiceAmount}) and your project are in the portal:\n${o.loginUrl}`,
      "Sign in with this email address; we send a one-time link, no password needed.",
    ],
  });
}

/** Internal notice to the founder (acceptance, blocked acceptance, failures). */
export function founderNotice(o: { subject: string; lines: string[]; link?: string }): Mail {
  return email({
    subject: `[Epsilon] ${o.subject}`,
    label: "Notice",
    preheader: o.subject,
    title: o.subject,
    why: "Internal notice for the Epsilon Labs founder, sent automatically by the platform.",
    html:
      eyebrow("Internal · founder notice") +
      h1(o.subject) +
      o.lines.map((l) => p(esc(l))).join("") +
      (o.link ? button(o.link, "Open in admin") : ""),
    text: [o.subject, o.lines.join("\n"), o.link],
  });
}

/** Portal invite (F3, F9): the link signs the person in and adds them to the organisation. Valid 7 days, once. */
export function inviteEmail(o: { orgName: string; inviter: string; link: string; expiresOn: string; role: "owner" | "member" }): Mail {
  const who = o.inviter.trim() || "Epsilon Labs";
  return email({
    subject: `${who} invited you to the ${o.orgName} portal`,
    label: "Client portal",
    preheader: `${who} added you to ${o.orgName} on the Epsilon client portal. The link works once and expires on ${o.expiresOn}.`,
    title: `Join ${o.orgName} on the Epsilon client portal`,
    why: `You got this because ${who} invited this address to ${o.orgName}. If you weren’t expecting it, ignore it; the link expires on its own.`,
    html:
      eyebrow(`Invitation · ${o.orgName}`) +
      h1(`Join ${o.orgName} on the Epsilon client portal`) +
      p(`${esc(who)} invited you to the ${strong(o.orgName)} workspace on the Epsilon Labs client portal${o.role === "owner" ? " as an owner" : ""}. It is where requests and their replies, files, weekly updates, delivery reports and invoices for your projects live.`) +
      kv([
        ["Organisation", o.orgName],
        ["Your role", o.role === "owner" ? "Owner" : "Member"],
        ["Invited by", who],
        ["Link valid until", o.expiresOn],
      ]) +
      button(o.link, "Accept invitation") +
      small("There is no password. Next time, sign in at client.epsilon-labs.co with this email address and click the one-time link we send."),
    text: [
      `${who} invited you to the ${o.orgName} portal on Epsilon Labs.`,
      `Accept and sign in:\n${o.link}`,
      `The link works once and expires on ${o.expiresOn}. If you weren't expecting this, ignore it.`,
    ],
  });
}

/** F9/F13: portal notifications by email. "immediate" carries urgent items (or everything, for people who chose
 * immediate); "digest" is the one daily email at 10:00 in the person's timezone. Fixed wording only: the titles are
 * the notification titles the database wrote (fixed templates plus ticket/report titles). */
export function notificationEmail(o: { name: string; items: MailItem[]; mode: "immediate" | "digest"; timezone?: string; origin?: string }): Mail {
  const origin = o.origin ?? CLIENT_ORIGIN;
  const prefsUrl = `${origin}${PREFS_PATH}`;
  const first = firstName(o.name);
  const hi = first ? `Hi ${first},` : "Hi,";
  const groups = groupByOrg(o.items);
  const many = groups.length > 1;
  const n = o.items.length;
  const updates = `${n} update${n === 1 ? "" : "s"}`;
  const digest = o.mode === "digest";
  const intro = digest
    ? `Here is what changed in your Epsilon portal since yesterday.`
    : n === 1
      ? `There is an update in your Epsilon portal that needs your attention.`
      : `There are ${n} updates in your Epsilon portal.`;
  const where = many ? "your projects" : (groups[0]?.org ?? "your projects");
  const title = digest ? `${updates} on ${where} since yesterday` : n === 1 ? (o.items[0]?.title ?? "An update in your portal") : `${updates} on ${where}`;
  const when = (iso: string) => {
    try {
      return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: o.timezone || "Asia/Karachi" }).format(new Date(iso));
    } catch {
      return "";
    }
  };
  const row = (it: MailItem): Item => {
    const t = when(it.created_at);
    return {
      kind: it.urgent ? `${kindLabel(it.kind)} · needs you` : kindLabel(it.kind),
      hot: it.urgent,
      title: it.title,
      meta: [many ? null : groups[0]?.org, t].filter(Boolean).join(" · "),
      href: itemUrl(origin, it.link),
    };
  };
  const rowsHtml = groups.map((g) => (many ? subhead(g.org) + items(g.items.map(row), { mt: 10 }) : items(g.items.map(row)))).join("");
  const rowsText = groups
    .map((g) => (many ? `${g.org}\n` : "") + g.items.map((it) => `- ${it.title} (${kindLabel(it.kind)})\n  ${itemUrl(origin, it.link)}`).join("\n"))
    .join("\n\n");
  return email({
    subject: subjectFor(o.mode, o.items),
    label: digest ? "Daily digest" : "Notification",
    preheader: o.items.map((i) => i.title).slice(0, 4).join(" · ") || "Your Epsilon portal",
    title,
    prefsUrl,
    why: digest
      ? "You get at most one digest a day, at 10:00 your time. Urgent items arrive straight away. You can switch to immediate emails or turn them off."
      : "You got this because you have email notifications on for the Epsilon client portal.",
    html: eyebrow(`${many ? "Your projects" : where} · ${updates}`) + h1(title) + p(`${esc(hi)} ${esc(intro.charAt(0).toLowerCase() + intro.slice(1))}`, { mb: 0 }) + rowsHtml + button(`${origin}/`, "Open the portal"),
    text: [hi, intro, rowsText, `Open the portal: ${origin}/`],
  });
}
