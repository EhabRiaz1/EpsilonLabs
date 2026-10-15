"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import { usePageCommands } from "@/app/components/AdminPalette";
import { eps } from "@/app/components/eps";
import { esc } from "@/lib/html";
import { runAgentNow } from "./actions";

/** "Run now" for one agent; also registered in ⌘K ("Run Prospector now") while the Agents page is open. A run started
 *  from the palette reports through a toast, since the button's message line may be off screen. */
export function RunNow({ agent, label, online }: { agent: string; label: string; online: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function run(fromPalette = false) {
    start(async () => {
      let m: { ok: boolean; text: string };
      try {
        const r = await runAgentNow(agent);
        m = r.ok
          ? { ok: true, text: r.already ? "Already queued." : online ? "Queued · the Mac starts it within a minute." : "Queued until the Mac is back." }
          : { ok: false, text: r.message ?? "Not queued." };
        router.refresh();
      } catch {
        m = { ok: false, text: "Couldn't reach admin. Nothing was queued." };
      }
      setMsg(m);
      if (fromPalette) eps()?.toast(esc(`${label}: ${m.text}`), { icon: m.ok ? "check" : "alert" });
    });
  }
  usePageCommands("Agents", [{ label: `Run ${label} now`, icon: "play", run: () => run(true) }], `run-${agent}`);

  return (
    <span className="stack g-4 ai-end">
      <button className="btn btn-secondary btn-sm" type="button" disabled={pending} aria-label={`Run ${label} now`} onClick={() => run()}>
        {pending ? <span className="spinner" /> : <Icon name="play" className="i-sm" />}
        Run now
      </button>
      {msg && (
        <span className={`t-12 ${msg.ok ? "c-good" : "c-bad"}`} role="status">
          {msg.text}
        </span>
      )}
    </span>
  );
}
