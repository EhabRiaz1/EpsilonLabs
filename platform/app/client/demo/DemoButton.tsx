"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/app/components/Icon";
import { startDemo, type DemoState } from "./actions";

export function DemoButton() {
  const [state, setState] = useState<DemoState>(undefined);
  const [pending, start] = useTransition();
  return (
    <>
      <button
        className="btn btn-primary btn-lg btn-block"
        type="button"
        disabled={pending}
        style={{ marginTop: 22 }}
        onClick={() => start(async () => setState(await startDemo()))}
      >
        {pending ? <span className="spinner" /> : <Icon name="arrowR" className="i-sm" />}
        View demo
      </button>
      {state?.error && (
        <p className="auth-error" role="alert">
          <Icon name="alert" className="i-sm" />
          {state.error}
        </p>
      )}
    </>
  );
}
