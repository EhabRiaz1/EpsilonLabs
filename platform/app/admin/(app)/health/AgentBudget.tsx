"use client";

import { ActionForm } from "@/app/components/Forms";
import { saveAgentBudget } from "./actions";

export function AgentBudgetForm({ budget, enabled }: { budget: number; enabled: boolean }) {
  return (
    <ActionForm action={saveAgentBudget} submit="Save" secondary icon="check">
      <div className="row wrap" style={{ gap: 14, alignItems: "flex-end" }}>
        <label className="field" style={{ minWidth: 200 }}>
          <span>Daily token budget</span>
          <input className="input" name="budget" inputMode="numeric" defaultValue={String(budget)} />
        </label>
        <label className="row t-13" style={{ gap: 8, height: 40 }}>
          <input type="checkbox" name="enabled" defaultChecked={enabled} />
          Project agent on
        </label>
      </div>
      <p className="hint" style={{ marginTop: 8 }}>Tokens = input + output + cache writes, per PKT day. At the budget, briefs, plans and agent runs wait until tomorrow; preview pushes and commit scans still run.</p>
    </ActionForm>
  );
}
