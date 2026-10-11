"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import type { FormState } from "@/lib/auth-actions";
import { Icon } from "./Icon";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

/** "Check your email" with the resend timer from the approved OTP pattern. */
export function SentPanel({ email, resend }: { email: string; resend: Action }) {
  const [left, setLeft] = useState(59);
  const [state, action, pending] = useActionState(resend, undefined);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  return (
    <div className="auth-done">
      <div className="empty" style={{ padding: "8px 0 0" }}>
        <div className="orb">
          <span className="wave" />
          <span className="wave" />
          <span className="core">
            <Icon name="mail" className="i-lg" />
          </span>
        </div>
      </div>
      <h1 className="auth-title" style={{ textAlign: "center" }}>
        Check your email
      </h1>
      <p className="auth-sub" style={{ textAlign: "center" }}>
        If <span className="mono">{email || "that address"}</span> has an account, a sign-in link is on its way. It works once
        and expires in one hour.
      </p>
      {state?.error && (
        <p className="auth-error" role="alert" style={{ marginTop: 14 }}>
          <Icon name="alert" className="i-sm" />
          {state.error}
        </p>
      )}
      <form action={action} className="resend-line">
        <input type="hidden" name="email" value={email} />
        {left > 0 ? (
          <span>
            Resend link in <span className="mono">0:{String(left).padStart(2, "0")}</span>
          </span>
        ) : (
          <button type="submit" className="link-btn" disabled={pending || !email}>
            {pending ? "Sending…" : "Resend link"}
          </button>
        )}
        <span aria-hidden="true"> · </span>
        <Link className="link-btn" href="/login">
          Wrong email?
        </Link>
      </form>
    </div>
  );
}
