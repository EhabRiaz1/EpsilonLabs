import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import { PageHeader } from "@/app/components/PageHeader";
import { Tabs, type TabItem } from "@/app/components/Tabs";
import { Note } from "@/app/components/Note";
import { getSession } from "@/lib/session";
import { one } from "@/lib/one";
import { peopleById } from "@/lib/portal";
import { clientStatus, PRIORITY_LABEL, staffStatus, TYPE_LABEL } from "@/lib/tickets";
import { dayMonth, stamp } from "@/lib/dates";
import { prettySize } from "@/lib/files";
import type { Usage } from "@/lib/retainers";
import { DraftReply, ReplyComposer, SendNoteButton, StatusControl, TimelineFilter } from "../TicketControls";
import { TimePanel, type TimeEntry } from "../TimePanel";
import { agentAvailability, approvedRun, canPlan, fmtTokens, latestRun, pipelineStage, pipelineSteps, type ProjectAgent, type Stage } from "@/lib/pipeline";
import { BriefCard, DiffViewer, MergedBar, ModePicker, PlanCard, ReviewActions, StartRun, Stepper, TestLog, Act, type Brief, type Plan, type TestResult } from "../Pipeline";
import { TicketCommands } from "./TicketCommands";
import * as P from "../pipeline-actions";
import { shareTicket } from "../actions";

export const metadata: Metadata = { title: "Ticket" };

type Ticket = {
  id: string; ref: string; org_id: string; project_id: string; number: number; mode: string | null; title: string; body: string; type: string; priority: string; status: string; author_id: string | null;
  created_at: string; updated_at: string; organizations: { name: string } | { name: string }[] | null; projects: { name: string } | { name: string }[] | null;
  /** 017; undefined before the migration (treated as visible) */
  client_visible?: boolean;
};
type Event = { id: string; kind: string; body: string | null; data: { from?: string; to?: string; sha?: string; draft?: boolean; source?: string } | null; client_visible: boolean; actor: string | null; created_at: string };
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

/** The current ask of the pipeline (design review D8): the accent pill and the header's primary button. */
type Ask = { pill: string; tone?: "accent" | "good" | "warn" | "bad"; button?: ReactNode };

