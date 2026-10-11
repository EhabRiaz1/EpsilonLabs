"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import { setTermsActive, type TermsState } from "./actions";

export function TermsToggle({ version, active }: { version: string; active: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<TermsState>(undefined);
  const [pending, start] = useTransition();
  function toggle() {
    const next = !active;
    const q = next
      ? `Activate ${version}? Clients can then accept proposals under it. Check the published PDF has the registered address first.`
      : `Deactivate ${version}? Nothing under it can be accepted until it is active again.`;
    if (!window.confirm(q)) return;
    start(async () => {
      setState(await setTermsActive(version, next));
      router.refresh();
    });
  }
  return (
    <div className="stack" style={{ gap: 8, alignItems: "flex-end" }}>
      <button className={`btn btn-sm ${active ? "btn-secondary" : "btn-primary"}`} type="button" disabled={pending} onClick={toggle}>
        {pending ? <span className="spinner" /> : null}
        {active ? "Deactivate" : "Activate"}
      </button>
      {state?.error && (
        <span className="c-bad t-12" role="alert">
          <Icon name="alert" className="i-sm" /> {state.error}
        </span>
      )}
      {state?.ok && (
        <span className="c-good t-12" role="status">
          {state.ok}
        </span>
      )}
    </div>
  );
}
