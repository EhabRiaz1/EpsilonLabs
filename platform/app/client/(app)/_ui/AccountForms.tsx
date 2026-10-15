"use client";

import { useActionState, useState, useTransition } from "react";
import { ask } from "@/app/components/Confirm";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import { inviteMember, removeMember, revokeInvite, switchOrg, updateName, type Result } from "../actions";

function Note({ r }: { r: Result }) {
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

export function NameForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState(updateName, undefined);
  return (
    <form action={action}>
      <div className="row wrap" style={{ gap: 8, alignItems: "flex-end" }}>
        <div className="field grow" style={{ minWidth: 200 }}>
          <label className="label" htmlFor="acct-name">
            Your name
          </label>
          <input className="input" id="acct-name" name="name" defaultValue={name} maxLength={100} autoComplete="name" required />
        </div>
        <button className="btn btn-secondary" type="submit" disabled={pending}>
          {pending ? <span className="spinner" /> : null}
          Save
        </button>
      </div>
      <Note r={state} />
    </form>
  );
}

export function OrgSwitcher({ orgs, current }: { orgs: { orgId: string; name: string; role: string }[]; current: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [r, setR] = useState<Result>(undefined);
  return (
    <div className="stack" style={{ gap: 0 }}>
      <div className="list-rows">
        {orgs.map((o) => (
          <button
            key={o.orgId}
            type="button"
            disabled={pending || o.orgId === current}
            aria-pressed={o.orgId === current}
            onClick={() =>
              start(async () => {
                const res = await switchOrg(o.orgId);
                setR(res);
                if (res?.ok) router.push("/");
              })
            }
          >
            <span className="avatar avatar-soft" aria-hidden="true">
              {o.name.slice(0, 2).toUpperCase()}
            </span>
            <span className="grow">
              <span className="w-600">{o.name}</span>
              <span className="c-3 t-12" style={{ display: "block" }}>
                {o.role === "owner" ? "Owner" : "Member"}
              </span>
            </span>
            {o.orgId === current ? (
              <span className="pill pill-good">
                <span className="dot" />
                Showing
              </span>
            ) : (
              <span className="c-3 t-12">Switch</span>
            )}
          </button>
        ))}
      </div>
      <Note r={r?.error ? r : undefined} />
    </div>
  );
}

export function InviteForm({ orgId }: { orgId: string }) {
  const [state, action, pending] = useActionState(inviteMember.bind(null, orgId), undefined);
  return (
    <form action={action}>
      <div className="row wrap" style={{ gap: 8, alignItems: "flex-end" }}>
        <div className="field grow" style={{ minWidth: 220 }}>
          <label className="label" htmlFor="invite-email">
            Invite a colleague
          </label>
          <input className="input" id="invite-email" name="email" type="email" placeholder="name@company.com" maxLength={254} required autoComplete="off" />
        </div>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? <span className="spinner" /> : <Icon name="send" className="i-sm" />}
          Send invite
        </button>
      </div>
      <span className="hint" style={{ display: "block", marginTop: 6 }}>
        They get a sign-in link from notifications@epsilon-labs.co, valid for 7 days. Members can raise requests and see files and invoices.
      </span>
      <Note r={state} />
    </form>
  );
}

export function TeamAction({ kind, orgId, id, label, confirmText }: { kind: "revoke" | "remove"; orgId: string; id: string; label: string; confirmText: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [r, setR] = useState<Result>(undefined);
  return (
    <span className="stack" style={{ gap: 4, alignItems: "flex-end" }}>
      <button
        className="btn btn-ghost btn-sm"
        type="button"
        disabled={pending}
        onClick={async () => {
          if (!(await ask({ title: confirmText, confirm: label, tone: "danger" }))) return;
          start(async () => {
            const res = kind === "revoke" ? await revokeInvite(id) : await removeMember(orgId, id);
            setR(res);
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
