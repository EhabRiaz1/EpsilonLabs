"use client";

import { useActionState } from "react";
import { Icon } from "@/app/components/Icon";
import { Note } from "@/app/components/Forms";
import { saveProjectAgent } from "./agent-actions";

export type AgentValues = { test_command: string; test_env_file: string; default_branch: string; agent_enabled: boolean; is_git: boolean | null; git_checked_at: string | null; has_repo: boolean };

/** Project agent settings (015): what the agent may run, and whether it may run at all. Staff only. */
export function ProjectAgentForm({ orgId, projectId, v }: { orgId: string; projectId: string; v: AgentValues }) {
  const [state, action, pending] = useActionState(saveProjectAgent.bind(null, orgId, projectId), undefined);
  const k = projectId;
  const git = !v.has_repo ? "No repo path: Manual only." : v.is_git === true ? "Git repo detected: Agent mode available." : v.is_git === false ? "Not a git repo: Manual only." : "The Mac checks the folder every 10 min.";
  return (
    <form action={action} className="form-grid" style={{ marginTop: 16, paddingTop: 16, borderTop: "1px dashed var(--line)" }}>
      <div className="span-2 row between wrap" style={{ gap: 8 }}>
        <span className="w-600">Project agent</span>
        <span className={`pill ${v.is_git ? "pill-good" : ""}`}><Icon name="branch" className="i-sm" />{git}</span>
      </div>
      <div className="field">
        <label className="label" htmlFor={`tc-${k}`}>
          Test command <span className="c-3">(the only command the agent may run)</span>
        </label>
        <input className="input mono-ish" id={`tc-${k}`} name="test_command" maxLength={200} defaultValue={v.test_command} placeholder="npm test" />
      </div>
      <div className="field">
        <label className="label" htmlFor={`te-${k}`}>
          Test env file <span className="c-3">(optional, inside the folder)</span>
        </label>
        <input className="input mono-ish" id={`te-${k}`} name="test_env_file" maxLength={200} defaultValue={v.test_env_file} placeholder=".env.test" />
      </div>
      <div className="field">
        <label className="label" htmlFor={`db-${k}`}>
          Default branch <span className="c-3">(blank: main / master)</span>
        </label>
        <input className="input mono-ish" id={`db-${k}`} name="default_branch" maxLength={100} defaultValue={v.default_branch} placeholder="main" />
      </div>
      <label className="row t-13" style={{ gap: 8, alignSelf: "end", height: 40 }}>
        <input type="checkbox" name="agent_enabled" defaultChecked={v.agent_enabled} disabled={!v.has_repo} />
        Agent enabled for this project
      </label>
      <p className="hint span-2">
        The plan agent only reads the folder. The execute agent edits only in ~/EpsilonWork/worktrees on a ticket/EL-n branch; node_modules is linked, .env is never copied
        (only the test env file above). Your scripts run as your macOS user.
      </p>
      <div className="span-2 row" style={{ gap: 10 }}>
        <button className="btn btn-secondary" type="submit" disabled={pending}>
          {pending ? <span className="spinner" /> : <Icon name="check" className="i-sm" />}
          Save agent settings
        </button>
      </div>
      <div className="span-2">
        <Note r={state} />
      </div>
    </form>
  );
}
