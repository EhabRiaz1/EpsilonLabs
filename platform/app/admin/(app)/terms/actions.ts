"use server";

import { headers } from "next/headers";
import { requireStaff } from "@/lib/staff";
import { clientOrigin } from "@/lib/host";
import { createHash } from "node:crypto";

export type TermsState = { error?: string; ok?: string } | undefined;

/**
 * Activating records the sha256 of the PDF clients are actually shown (fetched from client.*), so the acceptance
 * record fingerprints the published file. The database refuses a changed fingerprint once anything was accepted.
 */
export async function setTermsActive(version: string, active: boolean): Promise<TermsState> {
  const { supabase } = await requireStaff();
  const { data: t } = await supabase.from("terms_versions").select("version, pdf_path").eq("version", version).maybeSingle();
  if (!t) return { error: "Unknown terms version." };
  let sha: string | null = null;
  if (active) {
    const h = await headers();
    const url = `${clientOrigin({ host: h.get("host"), forwardedHost: h.get("x-forwarded-host"), forwardedProto: h.get("x-forwarded-proto") })}${t.pdf_path}`;
    try {
      const res = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return { error: `The published terms PDF isn't reachable (${res.status} at ${url}). Deploy it first.` };
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") return { error: `${url} is not a PDF.` };
      sha = createHash("sha256").update(buf).digest("hex");
    } catch (e) {
      return { error: `Couldn't fetch ${url}: ${e instanceof Error ? e.message : "network error"}` };
    }
  }
  const { error } = await supabase.rpc("set_terms_active", { p_version: version, p_active: active, p_sha256: sha });
  if (error) return { error: error.message };
  return { ok: active ? `${version} is active (fingerprint ${sha!.slice(0, 4)}…${sha!.slice(-4)}). Proposals under it can be accepted.` : `${version} is inactive. Nothing under it can be accepted.` };
}
