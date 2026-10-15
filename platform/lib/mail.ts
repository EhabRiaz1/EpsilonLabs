import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import type { Mail } from "./mail-templates";
import { inlineLogos } from "./email/layout";

export const FROM = "Epsilon Labs <notifications@epsilon-labs.co>";
export const FOUNDER_EMAIL = "er@epsilon-labs.co";

let transport: Transporter | null = null;

function smtp(): Transporter {
  if (transport) return transport;
  const { SMTP_HOST: host, SMTP_PORT: port, SMTP_USER: user, SMTP_PASSWORD: pass } = process.env;
  if (!host || !port || !user || !pass) throw new Error("SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASSWORD must be set");
  const p = Number(port);
  transport = nodemailer.createTransport({ host, port: p, secure: p === 465, auth: { user, pass }, connectionTimeout: 10_000, socketTimeout: 15_000 });
  return transport;
}

/** Sends through Zoho as notifications@ (F9). Throws on failure; callers decide what the user is told. */
export async function sendMail(to: string, mail: Mail, replyTo = FOUNDER_EMAIL): Promise<void> {
  const { html, attachments } = inlineLogos(mail.html); // the logo travels with the mail, not as a remote image
  await smtp().sendMail({ from: FROM, to, replyTo, subject: mail.subject, html, text: mail.text, attachments });
}

/** For notices whose failure must not change the outcome (the action already happened). Logs, never throws. */
export async function sendMailLogged(to: string, mail: Mail, what: string): Promise<boolean> {
  try {
    await sendMail(to, mail);
    return true;
  } catch (e) {
    console.error(`mail failed (${what}):`, e instanceof Error ? e.message : e);
    return false;
  }
}
