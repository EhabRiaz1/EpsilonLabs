import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/app/components/Icon";
import { PageHeader } from "@/app/components/PageHeader";
import { Money } from "@/app/components/Money";
import { Note } from "@/app/components/Note";
import { Empty } from "@/app/components/Empty";
import { Sheet } from "@/app/components/Sheet";
import { SheetButton } from "@/app/components/SheetButton";
import { StatusPill } from "@/app/components/StatusPill";
import { initials } from "@/app/components/Shell";
import { getSession } from "@/lib/session";
import { dayMonth, dayMonthYear } from "@/lib/dates";
import { isOpen, staffStatus, TYPE_LABEL } from "@/lib/tickets";
import { hm, tierLabel, usageLine, type Usage } from "@/lib/retainers";
import { formatMoney } from "@/lib/money";
import { InviteForm, ProjectForm, RowAction } from "../ClientForms";
import { RetainerPanel } from "../RetainerPanel";
import { ProjectAgentForm } from "../ProjectAgentForm";
import { ConnectClaude, type ProjectToken } from "../ConnectClaude";
import { Activity, type ActItem } from "./Activity";

export const metadata: Metadata = { title: "Client" };

type Team = {
  members: { user_id: string; email: string; name: string; role: string; joined_at: string }[];
  invites: { id: string; email: string; role: string; created_at: string; expires_at: string; state: string }[];
};
type Project = { id: string; name: string; status: string; summary: string | null; repo_path: string | null; progress: number | null; next_milestone: string | null; next_milestone_on: string | null };
type AgentRow = { id: string; test_command: string | null; test_env_file: string | null; default_branch: string | null; is_git: boolean | null; git_checked_at: string | null; agent_enabled: boolean };
type Ticket = { id: string; ref: string; title: string; type: string; status: string; created_at: string; updated_at: string };
type Report = { id: string; title: string; period_label: string; status: string; created_at: string; published_at: string | null };
type Update = { id: string; title: string; status: string; source: string; week_of: string | null; created_at: string; published_at: string | null };
type Invoice = {
  id: string; number: string | null; kind: string; project_label: string; total: number | string; currency: string; status: string;
  due_date: string | null; issued_at: string | null; paid_at: string | null; created_at: string;
};

