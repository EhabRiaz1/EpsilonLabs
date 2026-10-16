"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import { supabaseEnv } from "@/lib/supabase/env";
import { connectCommand } from "@/lib/claude-connect";

// "Connect Claude Code" (017): a project token for the Epsilon MCP. create_project_token returns the plaintext once
// (only its sha256 is stored); revoke_project_token ends it. Both check staff (aal2) again and audit.

const UUID = /^[0-9a-f-]{36}$/i;
export type TokenResult = { ok?: string; error?: string; token?: string; command?: string } | undefined;

export async function createProjectToken(orgId: string, projectId: string, folder: string | null, _prev: TokenResult, fd: FormData): Promise<TokenResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(orgId) || !UUID.test(projectId)) return { error: "Unknown project." };
  const label = String(fd.get("label") ?? "").trim().replace(/\s+/g, " ");
  if (!label || label.length > 60) return { error: "Give it a label of 1-60 characters, like \"Ehab's MacBook\"." };
  const { data, error } = await supabase.rpc("create_project_token", { p_project_id: projectId, p_label: label });
  if (error) {
    console.error("create_project_token failed:", error.message);
    if (/10 live tokens/.test(error.message)) return { error: "This project already has 10 live tokens. Revoke one first." };
    if (/archived|not active/.test(error.message)) return { error: "This project is archived or the client is not active." };
    return { error: "Couldn't create the token. Reload and try again." };
  }
  const token = String((data as { token?: string } | null)?.token ?? "");
  const { url, key } = supabaseEnv();
  let command: string;
  try {
    command = connectCommand({ token, url, anonKey: key, osDir: process.env.EPSILON_OS_DIR ?? null, folder });
  } catch (e) {
    console.error("connect command:", (e as Error).message);
    return { error: "The token was created but the command couldn't be built. Revoke it and try again." };
  }
  revalidatePath(`/clients/${orgId}`);
  return { ok: "Token created. Copy it now: it is not shown again.", token, command };
}

export async function revokeProjectToken(orgId: string, id: string): Promise<TokenResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(orgId) || !UUID.test(id)) return { error: "Unknown token." };
  const { error } = await supabase.rpc("revoke_project_token", { p_id: id });
  if (error) {
    console.error("revoke_project_token failed:", error.message);
    return { error: "Couldn't revoke the token. Reload and try again." };
  }
  revalidatePath(`/clients/${orgId}`);
  return { ok: "Token revoked. That Claude Code session can't reach Epsilon any more." };
}
