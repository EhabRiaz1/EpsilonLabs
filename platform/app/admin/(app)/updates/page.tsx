import type { Metadata } from "next";
import { Icon } from "@/app/components/Icon";
import { PageHeader } from "@/app/components/PageHeader";
import { Empty } from "@/app/components/Empty";
import { Note } from "@/app/components/Note";
import { Sheet } from "@/app/components/Sheet";
import { SheetButton } from "@/app/components/SheetButton";
import { ActionForm } from "@/app/components/Forms";
import { UpdateBody } from "@/app/components/UpdateBody";
import { getSession } from "@/lib/session";
import { dayMonth, stamp } from "@/lib/dates";
import { createManualUpdate, queueWeekly } from "./actions";
import { UpdateDraft } from "./UpdateDraft";

export const metadata: Metadata = { title: "Updates" };

type Row = {
  id: string; title: string; body_md: string; status: string; source: string; week_of: string | null; created_at: string; published_at: string | null;
  inputs: Record<string, number | string | null> | null; lint: { type: string; text: string }[] | null; skipped_reason: string | null;
  projects: { name: string } | { name: string }[] | null; organizations: { name: string } | { name: string }[] | null;
};
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const COLS = "id, title, body_md, status, source, week_of, created_at, published_at, inputs, lint, skipped_reason, projects(name), organizations(name)";