export default async function AdminTicket({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await getSession();
  const { data } = await supabase
    .from("tickets")
    // `*`: includes client_visible (017) once the migration is applied, without breaking the page before it
    .select("*, organizations(name), projects(name)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const t = data as Ticket;
  const [{ data: ev }, { data: fl }, { data: te }, { data: ret }, { data: rn }, { data: ag }, usageRes] = await Promise.all([
    supabase.from("ticket_events").select("id, kind, body, data, client_visible, actor, created_at").eq("ticket_id", id).order("created_at"),
    supabase.from("files").select("id, name, size, created_at, uploaded_by").eq("ticket_id", id).eq("status", "ready").order("created_at"),
    supabase.from("time_entries").select("id, minutes, note, billable, worked_on").eq("ticket_id", id).order("worked_on", { ascending: false }).limit(100),
    supabase.from("retainers").select("id").eq("org_id", t.org_id).eq("status", "active").limit(1),
    // 015: staff-only RLS; the client portal never reads ticket_runs
    supabase.from("ticket_runs").select(RUN_COLS).eq("ticket_id", id).order("created_at"),
    supabase.rpc("staff_project_agent", { p_org_id: t.org_id }),
    // retainer gauge in the Time panel (design review D8)
    supabase.rpc("retainer_usage", { p_org_id: t.org_id, p_months: 1, p_today: null }),
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
  const usage = (usageRes.error ? null : usageRes.data) as Usage | null;
  const people = await peopleById(supabase, [t.author_id, ...events.map((e) => e.actor), ...files.map((f) => f.uploaded_by)]);
  const name = (uid: string | null) => (uid ? (people.get(uid)?.staff ? "You" : (people.get(uid)?.name ?? "Someone")) : "System");
  const author = people.get(t.author_id ?? "")?.name ?? "the client";
  const clientFirst = author.split(/\s+/)[0] || "the client";
  const org = one(t.organizations)?.name ?? "";
  const project = one(t.projects)?.name ?? "";
  const s = staffStatus(t.status);
  const internal = t.client_visible === false;

  type Item = { key: string; at: string; vis: "client" | "internal"; kind: string; title: string; pill: string; body?: string; untrusted?: boolean; publish?: string; draft?: string };
  const items: Item[] = [
    { key: "open", at: t.created_at, vis: "client" as const, kind: "client", title: `${author} opened the ticket`, pill: "client" },
    ...events.map((e): Item => {
      const staffActor = Boolean(e.actor && people.get(e.actor)?.staff);
      if (e.kind === "status")
        return { key: e.id, at: e.created_at, vis: "client", kind: e.data?.to === "done" ? "done" : "client", title: `Status → ${staffStatus(e.data?.to ?? "").label} (client sees "${clientStatus(e.data?.to ?? "").label}")`, pill: "client · auto" };
      // 017: Claude Code (Epsilon MCP) writes as the token's creator; data.source tells it apart
      if (e.kind === "comment" && e.data?.source === "claude_code" && !e.client_visible)
        return e.data.draft
          ? { key: e.id, at: e.created_at, vis: "internal", kind: "internal", title: "Claude Code drafted a reply", pill: "draft · Claude Code", body: e.body ?? "", draft: e.id }
          : { key: e.id, at: e.created_at, vis: "internal", kind: "internal", title: "Claude Code note", pill: "internal · Claude Code", body: e.body ?? "" };
      if (e.kind === "comment")
        return {
          key: e.id,
          at: e.created_at,
          vis: e.client_visible ? "client" : "internal",
          kind: e.client_visible ? "client" : "internal",
          title: staffActor ? (e.client_visible ? (e.data?.source === "claude_code" ? "You replied (from Claude Code)" : "You replied") : "Internal note") : `${name(e.actor)} commented`,
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
    const lastReply = [...items].reverse().find((i) => i.title.startsWith("You replied"));
    return lastClient && (!lastReply || lastReply.at < lastClient.at) ? lastClient.key : null;
  })();

  // D8: the current ask, as a pill and the header's primary button
  const jump = (href: string, label: string, icon: Parameters<typeof Icon>[0]["name"] = "arrowR") => (
    <a className="btn btn-primary" href={href}>
      <Icon name={icon} className="i-sm" />
      {label}
    </a>
  );
  const askFor = (st: Stage): Ask => {
    if (st === "brief") {
      if (!briefRun || briefRun.status === "superseded") return { pill: "No brief yet", button: <Act action={P.requestBrief.bind(null, t.id)} label="Draft brief" icon="sparkle" cls="btn btn-primary" /> };
      if (briefRun.status === "queued") return { pill: "Drafting the brief on the Mac" };
      if (briefRun.status === "failed") return { pill: "The brief failed", tone: "bad", button: <Act action={P.requestBrief.bind(null, t.id)} label="Try again" icon="undo" cls="btn btn-primary" /> };
      return { pill: "Brief waiting for you", button: jump("#work", "Review brief", "eye") };
    }
    if (st === "plan") {
      if (!planRun || planRun.status === "superseded") return { pill: "Brief approved · plan next", button: <Act action={P.requestPlan.bind(null, t.id)} label="Run read-only plan" icon="search" cls="btn btn-primary" /> };
      if (planRun.status === "queued") return { pill: "Planning on the Mac" };
      if (planRun.status === "failed") return { pill: "The plan failed", tone: "bad", button: <Act action={P.requestPlan.bind(null, t.id)} label="Try again" icon="undo" cls="btn btn-primary" /> };
      return { pill: "Plan waiting for you", button: jump("#work", "Review plan", "eye") };
    }
    if (st === "mode") return { pill: "Agent or Manual?", button: jump("#work", "Choose", "cpu") };
    if (st === "execute") return execRun?.status === "queued" ? { pill: "Agent working" } : { pill: "Ready for the agent", button: jump("#work", "Start agent run", "play") };
    if (st === "review") return { pill: "Diff waiting for your review", button: jump("#action-card", "Review diff", "branch") };
    if (st === "manual") return { pill: "Manual · commits tracked", button: jump("#status", "Set status", "check") };
    if (st === "done") return { pill: "Done", tone: "good" };
    return { pill: "Declined", tone: "warn" };
  };
  const ask = askFor(stage);
  const replyAsk = unanswered && (stage === "done" || stage === "closed" || !ask.button) ? jump("#reply", `Reply to ${clientFirst}`, "send") : null;

  // the built record: client request, then the approved brief and plan (tabbed, design review D8)
  const requestPane = (
    <div className="pane">
      <div className="who">
        <span className="avatar">{author.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>
        <div>
          <strong className="w-600">{author}</strong> · {org}
          <div className="c-3 t-12 mono">{stamp(t.created_at)}</div>
        </div>
      </div>
      <div className="untrusted">
        <div className="untrusted-tag">
          <Icon name="alert" className="i-sm" />
          Untrusted client text · never reaches a session with tools
        </div>
        <div className="pre">{t.body.trim() || "(no description)"}</div>
      </div>
      {files.length > 0 && (
        <div className="list-rows attach-list">
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
  );
  const built: TabItem[] = [{ key: "request", label: "Client request", content: requestPane }];
  if (okBrief && stage !== "brief")
    built.push({
      key: "brief",
      label: "Brief",
      content: (
        <div className="pane">
          <div className="row built-meta">
            <span className="pill pill-good"><span className="dot" />Approved</span>
            <span className="c-3 t-12 mono">tool-less · {okBrief.approved_at ? stamp(okBrief.approved_at) : ""}{okBrief.edited_at ? " · edited" : ""}</span>
          </div>
          <BriefCard brief={(okBrief.output ?? {}) as Brief} editable={false} />
        </div>
      ),
    });
  if (okPlan && stage !== "plan")
    built.push({
      key: "plan",
      label: "Plan",
      content: (
        <div className="pane">
          <div className="row built-meta">
            <span className="pill pill-good"><span className="dot" />Approved</span>
            <span className="c-3 t-12 mono">read-only · {okPlan.approved_at ? stamp(okPlan.approved_at) : ""}{okPlan.edited_at ? " · edited" : ""}</span>
          </div>
          <PlanCard plan={(okPlan.output ?? {}) as Plan} editable={false} touched={stage === "review" ? touched : undefined} />
        </div>
      ),
    });

  return (
    <>
      <TicketCommands orgId={t.org_id} />
      <PageHeader
        crumbs={[{ label: "Clients", href: "/clients" }, { label: org || "Client", href: `/clients/${t.org_id}` }, { label: t.ref }]}
        eyebrow={
          <>
            <span className="pill pill-white pill-mono">{t.ref}</span>
            <span>{[project, org].filter(Boolean).join(" · ")}</span>
          </>
        }
        title={t.title}
        pills={
          <>
            <span className={`pill ${s.tone}`}>
              <span className="dot" />
              {s.label}
            </span>
            <span className="pill pill-white">{TYPE_LABEL[t.type] ?? t.type}</span>
            <span className={`pill ${t.priority === "urgent" ? "pill-bad" : "pill-white"}`}>{PRIORITY_LABEL[t.priority] ?? t.priority}</span>
            {t.mode && (
              <span className="pill pill-white">
                <Icon name={t.mode === "agent" ? "cpu" : "pencil"} className="i-sm" />
                {t.mode === "agent" ? "Agent mode" : "Manual mode"}
              </span>
            )}
            {unanswered && <span className="pill pill-warn"><span className="dot" />{clientFirst} is waiting for a reply</span>}
            {internal && (
              <span className="pill pill-white">
                <Icon name="lock" className="i-sm" />
                Internal · the client can&apos;t see this ticket
              </span>
            )}
          </>
        }
        sub={`opened ${dayMonth(t.created_at)} by ${author} · updated ${stamp(t.updated_at)}`}
        refresh={working ? 20 : undefined}
        actions={
          <div className="ask">
            <span className={`pill ask-pill pill-${ask.tone ?? "accent"}`}>
              <span className={`dot${ask.button || ask.tone ? "" : " live"}`} />
              {ask.pill}
            </span>
            {ask.button}
            {replyAsk}
          </div>
        }
      />

      <section className="panel pipe">
        <div className="row between pipe-head">
          <span className="c-3 t-12">{t.mode === "agent" ? "Agent mode" : t.mode === "manual" ? "Manual mode" : "Project agent"} · the client sees status labels only</span>
        </div>
        <Stepper steps={steps} />
      </section>

      <div className="t-grid">
        <div className="col">
          <div id="work" className="col">
            {stage === "brief" && (
              <section className="panel">
                <div className="panel-head">
                  <h2>Brief</h2>
                  <span className="c-3 t-12 more">AI, tool-less · from the client&apos;s words</span>
                </div>
                <div className="pane">
                  {!briefRun || briefRun.status === "superseded" ? (
                    <p className="c-2">No brief yet. The Mac drafts one with no tools from the ticket text; you approve or edit it before anything reads the code. Use <b>Draft brief</b> above.</p>
                  ) : briefRun.status === "queued" ? (
                    <p className="c-2"><span className="spinner" /> Drafting on the Mac (tool-less). This page refreshes on its own.</p>
                  ) : briefRun.status === "failed" ? (
                    <Note tone="error">AI couldn&apos;t draft it: {briefRun.error ?? "unknown error"}. Use <b>Try again</b> above.</Note>
                  ) : (
                    <div className="brief">
                      <div className="tag"><Icon name="sparkle" className="i-sm" />AI brief · you approve the wording</div>
                      <BriefCard brief={(briefRun.output ?? {}) as Brief} editable={briefRun.status === "ready"}
                        approve={P.approveBrief.bind(null, t.id, briefRun.id)} edit={P.editBrief.bind(null, t.id, briefRun.id)} redraft={P.requestBrief.bind(null, t.id)} />
                    </div>
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
                    <p className="c-2">The read-only agent reads the project folder and proposes files, steps and tests from the approved brief. Use <b>Run read-only plan</b> above.</p>
                  ) : planRun.status === "queued" ? (
                    <p className="c-2"><span className="spinner" /> Planning on the Mac (read-only, up to 10 min).</p>
                  ) : planRun.status === "failed" ? (
                    <Note tone="error">The plan failed: {planRun.error ?? "unknown error"}. Use <b>Try again</b> above.</Note>
                  ) : (
                    <div className="brief">
                      <div className="tag"><Icon name="cpu" className="i-sm" />Read-only plan · you approve the files and steps</div>
                      <PlanCard plan={(planRun.output ?? {}) as Plan} editable={planRun.status === "ready"}
                        approve={P.approvePlan.bind(null, t.id, planRun.id)} edit={P.editPlan.bind(null, t.id, planRun.id)} redo={P.requestPlan.bind(null, t.id)} />
                    </div>
                  )}
                </div>
              </section>
            )}

            {stage === "mode" && (
              <section className="panel">
                <div className="panel-head"><h2>How should this get built?</h2><span className="c-3 t-12 more">{canPlan(agent) ? "plan approved" : "no plan: manual only"}</span></div>
                <div className="pane">
                  <ModePicker agent={P.chooseMode.bind(null, t.id, "agent")} manual={P.chooseMode.bind(null, t.id, "manual")} agentOk={avail.ok} agentReason={avail.reason} ticketRef={t.ref} />
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
                      {execRun?.status === "failed" && <Note tone="error">The last run failed: {execRun.error ?? "unknown error"}</Note>}
                      {execRun?.status === "discarded" && <p className="c-3">The last run was discarded. A new run starts from the default branch.</p>}
                      <StartRun start={P.requestExecute.bind(null, t.id)} />
                      <div className="row switch-mode"><Act action={P.chooseMode.bind(null, t.id, "manual")} label="Switch to Manual" icon="pencil" cls="btn btn-ghost btn-sm" /></div>
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
                      {Boolean(execRun.output.stopped_early) && <Note tone="warn">Stopped early: {String(execRun.output.stop_reason ?? execRun.error ?? "")}</Note>}
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
                <div className="pane stack manual-pane">
                  {events.filter((e) => e.kind === "commit").length ? (
                    <div className="list-rows">
                      {events.filter((e) => e.kind === "commit").map((e) => (
                        <div key={e.id} className="t-12"><Icon name="branch" className="i-sm c-3" /><span className="mono">{e.data?.sha}</span><span className="grow truncate">{e.body}</span><span className="c-3">{stamp(e.created_at)}</span></div>
                      ))}
                    </div>
                  ) : (
                    <p className="c-2">No commits yet. Put <span className="mono">{t.ref}</span> in your commit messages; the Mac scans the project folder every 10 minutes.</p>
                  )}
                  <div className="row wrap manual-acts">
                    <Act action={P.scanCommitsNow.bind(null, t.id, t.project_id)} label="Scan now" icon="search" cls="btn btn-secondary btn-sm" />
                    {avail.ok && <Act action={P.chooseMode.bind(null, t.id, "agent")} label="Switch to Agent" icon="cpu" cls="btn btn-ghost btn-sm" />}
                  </div>
                  <p className="hint">Mark it done with the status control when you have shipped it.</p>
                </div>
              </section>
            )}

            {stage === "done" && (
              <MergedBar
                merged={execRun?.status === "merged"}
                branch={execRun?.branch ?? `ticket/EL-${t.number}`}
                base={agent?.default_branch ?? "main"}
                sha={execRun?.head_sha ?? null}
                clientName={clientFirst}
              />
            )}
          </div>

          <section className="panel built">
            {built.length > 1 ? (
              <div className="built-tabs">
                <Tabs label="Ticket record" items={built} />
              </div>
            ) : (
              <>
                <div className="panel-head">
                  <h2>Client request</h2>
                  <Link className="more t-12 c-3" href={`/clients/${t.org_id}`}>{org} →</Link>
                </div>
                {requestPane}
              </>
            )}
          </section>

          <section className="panel" id="status">
            <div className="panel-head">
              <h2>Status</h2>
              <span className="c-3 t-12 more">client sees: {clientStatus(t.status).label}</span>
            </div>
            <div className="pane">
              <StatusControl id={t.id} status={t.status} />
              {internal ? (
                <div className="stack g-8 status-hint">
                  <p className="hint m-0">Internal ticket (opened from Claude Code): status changes stay internal and notify nobody until you share it.</p>
                  <span>
                    <Act action={shareTicket.bind(null, t.id)} label="Share with client" icon="eye" cls="btn btn-secondary btn-sm"
                      confirmTitle={`Show ${t.ref} to ${org}?`} confirmText="They see the ticket, its status and anything you send from now on. Internal notes stay internal." />
                  </span>
                </div>
              ) : (
                <p className="hint status-hint">
                  Every change is shown to {org} and notifies its people. &quot;With client&quot; asks them for input and is flagged urgent.
                </p>
              )}
            </div>
          </section>
          <TimePanel ticketId={t.id} entries={(te ?? []) as TimeEntry[]} hasRetainer={Boolean(ret?.length)} usage={usage} />
        </div>

        <aside className="col rail" aria-label="Reply and timeline">
          <section className="panel rail-reply" id="reply">
            <div className="panel-head">
              <h2>Reply to {clientFirst}</h2>
              <span className="c-3 t-12 more">Sent as Epsilon Labs</span>
            </div>
            <ReplyComposer id={t.id} clientName={clientFirst} />
          </section>
          <section className="panel rail-tl">
            <TimelineFilter count={items.length}>
              <ol className="tl">
                {items.map((it) => (
                  <li key={it.key} data-kind={it.kind} data-vis={it.vis}>
                    <span className="tl-dot" />
                    <div className="tl-title">{it.title}</div>
                    {it.body !== undefined &&
                      (it.untrusted ? (
                        <div className="untrusted tl-body-x">
                          <div className="untrusted-tag">
                            <Icon name="alert" className="i-sm" />
                            untrusted
                          </div>
                          <div className="pre">{it.body}</div>
                        </div>
                      ) : (
                        <div className="comment tl-body-x">{it.body}</div>
                      ))}
                    <div className="tl-meta">
                      <span className={`tl-pill ${it.vis}`}>{it.pill}</span>
                      {stamp(it.at)}
                      {unanswered === it.key && <span className="c-warn">unanswered</span>}
                    </div>
                    {it.publish && !internal && <SendNoteButton ticketId={t.id} eventId={it.publish} />}
                    {it.draft && <DraftReply ticketId={t.id} eventId={it.draft} body={it.body ?? ""} clientName={clientFirst} internal={internal} />}
                  </li>
                ))}
              </ol>
            </TimelineFilter>
          </section>
        </aside>
      </div>
    </>
  );
}
