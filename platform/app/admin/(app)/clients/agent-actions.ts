"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import type { FormResult } from "@/app/components/Forms";

// Project agent settings (015, OV2): the test command is set here by the founder and is the ONLY command the agent may
// run. save_project_agent validates it again (plain command, no shell operators) and audits the change.

const UUID = /^[0-9a-f-]{36}$/i;
const TEST_CMD = /^[A-Za-z0-9 ._:/=@+-]{1,200}$/;
const ENV_FILE = /^[A-Za-z0-9._-][A-Za-z0-9._/-]{0,199}$/;
const BRANCH = /^[A-Za-z0-9._/-]{1,100}$/;

export async function saveProjectAgent(orgId: string, projectId: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const { supabase } = await requireStaff();
  if (!UUID.test(orgId) || !UUID.test(projectId)) return { error: "Unknown project." };
  const cmd = String(fd.get("test_command") ?? "").trim().replace(/\s+/g, " ");
  const env = String(fd.get("test_env_file") ?? "").trim();
  const branch = String(fd.get("default_branch") ?? "").trim();
  if (cmd && !TEST_CMD.test(cmd)) return { error: "The test command is one plain command (letters, digits, spaces and . _ : / = @ + -), no ; && | $ or quotes." };
  if (env && (!ENV_FILE.test(env) || env.split("/").includes(".."))) return { error: "The test env file is a path inside the project folder, like .env.test." };
  if (branch && (!BRANCH.test(branch) || branch.includes("..") || branch.startsWith("-"))) return { error: "That isn't a branch name." };
  const { error } = await supabase.rpc("save_project_agent", {
    p_project_id: projectId,
    p_test_command: cmd || null,
    p_test_env_file: env || null,
    p_default_branch: branch || null,
    p_agent_enabled: fd.get("agent_enabled") === "on",
  });
  if (error) {
    console.error("save_project_agent failed:", error.message);
    if (/project folder before enabling/.test(error.message)) return { error: "Set the repo path (and save the project) before enabling the agent." };
    return { error: "Couldn't save the agent settings. Reload and try again." };
  }
  revalidatePath(`/clients/${orgId}`);
  return { ok: "Agent settings saved." };
}