export default async function UpdatesPage() {
  const { supabase } = await getSession();
  const [drafts, recent, projects] = await Promise.all([
    supabase.from("updates").select(COLS).eq("status", "draft").order("created_at", { ascending: true }).limit(100),
    supabase.from("updates").select(COLS).neq("status", "draft").order("updated_at", { ascending: false }).limit(30),
    supabase.from("projects").select("id, name, organizations(name, is_test)").eq("status", "active").order("name"),
  ]);
  const ds = (drafts.data ?? []) as unknown as Row[];
  const rs = (recent.data ?? []) as unknown as Row[];
  const ps = ((projects.data ?? []) as unknown as { id: string; name: string; organizations: { name: string; is_test: boolean } | null }[]).map((p) => ({
    id: p.id,
    label: `${one(p.organizations)?.name ?? ""} · ${p.name}`,
  }));
  const projectSelect = (idp: string) => (
    <div className="field">
      <label className="label" htmlFor={idp}>Project</label>
      <select className="select" id={idp} name="project_id" required defaultValue="">
        <option value="" disabled>Pick a project</option>
        {ps.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Updates"
        sub={
          <>
            <span>{ds.length} draft{ds.length === 1 ? "" : "s"} to review</span>
            <span aria-hidden="true">·</span>
            <span>weekly drafts arrive Fridays 15:00 PKT; nothing reaches a client until you publish</span>
          </>
        }
        actions={
          <>
            <SheetButton sheet="update-write">
              <Icon name="pencil" className="i-sm" />
              Write one
            </SheetButton>
            <SheetButton sheet="update-queue" className="btn btn-primary">
              <Icon name="send" className="i-sm" />
              Draft this week&apos;s
            </SheetButton>
          </>
        }
      />

      <div className="stack gap-12">
          <section className="panel">
            <div className="panel-head">
              <h2>Drafts to review</h2>
              <span className="c-3 t-12 more">{ds.length}</span>
            </div>
            {drafts.error && <Note retry>Couldn&apos;t load drafts.</Note>}
            {!drafts.error && ds.length === 0 && (
              <Empty title="All clear">
                <p>No update drafts. Friday&apos;s drafts arrive here and in Approvals.</p>
              </Empty>
            )}
            {ds.map((u) => {
              const inputs = u.inputs ?? {};
              const lint = Array.isArray(u.lint) ? u.lint : [];
              return (
                <div key={u.id} style={{ borderTop: "1px solid var(--line)", padding: "16px 22px 20px" }}>
                  <div className="row between wrap" style={{ gap: 8, marginBottom: 10 }}>
                    <div>
                      <div className="w-600">{one(u.organizations)?.name} · {one(u.projects)?.name}</div>
                      <div className="c-3 t-12">
                        {u.source === "weekly" ? `Weekly · week of ${u.week_of ? dayMonth(u.week_of) : ""}` : "Written by you"} · drafted {stamp(u.created_at)}
                        {u.source === "weekly" && ` · from ${inputs.tickets_done ?? 0} done, ${inputs.activity ?? 0} events, ${inputs.commits ?? 0} commits`}
                      </div>
                    </div>
                    <span className={`pill ${lint.length ? "pill-warn" : "pill-accent"}`}><span className="dot" />{lint.length ? `${lint.length} lint` : "Draft"}</span>
                  </div>
                  {lint.length > 0 && (
                    <div className="lint-list" style={{ marginBottom: 8 }}>
                      {lint.map((h, k) => (
                        <span key={k} className="pill pill-warn"><span className="dot" />{h.type}: {h.text.slice(0, 60)}</span>
                      ))}
                    </div>
                  )}
                  <UpdateDraft id={u.id} title={u.title} body={u.body_md} />
                </div>
              );
            })}
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Recently published or skipped</h2></div>
            {recent.error && <Note retry>Couldn&apos;t load published updates.</Note>}
            {!recent.error && rs.length === 0 && <Empty variant="inline">Nothing published or skipped yet.</Empty>}
            {rs.map((u) => (
              <details key={u.id} style={{ borderTop: "1px solid var(--line)" }}>
                <summary className="row" style={{ padding: "12px 22px", cursor: "pointer", listStyle: "none", gap: 10 }}>
                  <span className="grow">
                    <span className="w-600">{u.title}</span>
                    <span className="c-3 t-12" style={{ display: "block" }}>
                      {one(u.organizations)?.name} · {one(u.projects)?.name} · {u.status === "published" && u.published_at ? `published ${stamp(u.published_at)}` : `skipped${u.skipped_reason ? `: ${u.skipped_reason}` : ""}`}
                    </span>
                  </span>
                  <span className={`pill ${u.status === "published" ? "pill-good" : ""}`}><span className="dot" />{u.status === "published" ? "Published" : "Skipped"}</span>
                </summary>
                <div style={{ padding: "0 22px 18px" }}><UpdateBody md={u.body_md} /></div>
              </details>
            ))}
          </section>
      </div>

      <Sheet id="update-queue" title="Draft this week's update now" sub="The Mac drafts it from the week's tickets, client-visible activity and EL-n commits.">
        <ActionForm action={queueWeekly} submit="Queue the draft" icon="send">
          <div className="stack gap-10">
            {projectSelect("upd-project-q")}
            <div className="field">
              <label className="label" htmlFor="upd-notes">
                Notes for the drafter <span className="c-3">(optional)</span>
              </label>
              <textarea className="textarea" id="upd-notes" name="notes" rows={3} maxLength={2000} placeholder="e.g. Mention the CT clamp swap on hall 2" />
            </div>
          </div>
        </ActionForm>
      </Sheet>
      <Sheet id="update-write" title="Write an update yourself" sub="Saved as a draft; publish it from this page." wide>
        <ActionForm action={createManualUpdate} submit="Save as draft" icon="plus">
          <div className="stack gap-10">
            {projectSelect("upd-project-w")}
            <div className="field">
              <label className="label" htmlFor="upd-title">Title</label>
              <input className="input" id="upd-title" name="title" maxLength={200} required />
            </div>
            <div className="field">
              <label className="label" htmlFor="upd-body">Update</label>
              <textarea className="textarea" id="upd-body" name="body" rows={10} maxLength={20000} defaultValue={"## Done this week\n- \n\n## Next\n- \n\n## Needs your input\n- Nothing this week."} />
            </div>
          </div>
        </ActionForm>
      </Sheet>
    </>
  );
}
