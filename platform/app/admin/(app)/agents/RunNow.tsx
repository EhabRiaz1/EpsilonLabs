"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import { runAgentNow } from "./actions";

export function RunNow({ agent, label, online }: { agent: string; label: string; online: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="stack" style={{ gap: 4, alignItems: "flex-end" }}>
      <button
        className="btn btn-secondary btn-sm"
        type="button"
        disabled={pending}
        aria-label={`Run ${label} now`}
        onClick={() =>
          start(async () => {
            try {
              const r = await runAgentNow(agent);
              setMsg(
                r.ok
                  ? { ok: true, text: r.already ? "Already queued." : online ? "Queued · the Mac starts it within a minute." : "Queued until the Mac is back." }
                  : { ok: false, text: r.message ?? "Not queued." },
              );
              router.refresh();
            } catch {
              setMsg({ ok: false, text: "Couldn't reach admin. Nothing was queued." });
            }
          })
        }
      >
        {pending ? <span className="spinner" /> : <Icon name="play" className="i-sm" />}
        Run now
      </button>
      {msg && <span className={`t-12 ${msg.ok ? "c-good" : "c-bad"}`} role="status">{msg.text}</span>}
    </span>
  );
}
