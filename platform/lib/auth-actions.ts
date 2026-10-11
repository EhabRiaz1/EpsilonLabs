"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSite, type Site } from "@/lib/host";

export type FormState = { error?: string } | undefined;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Unknown address with shouldCreateUser: false. Treated as "sent" so the form never reveals who has an account.
const NO_ACCOUNT = new Set(["otp_disabled", "signup_disabled", "user_not_found"]);

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.includes(".localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function readEmail(formData: FormData): string | null {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

/** Invite-only magic link (F3): shouldCreateUser is false, so a stranger can never create an account. */
export async function sendMagicLink(site: Site, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!isSite(site)) return { error: "Unknown site." };
  const email = readEmail(formData);
  if (!email) return { error: "Enter a valid email address." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${await origin()}/auth/confirm` },
  });
  if (error && !NO_ACCOUNT.has(error.code ?? "")) {
    if (error.code === "over_email_send_rate_limit" || error.status === 429) {
      return { error: "Too many links requested. Wait a minute, then try again." };
    }
    return { error: "We couldn't send the link. Try again, or email er@epsilon-labs.co." };
  }
  redirect(`/login/sent?email=${encodeURIComponent(email)}`);
}

/** Optional password (F3). One message for every failure, so it does not reveal which part was wrong. */
export async function signInWithPassword(site: Site, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!isSite(site)) return { error: "Unknown site." };
  const email = readEmail(formData);
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.status === 429) return { error: "Too many attempts. Wait a minute, then try again." };
    return { error: "That email and password don't match an account." };
  }
  redirect(site === "admin" ? "/mfa" : "/");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
