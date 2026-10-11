"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import { decideOpportunity, type OppResult } from "./actions";

// dashboard/actions.OPP_MOVES: which decisions each status allows
const MOVES: Record<string, [string, string, string][]> = {
  new: [["bid", "Bid", "btn-primary"], ["pass", "Pass", "btn-secondary"]],
  pass: [["bid", "Bid after all", "btn-secondary"]],
  bid: [["submitted", "Mark submitted", "btn-primary"], ["won", "Won", "btn-secondary"], ["lost", "Lost", "btn-secondary"], ["pass", "Pass", "btn-ghost"]],
  submitted: [["won", "Won", "btn-primary"], ["lost", "Lost", "btn-secondary"]],
};

export function OppActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const [r, setR] = useState<OppResult | null>(null);
  const moves = MOVES[status] ?? [];
  if (!moves.length) return <p className="c-3 t-13">Decided: {status}.</p>;
  const go = (act: string) =>
    start(async () => {
      try {
        const res = await decideOpportunity(id, act, act === "pass" ? reason : "");
        setR(res);
        if (res.ok) router.refresh();
      } catch {
        setR({ ok: false, message: "Couldn't reach admin. Nothing was changed." });
      }
    });
  return (
    <div className="stack" style={{ gap: 10 }}>
      {moves.some(([a]) => a === "pass") && (
        <input className="input" type="text" maxLength={300} placeholder="Reason for passing (optional)" aria-label="Reason for passing" value={reason} onChange={(e) => setReason(e.target.value)} />
      )}
      <div className="actions-bar">
        {moves.map(([act, label, cls]) => (
          <button key={act} className={`btn ${cls}`} type="button" disabled={pending} onClick={() => go(act)}>
            {label}
          </button>
        ))}
      </div>
      {r && !r.ok && (
        <p className="auth-error" role="alert" style={{ marginTop: 0 }}><Icon name="alert" className="i-sm" />{r.message}</p>
      )}
      {r?.ok && <p className="ok-note" role="status"><Icon name="check" className="i-sm" />{r.message}</p>}
    </div>
  );
}