const PROJECT_TONE: Record<string, [string, string]> = { active: ["Active", "pill-good"], paused: ["Paused", "pill-warn"], done: ["Delivered", "pill-accent"], archived: ["Archived", ""] };
const REPORT_TONE: Record<string, string> = { draft: "", approved: "pill-warn", published: "pill-good", void: "" };
const UPDATE_TONE: Record<string, string> = { draft: "pill-accent", published: "pill-good", skipped: "" };
const RING_C = 100.53; // 2π·16, the system .ring
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const nextMonthFirst = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return "";
  return dayMonth(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01T12:00:00+05:00`);
};

export default async function ClientDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await getSession();
  const { data: org } = await supabase.from("organizations").select("id, name, slug, domain, status, is_test, created_at, companies(name)").eq("id", id).maybeSingle();
  if (!org) notFound();
  const [team, projects, paths, tickets, usage, agentRows, reports, updates, invoices, tokenRows] = await Promise.all([
    supabase.rpc("org_team", { p_org_id: id }),
    // repo_path is not granted to `authenticated` (clients must never see it); staff read it via staff_project_paths()
    supabase.from("projects").select("id, name, status, summary, progress, next_milestone, next_milestone_on").eq("org_id", id).order("created_at"),
    supabase.rpc("staff_project_paths", { p_org_id: id }),
    supabase.from("tickets").select("id, ref, title, type, status, created_at, updated_at").eq("org_id", id).order("updated_at", { ascending: false }).limit(200),
    supabase.rpc("retainer_usage", { p_org_id: id, p_months: 6, p_today: null }),
    // 015: test command / env file / branch / agent switch are staff-only columns, read through this function
    supabase.rpc("staff_project_agent", { p_org_id: id }),
    supabase.from("reports").select("id, title, period_label, status, created_at, published_at").eq("org_id", id).order("created_at", { ascending: false }).limit(30),
    supabase.from("updates").select("id, title, status, source, week_of, created_at, published_at").eq("org_id", id).order("created_at", { ascending: false }).limit(30),
    supabase.from("invoices").select("id, number, kind, project_label, total, currency, status, due_date, issued_at, paid_at, created_at").eq("org_id", id).order("created_at", { ascending: false }).limit(60),
    // 017: Claude Code project tokens (never the hash)
    supabase.rpc("staff_project_tokens", { p_org_id: id }),
  ]);
  const tokensOf = (pid: string) => ((tokenRows.data ?? []) as ProjectToken[]).filter((k) => k.project_id === pid);
  const agentOf = new Map(((agentRows.data ?? []) as AgentRow[]).map((r) => [r.id, r]));
  const t = (team.data ?? { members: [], invites: [] }) as Team;
  const pathOf = new Map(((paths.data ?? []) as { id: string; repo_path: string | null }[]).map((r) => [r.id, r.repo_path]));
  const ps = ((projects.data ?? []) as Omit<Project, "repo_path">[]).map((p) => ({ ...p, repo_path: pathOf.get(p.id) ?? null })) as Project[];
  const ts = (tickets.data ?? []) as Ticket[];
  const openTickets = ts.filter((x) => isOpen(x.status));
  const withClient = openTickets.filter((x) => x.status === "review");
  const owners = t.members.filter((m) => m.role === "owner").length;
  const company = Array.isArray(org.companies) ? org.companies[0] : org.companies;
  const u = (usage.data ?? null) as Usage | null;
  const ret = u?.retainer && u.retainer.status === "active" ? u.retainer : null;
  const cur = u?.periods.find((p) => p.current) ?? null;
  const pct = cur ? usageLine(cur).pct : 0;
  const invs = (invoices.data ?? []) as Invoice[];
  const due = invs.filter((i) => i.kind === "invoice" && (i.status === "sent" || i.status === "overdue"));
  const dueCur = due[0]?.currency ?? "USD";
  const dueSum = due.filter((i) => i.currency === dueCur).reduce((s, i) => s + Number(i.total), 0);
  const otherCur = due.some((i) => i.currency !== dueCur);
  const pendingInv = t.invites.filter((i) => i.state === "pending");
  const people = [...t.members.map((m) => m.name || m.email), ...pendingInv.map((i) => i.email)];

  // Activity (D15): one timeline of tickets, reports, updates and invoices, newest first
  const items: ActItem[] = [
    ...ts.slice(0, 30).map((x): ActItem => {
      const chip = staffStatus(x.status);
      return {
        key: `t-${x.id}`, kind: "ticket", at: x.updated_at, date: dayMonth(x.updated_at), id: x.ref, title: x.title, href: `/tickets/${x.id}`,
        meta: `${(TYPE_LABEL[x.type] ?? x.type).toLowerCase()} · opened ${dayMonth(x.created_at)}`,
        pill: { label: chip.label, tone: chip.tone, live: x.status === "in_progress" },
      };
    }),
    ...((reports.data ?? []) as Report[]).map((r): ActItem => {
      const at = r.published_at ?? r.created_at;
      return {
        key: `r-${r.id}`, kind: "report", at, date: dayMonth(at), title: r.title, href: `/reports/${r.id}`,
        meta: [r.period_label, r.published_at ? `published ${dayMonth(r.published_at)}` : `drafted ${dayMonth(r.created_at)}`].filter(Boolean).join(" · "),
        pill: { label: cap(r.status), tone: REPORT_TONE[r.status] ?? "" },
      };
    }),
    ...((updates.data ?? []) as Update[]).map((x): ActItem => {
      const at = x.published_at ?? x.created_at;
      return {
        key: `u-${x.id}`, kind: "update", at, date: dayMonth(at), title: x.title, href: "/updates",
        meta: x.source === "weekly" ? `weekly${x.week_of ? ` · week of ${dayMonth(x.week_of)}` : ""}` : "written by you",
        pill: { label: cap(x.status), tone: UPDATE_TONE[x.status] ?? "" },
      };
    }),
    ...invs.slice(0, 30).map((i): ActItem => {
      const at = i.paid_at ?? i.issued_at ?? i.created_at;
      return {
        key: `i-${i.id}`, kind: "invoice", at, date: dayMonth(at), id: i.number ?? "Draft", title: i.kind === "credit_note" ? `Credit note${i.project_label ? ` · ${i.project_label}` : ""}` : i.project_label || "Invoice",
        href: `/invoices/${i.id}`,
        meta: [formatMoney(i.total, i.currency), i.paid_at ? `paid ${dayMonth(i.paid_at)}` : i.due_date ? `due ${dayMonth(i.due_date)}` : null].filter(Boolean).join(" · "),
        pill: { label: cap(i.status), tone: { sent: "pill-accent", paid: "pill-good", overdue: "pill-bad", approved: "pill-accent" }[i.status] ?? "" },
      };
    }),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const activityError = [tickets, reports, updates, invoices].some((r) => r.error);

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Clients", href: "/clients" }, { label: org.name as string }]}
        title={org.name as string}
        sub={
          <>
            {org.domain ? <span>{org.domain as string}</span> : <span>{org.slug as string}</span>}
            <span aria-hidden="true">·</span>
            <span>client since {dayMonthYear(org.created_at as string)}</span>
            {company?.name && company.name !== org.name && (
              <>
                <span aria-hidden="true">·</span>
                <span>CRM: {company.name}</span>
              </>
            )}
            {people.length > 0 && (
              <span className="avatars" aria-label={`${people.length} ${people.length === 1 ? "person" : "people"}`}>
                {people.slice(0, 5).map((p, k) => (
                  <span key={k} className="avatar" aria-hidden="true">
                    {initials(p)}
                  </span>
                ))}
              </span>
            )}
            {ret && (
              <span className="pill pill-good">
                <span className="dot" />
                {tierLabel(ret.tier)}
              </span>
            )}
            {org.is_test ? (
              <span className="pill pill-warn">
                <span className="dot" />
                Test org
              </span>
            ) : null}
          </>
        }
        actions={
          <>
            <SheetButton sheet="invite-sheet">
              <Icon name="users" className="i-sm" />
              Invite
            </SheetButton>
            <Link className="btn btn-primary" href={`/tickets?org=${id}`}>
              <Icon name="ticket" className="i-sm" />
              {openTickets.length} open ticket{openTickets.length === 1 ? "" : "s"}
            </Link>
          </>
        }
      />

      <section className="stats4" aria-label="Client numbers">
        <SheetButton sheet="retainer-sheet" className="panel stat stat-btn" label="Retainer this month: open the retainer">
          {ret && cur ? (
            <span className="ring" aria-hidden="true">
              <svg viewBox="0 0 40 40">
                <circle className="track" cx="20" cy="20" r="16" />
                <circle className="bar" cx="20" cy="20" r="16" style={{ strokeDasharray: RING_C, strokeDashoffset: RING_C * (1 - Math.min(100, pct) / 100) }} />
              </svg>
              <span className="val">{Math.round(pct)}%</span>
            </span>
          ) : null}
          <span>
            <span className="k">Retainer this month</span>
            <span className="v">{usage.error ? "–" : ret && cur ? hm(cur.used_minutes) : "–"}</span>
            <span className="d">
              {usage.error
                ? "couldn't load · open to retry"
                : ret && cur
                  ? `of ${hm(cur.included_minutes)} · resets ${nextMonthFirst(cur.period)}`
                  : "no retainer · set one up"}
            </span>
          </span>
        </SheetButton>
        <div className="panel stat">
          <div>
            <div className="k">Retainer plan</div>
            <div className="v">{ret ? `${Number(ret.hours_included)} h / mo` : "–"}</div>
            <div className="d">{ret ? `${tierLabel(ret.tier)} · since ${dayMonth(ret.starts_on)}${u?.upsell ? " · upsell" : ""}` : `since ${dayMonth(org.created_at as string)} · no retainer`}</div>
          </div>
        </div>
        <Link className="panel stat stat-btn" href={`/tickets?org=${id}`}>
          <span>
            <span className="k">Open tickets</span>
            <span className="v">{tickets.error ? "–" : openTickets.length}</span>
            <span className="d">
              {tickets.error
                ? "couldn't load"
                : withClient.length
                  ? `${withClient.length} with the client · ${withClient[0].ref}`
                  : openTickets.length
                    ? `newest ${openTickets[0].ref}`
                    : `${ts.length} closed so far`}
            </span>
          </span>
        </Link>
        <div className="panel stat">
          <div>
            <div className="k">Outstanding</div>
            <div className="v">{invoices.error ? "–" : <Money value={dueSum} currency={dueCur} />}</div>
            <div className="d">
              {invoices.error
                ? "couldn't load"
                : due.length === 1
                  ? `${due[0].number ?? "Draft"}${due[0].due_date ? ` · due ${dayMonth(due[0].due_date)}` : ""}`
                  : due.length
                    ? `${due.length} invoices${due.some((i) => i.status === "overdue") ? ` · ${due.filter((i) => i.status === "overdue").length} overdue` : ""}${otherCur ? " · other currencies too" : ""}`
                    : "nothing due"}
            </div>
          </div>
        </div>
      </section>

      <section className={`projects${ps.length > 1 ? " projects-n" : ""}`} aria-label="Projects">
        {projects.error && <Note retry>Couldn&apos;t load the projects.</Note>}
        {ps.map((p) => {
          const a = agentOf.get(p.id);
          const st = PROJECT_TONE[p.status] ?? [p.status, ""];
          return (
            <article key={p.id} className="panel proj">
              <div>
                <h3>
                  {p.name}
                  <span className={`pill ${st[1]}`}>
                    <span className="dot" />
                    {st[0]}
                  </span>
                </h3>
                {p.progress !== null ? (
                  <div className="pct">
                    <strong>{p.progress}%</strong>
                    <span className="meter-t" role="img" aria-label={`${p.progress}% done`}>
                      <i style={{ width: `${Math.max(0, Math.min(100, p.progress))}%` }} />
                    </span>
                  </div>
                ) : (
                  <div className="pct">no progress set</div>
                )}
                <div className="next-m">
                  {p.next_milestone ? (
                    <>
                      next · <b>{p.next_milestone}</b>
                      {p.next_milestone_on ? ` · ${dayMonth(p.next_milestone_on)}` : ""}
                    </>
                  ) : (
                    "no milestone set"
                  )}
                </div>
              </div>
              <dl className="facts">
                <dt>Folder</dt>
                <dd title={p.repo_path ?? undefined}>{p.repo_path || "–"}</dd>
                <dt>Tests</dt>
                <dd>{a?.test_command || "–"}</dd>
                <dt>Agent</dt>
                <dd>
                  <span className={`pill ${a?.agent_enabled ? "pill-good" : ""}`}>
                    <span className="dot" />
                    {a?.agent_enabled ? "On · agent mode" : "Off · briefs only"}
                  </span>
                </dd>
              </dl>
              <div className="acts">
                <SheetButton sheet={`proj-${p.id}`} className="btn btn-ghost btn-sm">
                  <Icon name="pencil" className="i-sm" />
                  Edit
                </SheetButton>
                <SheetButton sheet={`proj-${p.id}`} className="btn btn-ghost btn-sm">
                  <Icon name="cpu" className="i-sm" />
                  {a?.agent_enabled ? "Agent settings" : "Enable agent"}
                </SheetButton>
                <SheetButton sheet={`cc-${p.id}`} className="btn btn-ghost btn-sm">
                  <Icon name="terminal" className="i-sm" />
                  Connect Claude Code
                  {tokensOf(p.id).some((k) => !k.revoked_at) ? <span className="cc-dot" aria-label="connected" /> : null}
                </SheetButton>
              </div>
            </article>
          );
        })}
        <SheetButton sheet="proj-new" className="add-proj">
          <Icon name="plus" className="i-sm" />
          {ps.length ? "Add a project" : "Add the first project · clients can raise requests once there is one"}
        </SheetButton>
      </section>

      <div className="lower">
        <div>
          {activityError && <Note retry>Part of the activity didn&apos;t load.</Note>}
          <Activity items={items} />
        </div>

        <div className="side">
          <section className="panel" aria-label="Money">
            <div className="ph">
              <h2>Money</h2>
              <span className="c-3">
                {invs.length} invoice{invs.length === 1 ? "" : "s"}
              </span>
              <Link className="more" href="/invoices">
                Invoices →
              </Link>
            </div>
            {invoices.error ? (
              <Note retry>Couldn&apos;t load invoices.</Note>
            ) : invs.length === 0 ? (
              <Empty variant="inline" action={<Link href="/invoices/new">New invoice</Link>}>
                No invoices yet
              </Empty>
            ) : (
              <ul className="inv">
                {invs.slice(0, 6).map((i) => (
                  <li key={i.id}>
                    <Link href={`/invoices/${i.id}`}>
                      <span>
                        <div className="t">
                          {i.number ?? "Draft"}
                          {i.kind === "credit_note" ? " · credit" : ""}
                        </div>
                        <div className="m">
                          {[i.project_label, i.paid_at ? `paid ${dayMonth(i.paid_at)}` : i.due_date ? `due ${dayMonth(i.due_date)}` : null].filter(Boolean).join(" · ")}
                        </div>
                      </span>
                      <StatusPill status={i.status} />
                      <span className="amt">
                        <Money value={i.total} currency={i.currency} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {!invoices.error && invs.length > 0 && (
              <div className="inv-total">
                <span>
                  Outstanding · {due.length} invoice{due.length === 1 ? "" : "s"}
                </span>
                <span className="amt">
                  <Money value={dueSum} currency={dueCur} />
                </span>
              </div>
            )}
          </section>

          <section className="panel" aria-label="People">
            <div className="ph">
              <h2>People</h2>
              <span className="c-3">
                {t.members.length} member{t.members.length === 1 ? "" : "s"}
                {pendingInv.length ? ` · ${pendingInv.length} invited` : ""}
              </span>
              <SheetButton sheet="invite-sheet" className="more">
                + Invite
              </SheetButton>
            </div>
            {team.error ? (
              <Note retry>Couldn&apos;t load the team.</Note>
            ) : t.members.length === 0 && t.invites.length === 0 ? (
              <Empty variant="inline" action={<SheetButton sheet="invite-sheet" className="link-btn">Invite the first owner</SheetButton>}>
                Nobody yet
              </Empty>
            ) : (
              <ul className="ppl">
                {t.members.map((m) => (
                  <li key={m.user_id}>
                    <span className="avatar" aria-hidden="true">
                      {initials(m.name || m.email)}
                    </span>
                    <span className="ppl-main">
                      <div className="t">{m.name || m.email.split("@")[0]}</div>
                      <div className="m">
                        {m.email} · joined {dayMonth(m.joined_at)}
                      </div>
                    </span>
                    <span className="role">{cap(m.role)}</span>
                    {!(m.role === "owner" && owners <= 1) && (
                      <RowAction kind="remove" orgId={id} id={m.user_id} label="Remove" confirmText={`Remove ${m.email}? Their access ends straight away.`} />
                    )}
                  </li>
                ))}
                {t.invites.slice(0, 12).map((i) => (
                  <li key={i.id}>
                    <span className="avatar avatar-soft" aria-hidden="true">
                      <Icon name="mail" className="i-sm" />
                    </span>
                    <span className="ppl-main">
                      <div className="t">{i.email}</div>
                      <div className="m">
                        {i.role} · invited {dayMonth(i.created_at)}
                        {i.state === "pending" ? ` · valid until ${dayMonth(i.expires_at)}` : ""}
                      </div>
                    </span>
                    <span className="role">
                      <span className={`pill ${i.state === "pending" ? "pill-warn" : ""}`}>
                        <span className="dot" />
                        {cap(i.state)}
                      </span>
                    </span>
                    {i.state === "pending" && <RowAction kind="revoke" orgId={id} id={i.id} label="Revoke" confirmText={`Revoke the invite for ${i.email}?`} />}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <Sheet id="invite-sheet" title="Invite someone" sub={org.name as string}>
        <InviteForm orgId={id} />
      </Sheet>
      <Sheet id="retainer-sheet" title="Retainer" sub={`${org.name as string} · usage per month, overage shown, never billed`} wide>
        <RetainerPanel orgId={id} usage={u} error={Boolean(usage.error)} />
      </Sheet>
      <Sheet id="proj-new" title="Add a project" sub={org.name as string} wide>
        <ProjectForm key={`new-${ps.length}`} orgId={id} p={{ id: null, name: "", status: "active", summary: "", repo_path: "", progress: "", next_milestone: "", next_milestone_on: "" }} />
      </Sheet>
      {ps.map((p) => (
        <Sheet key={`cc-${p.id}`} id={`cc-${p.id}`} title="Connect Claude Code" sub={`${p.name} · Epsilon MCP project token`} wide>
          <ConnectClaude orgId={id} projectId={p.id} folder={p.repo_path} tokens={tokensOf(p.id)} loadError={Boolean(tokenRows.error)} />
        </Sheet>
      ))}
      {ps.map((p) => (
        <Sheet key={p.id} id={`proj-${p.id}`} title={p.name} sub="Project and agent settings" wide>
          <ProjectForm
            orgId={id}
            p={{ id: p.id, name: p.name, status: p.status, summary: p.summary ?? "", repo_path: p.repo_path ?? "", progress: p.progress === null ? "" : String(p.progress), next_milestone: p.next_milestone ?? "", next_milestone_on: p.next_milestone_on ?? "" }}
          />
          <ProjectAgentForm
            orgId={id}
            projectId={p.id}
            v={{
              test_command: agentOf.get(p.id)?.test_command ?? "", test_env_file: agentOf.get(p.id)?.test_env_file ?? "",
              default_branch: agentOf.get(p.id)?.default_branch ?? "", agent_enabled: Boolean(agentOf.get(p.id)?.agent_enabled),
              is_git: agentOf.get(p.id)?.is_git ?? null, git_checked_at: agentOf.get(p.id)?.git_checked_at ?? null, has_repo: Boolean(p.repo_path),
            }}
          />
        </Sheet>
      ))}
    </>
  );
}
