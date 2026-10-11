"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import { slugify } from "@/lib/slug";
import { createOrg, inviteToOrg, removeMemberAdmin, revokeInviteAdmin, saveProject, type ClientsResult } from "./actions";

function Note({ r }: { r: ClientsResult }) {
  if (r?.error)
    return (
      <p className="auth-error" role="alert">
        <Icon name="alert" className="i-sm" />
        {r.error}
      </p>
    );
  if (r?.ok)
    return (
      <p className="ok-note" role="status" style={{ marginTop: 12 }}>
        <Icon name="check" className="i-sm" />
        {r.ok}
      </p>
    );
  return null;
}

export function CreateOrgForm({ companies }: { companies: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createOrg, undefined);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  return (
    <form action={action} className="form-grid">
      <div className="field">
        <label className="label" htmlFor="org-name">
          Name
        </label>
        <input className="input" id="org-name" name="name" required maxLength={200} value={name} onChange={(e) => { setName(e.target.value); if (!touched) setSlug(slugify(e.target.value)); }} placeholder="Master Paints" />
      </div>
      <div className="field">
        <label className="label" htmlFor="org-slug">
          Slug
        </label>
        <input className="input mono-ish" id="org-slug" name="slug" required maxLength={63} pattern="[a-z0-9][a-z0-9\-]{0,62}" value={slug} onChange={(e) => { setTouched(true); setSlug(e.target.value); }} placeholder="master-paints" />
      </div>
      <div className="field">
        <label className="label" htmlFor="org-domain">
          Domain <span className="c-3">(optional)</span>
        </label>
        <input className="input" id="org-domain" name="domain" maxLength={200} placeholder="masterpaints.com" />
      </div>
      <div className="field">
        <label className="label" htmlFor="org-company">
          Linked company <span className="c-3">(optional)</span>
        </label>
        <select className="select" id="org-company" name="company_id" defaultValue="">
          <option value="">None</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="span-2 row" style={{ gap: 10 }}>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? <span className="spinner" /> : <Icon name="plus" className="i-sm" />}
          Create organisation
        </button>
        <span className="hint">Then invite its people and add projects.</span>
      </div>
      <div className="span-2">
        <Note r={state} />
      </div>
    </form>
  );
}

export function InviteForm({ orgId }: { orgId: string }) {
  const [state, action, pending] = useActionState(inviteToOrg.bind(null, orgId), undefined);
  return (
    <form action={action}>
      <div className="row wrap" style={{ gap: 8, alignItems: "flex-end" }}>
        <div className="field grow" style={{ minWidth: 220 }}>
          <label className="label" htmlFor="inv-email">
            Invite by email
          </label>
          <input className="input" id="inv-email" name="email" type="email" required maxLength={254} placeholder="name@company.com" autoComplete="off" />
        </div>
        <div className="field">
          <label className="label" htmlFor="inv-role">
            Role
          </label>
          <select className="select" id="inv-role" name="role" defaultValue="member" style={{ minWidth: 130 }}>
            <option value="member">Member</option>
            <option value="owner">Owner</option>
          </select>
        </div>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? <span className="spinner" /> : <Icon name="send" className="i-sm" />}
          Send invite
        </button>
      </div>
      <span className="hint" style={{ display: "block", marginTop: 6 }}>
        A one-time sign-in link from notifications@, valid 7 days. Owners can invite their own colleagues.
      </span>
      <Note r={state} />
    </form>
  );
}

export function RowAction({ kind, orgId, id, label, confirmText }: { kind: "revoke" | "remove"; orgId: string; id: string; label: string; confirmText: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [r, setR] = useState<ClientsResult>(undefined);
  return (
    <span className="stack" style={{ gap: 4, alignItems: "flex-end" }}>
      <button
        className="btn btn-ghost btn-sm"
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(confirmText)) return;
          start(async () => {
            setR(kind === "revoke" ? await revokeInviteAdmin(orgId, id) : await removeMemberAdmin(orgId, id));
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

export type ProjectValues = { id: string | null; name: string; status: string; summary: string; repo_path: string; progress: string; next_milestone: string; next_milestone_on: string };

export function ProjectForm({ orgId, p }: { orgId: string; p: ProjectValues }) {
  const [state, action, pending] = useActionState(saveProject.bind(null, orgId, p.id), undefined);
  const k = p.id ?? "new";
  return (
    <form action={action} className="form-grid">
      <div className="field">
        <label className="label" htmlFor={`pn-${k}`}>
          Name
        </label>
        <input className="input" id={`pn-${k}`} name="name" required maxLength={200} defaultValue={p.name} />
      </div>
      <div className="field">
        <label className="label" htmlFor={`ps-${k}`}>
          Status
        </label>
        <select className="select" id={`ps-${k}`} name="status" defaultValue={p.status}>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="done">Delivered</option>
          <option value="archived">Archived (hidden from the client)</option>
        </select>
      </div>
      <div className="field span-2">
        <label className="label" htmlFor={`pu-${k}`}>
          Summary <span className="c-3">(the client sees it)</span>
        </label>
        <input className="input" id={`pu-${k}`} name="summary" maxLength={2000} defaultValue={p.summary} placeholder="Operator screen and firmware · $18,000 · 40 / 40 / 20" />
      </div>
      <div className="field">
        <label className="label" htmlFor={`pm-${k}`}>
          Next milestone
        </label>
        <input className="input" id={`pm-${k}`} name="next_milestone" maxLength={120} defaultValue={p.next_milestone} placeholder="Factory acceptance" />
      </div>
      <div className="field">
        <label className="label" htmlFor={`pd-${k}`}>
          Milestone date
        </label>
        <input className="input" id={`pd-${k}`} name="next_milestone_on" type="date" defaultValue={p.next_milestone_on} />
      </div>
      <div className="field">
        <label className="label" htmlFor={`pp-${k}`}>
          Progress %
        </label>
        <input className="input" id={`pp-${k}`} name="progress" type="number" min={0} max={100} step={1} defaultValue={p.progress} placeholder="–" />
      </div>
      <div className="field">
        <label className="label" htmlFor={`pr-${k}`}>
          Repo path <span className="c-3">(staff only, on the Mac)</span>
        </label>
        <input className="input mono-ish" id={`pr-${k}`} name="repo_path" maxLength={500} defaultValue={p.repo_path} placeholder="~/dev/master-paints/tinting-hmi" />
      </div>
      <div className="span-2 row" style={{ gap: 10 }}>
        <button className="btn btn-secondary" type="submit" disabled={pending}>
          {pending ? <span className="spinner" /> : <Icon name={p.id ? "check" : "plus"} className="i-sm" />}
          {p.id ? "Save project" : "Add project"}
        </button>
      </div>
      <div className="span-2">
        <Note r={state} />
      </div>
    </form>
  );
}
