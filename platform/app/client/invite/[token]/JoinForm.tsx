"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/app/components/Icon";
import { acceptInvite, type JoinState } from "./actions";

export function JoinForm({ token, orgName }: { token: string; orgName: string }) {
  const [state, setState] = useState<JoinState>(undefined);
  const [pending, start] = useTransition();
  return (
    <>
      <button
        className="btn btn-primary btn-lg btn-block"
        type="button"
        disabled={pending}
        style={{ marginTop: 22 }}
        onClick={() => start(async () => setState(await acceptInvite(token)))}
      >
        {pending ? <span className="spinner" /> : <Icon name="arrowR" className="i-sm" />}
        Join {orgName}
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
