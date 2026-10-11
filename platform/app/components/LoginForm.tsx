"use client";

import { useActionState, useState } from "react";
import type { FormState } from "@/lib/auth-actions";
import { Icon } from "./Icon";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

/** Email magic link (default) or optional password (F3). */
export function LoginForm(props: { magicLink: Action; password: Action; linkError?: boolean; title: string; sub: string }) {
  const [mode, setMode] = useState<"link" | "password">("link");
  const [linkState, linkAction, linkPending] = useActionState(props.magicLink, undefined);
  const [pwState, pwAction, pwPending] = useActionState(props.password, undefined);
  const error = mode === "link" ? linkState?.error : pwState?.error;
  const pending = mode === "link" ? linkPending : pwPending;

  return (
    <>
      <h1 className="auth-title">{props.title}</h1>
      <p className="auth-sub">{props.sub}</p>
      {props.linkError && !error && (
        <p className="auth-error" role="alert">
          <Icon name="alert" className="i-sm" />
          That link has expired or was already used. Request a new one.
        </p>
      )}
      <div className="seg seg-block" style={{ marginTop: 20 }} role="group" aria-label="Sign-in method">
        <button type="button" aria-pressed={mode === "link"} onClick={() => setMode("link")}>
          Email link
        </button>
        <button type="button" aria-pressed={mode === "password"} onClick={() => setMode("password")}>
          Password
        </button>
      </div>
      <form action={mode === "link" ? linkAction : pwAction} className="stack" style={{ gap: 14, marginTop: 18 }} noValidate>
        <div className="field">
          <label className="label" htmlFor="email">
            Work email
          </label>
          <input
            className="input input-lg"
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@company.com"
            required
            autoFocus
          />
        </div>
        {mode === "password" && (
          <div className="field">
            <label className="label" htmlFor="password">
              Password
            </label>
            <input className="input input-lg" id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
        )}
        {error && (
          <p className="auth-error" role="alert">
            <Icon name="alert" className="i-sm" />
            {error}
          </p>
        )}
        <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={pending}>
          {pending ? (
            <>
              <span className="spinner" />
              {mode === "link" ? "Sending link" : "Signing in"}
            </>
          ) : mode === "link" ? (
            <>
              Email me a sign-in link
              <Icon name="arrowR" />
            </>
          ) : (
            "Sign in"
          )}
        </button>
        <p className="hint" style={{ textAlign: "center" }}>
          {mode === "link"
            ? "No password needed. The link works once and signs you in on this device."
            : "Passwords are optional. You can always use an email link instead."}
        </p>
      </form>
    </>
  );
}
