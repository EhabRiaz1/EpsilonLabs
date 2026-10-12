import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import { MenuButton } from "@/app/components/ShellControls";
import { getSession } from "@/lib/session";
import { peopleById } from "@/lib/portal";
import { clientStatus, PRIORITY_LABEL, staffStatus, TYPE_LABEL } from "@/lib/tickets";
import { dayMonth, stamp } from "@/lib/dates";
import { prettySize } from "@/lib/files";
import { ReplyComposer, SendNoteButton, StatusControl, TimelineFilter } from "../TicketControls";
import { TimePanel, type TimeEntry } from "../TimePanel";
import { AutoRefresh } from "@/app/components/AutoRefresh";
import { agentAvailability, approvedRun, canPlan, fmtTokens, latestRun, pipelineStage, pipelineSteps, type ProjectAgent } from "@/lib/pipeline";
import { BriefCard, DiffViewer, ModePicker, PlanCard, ReviewActions, StartRun, Stepper, TestLog, Act, type Brief, type Plan, type TestResult } from "../Pipeline";
import * as P from "../pipeline-actions";

export const metadata: Metadata = { title: "Ticket" };

type Ticket = {
  id: string; ref: string; org_id: string; project_id: string; number: number; mode: string | null; title: string; body: string; type: string; priority: string; status: string; author_id: string | null;
  created_at: string; updated_at: string; organizations: { name: string } | { name: string }[] | null; projects: { name: string } | { name: string }[] | null;
};
type Event = { id: string; kind: string; body: string | null; data: { from?: string; to?: string; sha?: string } | null; client_visible: boolean; actor: string | null; created_at: string };
type RunRow = {
  id: string; stage: "brief" | "plan" | "execute"; status: string; output: Record<string, unknown> | null; notes: string | null;
  diff_stat: { files_changed?: number; added?: number; removed?: number; truncated?: boolean; files?: { path: string }[] } | null; diff: string | null;
  test_result: TestResult | null; usage: { cost_usd?: number | null; num_turns?: number | null } | null; tokens: number | null; worktree: string | null;
  branch: string | null; base_sha: string | null; head_sha: string | null; error: string | null; edited_at: string | null; approved_at: string | null;
  preview_requested_at: string | null; pushed_at: string | null; push_error: string | null; preview_url: string | null; created_at: string; finished_at: string | null;
};
type Agent = ProjectAgent & { id: string; test_env_file: string | null; default_branch: string | null };
const RUN_COLS = "id, stage, status, output, notes, diff_stat, diff, test_result, usage, tokens, worktree, branch, base_sha, head_sha, error, edited_at, approved_at, preview_requested_at, pushed_at, push_error, preview_url, created_at, finished_at";
type File = { id: string; name: string; size: number; created_at: string; uploaded_by: string | null };
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export default async function AdminTicket({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await getSession();
  const { data } = await supabase
    .from("tickets")
    .select("id, ref, org_id, project_id, number, mode, title, body, type, priority, status, author_id, created_at, updated_at, organizations(name), projects(name)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const t = data as Ticket;
  const [{ data: ev }, { data: fl }, { data: te }, { data: ret }, { data: rn }, { data: ag }] = await Promise.all([
    supabase.from("ticket_events").select("id, kind, body, data, client_visible, actor, created_at").eq("ticket_id", id).order("created_at"),
    supabase.from("files").select("id, name, size, created_at, uploaded_by").eq("ticket_id", id).eq("status", "ready").order("created_at"),
    supabase.from("time_entries").select("id, minutes, note, billable, worked_on").eq("ticket_id", id).order("worked_on", { ascending: false }).limit(100),
    supabase.from("retainers").select("id").eq("org_id", t.org_id).eq("status", "active").limit(1),
    // 015: staff-only RLS; the client portal never reads ticket_runs
    supabase.from("ticket_runs").select(RUN_COLS).eq("ticket_id", id).order("created_at"),
    supabase.rpc("staff_project_agent", { p_org_id: t.org_id }),
  ]);
  const runs = (rn ?? []) as RunRow[];
  const agent = (((ag ?? []) as Agent[]).find((x) => x.id === t.project_id) ?? null) as Agent | null;
  const stage = pipelineStage(t, runs, agent);
  const steps = pipelineSteps(t, runs, agent);
  const briefRun = latestRun(runs, "brief");
  const planRun = latestRun(runs, "plan");
  const execRun = latestRun(runs, "execute");
  const okBrief = approvedRun(runs, "brief");
  const okPlan = approvedRun(runs, "plan");
  const avail = agentAvailability(agent, Boolean(okPlan));
  const working = runs.some((r) => r.status === "queued");
  const touched = new Set((execRun?.diff_stat?.files ?? []).map((f) => f.path));
  const events = (ev ?? []) as Event[];
  const files = (fl ?? []) as File[];
  const people = await peopleById(supabase, [t.author_id, ...events.map((e) => e.actor), ...files.map((f) => f.uploaded_by)]);
  const name = (uid: string | null) => (uid ? (people.get(uid)?.staff ? "You" : (people.get(uid)?.name ?? "Someone")) : "System");
  const author = people.get(t.author_id ?? "")?.name ?? "the client";
  const clientFirst = author.split(/\s+/)[0] || "the client";
  const org = one(t.organizations)?.name ?? "";
  const project = one(t.projects)?.name ?? "";
  const s = staffStatus(t.status);

  type Item = { key: string; at: string; vis: "client" | "internal"; kind: string; title: string; pill: string; body?: string; untrusted?: boolean; publish?: string };
  const items: Item[] = [
    { key: "open", at: t.created_at, vis: "client" as const, kind: "client", title: `${author} opened the ticket`, pill: "client" },
    ...events.map((e): Item => {
      const staffActor = Boolean(e.actor && people.get(e.actor)?.staff);
      if (e.kind === "status")
        return { key: e.id, at: e.created_at, vis: "client", kind: e.data?.to === "done" ? "done" : "client", title: `Status → ${staffStatus(e.data?.to ?? "").label} (client sees "${clientStatus(e.data?.to ?? "").label}")`, pill: "client · auto" };
      if (e.kind === "comment")
        return {
          key: e.id,
          at: e.created_at,
          vis: e.client_visible ? "client" : "internal",
          kind: e.client_visible ? "client" : "internal",
          title: staffActor ? (e.client_visible ? "You replied" : "Internal note") : `${name(e.actor)} commented`,
          pill: e.client_visible ? "client" : "internal",
          body: e.body ?? "",
          untrusted: !staffActor,
          publish: staffActor && !e.client_visible ? e.id : undefined,
        };
      if (e.kind === "commit")
        return { key: e.id, at: e.created_at, vis: "internal", kind: "internal", title: `Commit ${e.data?.sha ?? ""}: ${e.body ?? ""}`, pill: "internal · git log" };
      if (["brief", "plan", "diff", "preview"].includes(e.kind))
        return { key: e.id, at: e.created_at, vis: "internal", kind: "internal", title: e.body ?? e.kind, pill: "internal" };
      return { key: e.id, at: e.created_at, vis: e.client_visible ? "client" : "internal", kind: "internal", title: e.kind, pill: e.client_visible ? "client" : "internal", body: e.body ?? undefined };
    }),
    ...files.map((f): Item => ({ key: f.id, at: f.created_at, vis: "client", kind: "client", title: `${name(f.uploaded_by)} attached ${f.name}`, pill: "client" })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const unanswered = (() => {
    const lastClient = [...items].reverse().find((i) => i.untrusted);
    const lastReply = [...items].reverse().find((i) => i.title === "You replied");
    return lastClient && (!lastReply || lastReply.at < lastClient.at) ? lastClient.key : null;
  })();

  return (
    <>
      <div className="row" style={{ gap: 12, marginBottom: 6 }}>
        <MenuButton />
        <Link className="btn btn-ghost btn-sm" href="/tickets">
          <Icon name="arrowL" className="i-sm" />
          Tickets
        </Link>
      </div>
      <header className="t-head">
        <div style={{ minWidth: 0 }}>
          <span className="mono c-3 t-13">
            {t.ref} · {org}
          </span>
          <h1 className="display" style={{ overflowWrap: "anywhere" }}>
            {t.title}
          </h1>
          <div className="pills">
            <span className={`pill ${s.tone}`}>
              <span className="dot" />
              {s.label}
            </span>
            <span className="pill">{TYPE_LABEL[t.type] ?? t.type}</span>
            {project && <span className="pill">{project}</span>}
            <span className={`pill ${t.priority === "urgent" ? "pill-bad" : ""}`}>{PRIORITY_LABEL[t.priority] ?? t.priority}</span>
          </div>
        </div>
        <div className="opened">
          <strong>Opened {dayMonth(t.created_at)}</strong>
          by {author} · updated {stamp(t.updated_at)}
        </div>
      </header>

      <section className="panel pipe" style={{ marginBottom: 14 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <span className="c-3 t-12">{t.mode === "agent" ? "Agent mode" : t.mode === "manual" ? "Manual mode" : "Project agent"} · the client sees status labels only</span>
          {working && <AutoRefresh seconds={20} />}
        </div>
        <Stepper steps={steps} />
      </section>

      <div className="t-grid">
        <div className="col">
          {stage === "brief" && (
            <section className="panel">
              <div className="panel-head">
                <h2>Brief</h2>
                <span className="c-3 t-12 more">AI, tool-less · from the client&apos;s words</span>
              </div>
              <div className="pane">
                {!briefRun || briefRun.status === "superseded" ? (
                  <div className="stack" style={{ gap: 10 }}>
                    <p className="c-2">No brief yet. The Mac drafts one with no tools from the ticket text; you approve or edit it before anything reads the code.</p>
                    <div className="row"><Act action={P.requestBrief.bind(null, t.id)} label="Draft brief" icon="sparkle" cls="btn btn-primary btn-sm" /></div>
                  </div>
                ) : briefRun.status === "queued" ? (
                  <p className="c-2"><span className="spinner" /> Drafting on the Mac (tool-less). This page refreshes on its own.</p>
                ) : briefRun.status === "failed" ? (
                  <div className="stack" style={{ gap: 10 }}>
                    <p className="c-bad"><Icon name="alert" className="i-sm" /> AI couldn&apos;t draft it: {briefRun.error ?? "unknown error"}</p>
                    <div className="row"><Act action={P.requestBrief.bind(null, t.id)} label="Try again" icon="undo" cls="btn btn-secondary btn-sm" /></div>
                  </div>
                ) : (
                  <BriefCard brief={(briefRun.output ?? {}) as Brief} editable={briefRun.status === "ready"}
                    approve={P.approveBrief.bind(null, t.id, briefRun.id)} edit={P.editBrief.bind(null, t.id, briefRun.id)} redraft={P.requestBrief.bind(null, t.id)} />
                )}
              </div>
            </section>
          )}

          {stage === "plan" && (
            <section className="panel">
              <div className="panel-head">
                <h2>Plan</h2>
                <span className="c-3 t-12 more">read-only agent · Read, Grep, Glob only</span>
              </div>
              <div className="pane">
                {!planRun || planRun.status === "superseded" ? (
                  <div className="stack" style={{ gap: 10 }}>
                    <p className="c-2">The read-only agent reads the project folder and proposes files, steps and tests from the approved brief.</p>
                    <div className="row"><Act action={P.requestPlan.bind(null, t.id)} label="Run read-only plan" icon="search" cls="btn btn-primary btn-sm" /></div>
                  </div>
                ) : planRun.status === "queued" ? (
                  <p className="c-2"><span className="spinner" /> Planning on the Mac (read-only, up to 10 min).</p>
                ) : planRun.status === "failed" ? (
                  <div className="stack" style={{ gap: 10 }}>
                    <p className="c-bad"><Icon name="alert" className="i-sm" /> The plan failed: {planRun.error ?? "unknown error"}</p>
                    <div className="row"><Act action={P.requestPlan.bind(null, t.id)} label="Try again" icon="undo" cls="btn btn-secondary btn-sm" /></div>
                  </div>
                ) : (
                  <PlanCard plan={(planRun.output ?? {}) as Plan} editable={planRun.status === "ready"}
                    approve={P.approvePlan.bind(null, t.id, planRun.id)} edit={P.editPlan.bind(null, t.id, planRun.id)} redo={P.requestPlan.bind(null, t.id)} />
                )}
              </div>
            </section>
          )}

          {stage === "mode" && (
            <section className="panel">
              <div className="panel-head"><h2>Agent or Manual</h2><span className="c-3 t-12 more">{canPlan(agent) ? "plan approved" : "no plan: manual only"}</span></div>
              <div className="pane">
                <ModePicker agent={P.chooseMode.bind(null, t.id, "agent")} manual={P.chooseMode.bind(null, t.id, "manual")} agentOk={avail.ok} agentReason={avail.reason} />
              </div>
            </section>
          )}

          {stage === "execute" && (
            <section className="panel">
              <div className="panel-head"><h2>Agent run</h2><span className="c-3 t-12 more">{agent?.test_command ? <>may run only <span className="mono">{agent.test_command}</span></> : "no test command set"}</span></div>
              <div className="pane">
                {execRun?.status === "queued" ? (
                  <p className="c-2"><span className="spinner" /> The agent is working in <span className="mono">~/EpsilonWork/worktrees/…/EL-{t.number}</span> on <span className="mono">ticket/EL-{t.number}</span> (up to 30 min).</p>
                ) : (
                  <>
                    {execRun?.status === "failed" && <p className="c-bad" style={{ marginBottom: 10 }}><Icon name="alert" className="i-sm" /> The last run failed: {execRun.error ?? "unknown error"}</p>}
                    {execRun?.status === "discarded" && <p className="c-3" style={{ marginBottom: 10 }}>The last run was discarded. A new run starts from the default branch.</p>}
                    <StartRun start={P.requestExecute.bind(null, t.id)} />
                    <div className="row" style={{ marginTop: 10 }}><Act action={P.chooseMode.bind(null, t.id, "manual")} label="Switch to Manual" icon="pencil" cls="btn btn-ghost btn-sm" /></div>
                  </>
                )}
              </div>
            </section>
          )}

          {stage === "review" && execRun && (
            <>
              <div className="glass where">
                <div><div className="k">Worktree</div><div className="v" title={execRun.worktree ?? ""}>{(execRun.worktree ?? "").replace(/^\/Users\/[^/]+/, "~")}</div></div>
                <div><div className="k">Branch</div><div className="v"><span className="c-accent">{execRun.branch}</span> · from {agent?.default_branch ?? "default"} @ {execRun.base_sha?.slice(0, 7)}</div></div>
                <div><div className="k">Repo path</div><div className="v" title={agent?.repo_path ?? ""}>{agent?.repo_path ?? "—"}</div></div>
                <div><div className="k">Test command</div><div className="v">{agent?.test_command ?? "none"} <span className="c-3">· set by you</span></div></div>
              </div>
              <DiffViewer diff={execRun.diff ?? ""} truncated={Boolean(execRun.diff_stat?.truncated)} />
              <TestLog result={execRun.test_result} />
              <ReviewActions
                branch={execRun.branch ?? `ticket/EL-${t.number}`}
                merge={P.markMerged.bind(null, t.id, execRun.id)}
                push={P.pushPreview.bind(null, t.id, execRun.id)}
                discard={P.discardRun.bind(null, t.id, execRun.id)}
                sendBack={P.sendBack.bind(null, t.id, execRun.id)}
                attach={P.attachPreview.bind(null, t.id, execRun.id)}
                pushed={Boolean(execRun.pushed_at)}
                pushError={execRun.push_error}
                previewUrl={execRun.preview_url}
                pushRequested={Boolean(execRun.preview_requested_at)}
                clientName={clientFirst}
              />
              {execRun.output && (
                <section className="panel">
                  <div className="panel-head"><h2>Agent report</h2><span className="c-3 t-12 more">{fmtTokens(Number(execRun.tokens ?? 0))} tokens{execRun.usage?.cost_usd ? ` · $${Number(execRun.usage.cost_usd).toFixed(2)}` : ""}</span></div>
                  <div className="pane brief-view">
                    <p>{String(execRun.output.summary ?? "")}</p>
                    {Boolean(execRun.output.stopped_early) && <p className="c-warn"><Icon name="alert" className="i-sm" /> Stopped early: {String(execRun.output.stop_reason ?? execRun.error ?? "")}</p>}
                    {Array.isArray(execRun.output.questions_for_client) && execRun.output.questions_for_client.length > 0 && (
                      <><h4>Questions for the client</h4><ul className="plan-list">{(execRun.output.questions_for_client as string[]).map((q, i) => <li key={i}>{q}</li>)}</ul></>
                    )}
                    {execRun.output.notes ? <><h4>Notes</h4><p className="c-2">{String(execRun.output.notes)}</p></> : null}
                  </div>
                </section>
              )}
            </>
          )}

          {stage === "manual" && (
            <section className="panel">
              <div className="panel-head"><h2>Manual work</h2><span className="c-3 t-12 more">commits with {t.ref} in the message</span></div>
              <div className="pane stack" style={{ gap: 10 }}>
                {events.filter((e) => e.kind === "commit").length ? (
                  <div className="list-rows">
                    {events.filter((e) => e.kind === "commit").map((e) => (
                      <div key={e.id} className="t-12"><Icon name="branch" className="i-sm c-3" /><span className="mono">{e.data?.sha}</span><span className="grow truncate">{e.body}</span><span className="c-3">{stamp(e.created_at)}</span></div>
                    ))}
                  </div>
                ) : (
                  <p className="c-2">No commits yet. Put <span className="mono">{t.ref}</span> in your commit messages; the Mac scans the project folder every 10 minutes.</p>
                )}
                <div className="row wrap" style={{ gap: 8 }}>
                  <Act action={P.scanCommitsNow.bind(null, t.id, t.project_id)} label="Scan now" icon="search" cls="btn btn-secondary btn-sm" />
                  {avail.ok && <Act action={P.chooseMode.bind(null, t.id, "agent")} label="Switch to Agent" icon="cpu" cls="btn btn-ghost btn-sm" />}
                </div>
                <p className="hint">Mark it done with the status control when you have shipped it.</p>
              </div>
            </section>
          )}

          {(okBrief || okPlan) && stage !== "brief" && stage !== "plan" && (
            <section className="panel">
              <div className="panel-head"><h2>Approved brief{okPlan ? " and plan" : ""}</h2></div>
              <div className="pane stack" style={{ gap: 10 }}>
                {okBrief && (
                  <details>
                    <summary className="w-600">Brief · approved {okBrief.approved_at ? stamp(okBrief.approved_at) : ""}{okBrief.edited_at ? " · edited" : ""}</summary>
                    <div style={{ marginTop: 10 }}><BriefCard brief={(okBrief.output ?? {}) as Brief} editable={false} /></div>
                  </details>
                )}
                {okPlan && (
                  <details>
                    <summary className="w-600">Plan · approved {okPlan.approved_at ? stamp(okPlan.approved_at) : ""}{okPlan.edited_at ? " · edited" : ""}</summary>
                    <div style={{ marginTop: 10 }}><PlanCard plan={(okPlan.output ?? {}) as Plan} editable={false} touched={stage === "review" ? touched : undefined} /></div>
                  </details>
                )}
              </div>
            </section>
          )}

          <section className="panel">
            <div className="panel-head">
              <h2>Status</h2>
              <span className="c-3 t-12 more">client sees: {clientStatus(t.status).label}</span>
            </div>
            <div className="pane">
              <StatusControl id={t.id} status={t.status} />
              <p className="hint" style={{ marginTop: 10 }}>
                Every change is shown to {org} and notifies its people. &quot;With client&quot; asks them for input and is flagged urgent.
              </p>
            </div>
          </section>
          <TimePanel ticketId={t.id} entries={(te ?? []) as TimeEntry[]} hasRetainer={Boolean(ret?.length)} />
          <section className="panel">
            <div className="panel-head">
              <h2>Client request</h2>
              <Link className="btn btn-ghost btn-sm more" href={`/clients/${t.org_id}`}>
                {org}
              </Link>
            </div>
            <div className="pane">
              <div className="untrusted">
                <div className="untrusted-tag">
                  <Icon name="alert" className="i-sm" />
                  Untrusted client text · never reaches a session with tools
                </div>
                <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{t.body.trim() || "(no description)"}</div>
              </div>
              {files.length > 0 && (
                <div className="list-rows" style={{ marginTop: 12 }}>
                  {files.map((f) => (
                    <a key={f.id} href={`/files/${f.id}`} download>
                      <Icon name="clip" className="i-sm c-3" />
                      <span className="grow truncate">{f.name}</span>
                      <span className="c-3 t-12">
                        {prettySize(Number(f.size))} · {dayMonth(f.created_at)}
                      </span>
                      <Icon name="download" className="i-sm c-3" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="col">
          <section className="panel">
            <TimelineFilter>
              <ol className="tl" style={{ padding: "8px 22px 22px" }}>
                {items.map((it) => (
                  <li key={it.key} data-kind={it.kind} data-vis={it.vis}>
                    <span className="tl-dot" />
                    <div className="tl-title">{it.title}</div>
                    {it.body !== undefined &&
                      (it.untrusted ? (
                        <div className="untrusted" style={{ marginTop: 8 }}>
                          <div className="untrusted-tag">
                            <Icon name="alert" className="i-sm" />
                            untrusted
                          </div>
                          <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{it.body}</div>
                        </div>
                      ) : (
                        <div className="comment" style={{ marginTop: 8 }}>
                          {it.body}
                        </div>
                      ))}
                    <div className="tl-meta">
                      <span className={`tl-pill ${it.vis}`}>{it.pill}</span>
                      {stamp(it.at)}
                      {unanswered === it.key && <span className="c-warn">unanswered</span>}
                    </div>
                    {it.publish && <SendNoteButton ticketId={t.id} eventId={it.publish} />}
                  </li>
                ))}
              </ol>
            </TimelineFilter>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Reply to {clientFirst}</h2>
              <span className="c-3 t-12 more">Sent as Epsilon Labs</span>
            </div>
            <ReplyComposer id={t.id} clientName={clientFirst} />
          </section>
        </aside>
      </div>
    </>
  );
}
