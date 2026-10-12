"use client";

import { useActionState, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./Icon";
import { eps } from "./eps";

export type FormResult = { ok?: string; error?: string } | undefined;

export function Note({ r }: { r: FormResult }) {
  if (r?.error)
    return (
      <p className="auth-error" role="alert" style={{ marginTop: 10 }}>
        <Icon name="alert" className="i-sm" />
        {r.error}
      </p>
    );
  if (r?.ok)
    return (
      <p className="ok-note" role="status" style={{ marginTop: 10 }}>
        <Icon name="check" className="i-sm" />
        {r.ok}
      </p>
    );
  return null;
}

/** A form posting to a (bound) server action of shape (prev, formData) => result, with the result shown under it. */
export function ActionForm({
  action, submit, children, className, secondary, icon,
}: {
  action: (prev: FormResult, fd: FormData) => Promise<FormResult>;
  submit: string;
  children: ReactNode;
  className?: string;
  secondary?: boolean;
  icon?: "check" | "send" | "plus" | "receipt" | "clock" | "sparkle";
}) {
  const [state, act, pending] = useActionState(action, undefined);
  return (
    <form action={act} className={className}>
      {children}
      <div className="row wrap" style={{ gap: 10, marginTop: 12 }}>
        <button className={`btn ${secondary ? "btn-secondary" : "btn-primary"}`} type="submit" disabled={pending}>
          {pending ? <span className="spinner" /> : icon ? <Icon name={icon} className="i-sm" /> : null}
          {submit}
        </button>
      </div>
      <Note r={state} />
    </form>
  );
}

/** One button calling a bound server action, with an optional confirm and a toast on success. */
export function ActionButton({
  action, label, confirmText, className, toast,
}: {
  action: () => Promise<FormResult>;
  label: string;
  confirmText?: string;
  className?: string;
  toast?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [r, setR] = useState<FormResult>(undefined);
  return (
    <span className="stack" style={{ gap: 4, alignItems: "flex-start" }}>
      <button
        className={className ?? "btn btn-secondary"}
        type="button"
        disabled={pending}
        onClick={() => {
          if (confirmText && !window.confirm(confirmText)) return;
          start(async () => {
            let res: FormResult;
            try {
              res = await action();
            } catch {
              res = { error: "Couldn't reach admin. Nothing was changed; try again." };
            }
            setR(res);
            if (res?.ok && toast !== false) eps()?.toast(res.ok, { icon: "check" });
            router.refresh();
          });
        }}
      >
        {pending ? <span className="spinner" /> : null}
        {label}
      </button>
      {r?.error && (
        <span className="c-bad t-12" role="alert">
          {r.error}
        </span>
      )}
    </span>
  );
}

/** Copies text to the clipboard ("Copy for website"). */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn btn-secondary btn-sm"
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          window.setTimeout(() => setDone(false), 2000);
        } catch {
          window.prompt("Copy this:", text);
        }
      }}
    >
      <Icon name={done ? "check" : "clip"} className="i-sm" />
      {done ? "Copied" : label}
    </button>
  );
}
