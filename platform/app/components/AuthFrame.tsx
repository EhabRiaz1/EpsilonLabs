import type { ReactNode } from "react";
import { ThemePill } from "./ThemePill";

/** Signed-out screens: the same rounded frame and canvas as the shell, with one centred panel. */
export function AuthFrame({ host, children }: { host: string; children: ReactNode }) {
  return (
    <div className="auth">
      <main className="panel auth-card">
        <div className="sb-brand" style={{ padding: "0 0 22px" }}>
          <span className="mark" aria-hidden="true">
            ε
          </span>
          <div className="sb-org">
            <strong>Epsilon Labs</strong>
            <span>{host}</span>
          </div>
        </div>
        {children}
      </main>
      <div className="auth-foot">
        <ThemePill />
        <span className="c-3 t-12">Invite-only · Epsilon Labs</span>
      </div>
    </div>
  );
}
