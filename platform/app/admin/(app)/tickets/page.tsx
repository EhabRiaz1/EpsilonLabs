import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/app/components/PageHeader";
import { Empty } from "@/app/components/Empty";
import { Note } from "@/app/components/Note";
import { getSession } from "@/lib/session";
import { one } from "@/lib/one";
import { peopleById } from "@/lib/portal";
import { isOpen, NEEDS_CLIENT, PRIORITY_LABEL, relativeDay, staffStatus, TYPE_LABEL } from "@/lib/tickets";
import { stamp } from "@/lib/dates";
import { TicketQueue, type QueueRow } from "./TicketQueue";

export const metadata: Metadata = { title: "Tickets" };

type Row = {
  id: string; ref: string; org_id: string; title: string; body: string; type: string; priority: string; status: string; author_id: string | null;
  created_at: string; updated_at: string;
  organizations: { name: string } | { name: string }[] | null; projects: { name: string } | { name: string }[] | null;
};
const VIEWS = [
  ["you", "Waiting on you"],
  ["client", "With client"],
  ["done", "Closed"],
  ["all", "All"],
] as const;
type View = (typeof VIEWS)[number][0];
const inView = (v: View, s: string) => (v === "you" ? isOpen(s) && !NEEDS_CLIENT.has(s) : v === "client" ? NEEDS_CLIENT.has(s) : v === "done" ? !isOpen(s) : true);

export default async function TicketsQueuePage({ searchParams }: { searchParams: Promise<{ view?: string; org?: string }> }) {
  const sp = await searchParams;
  const view: View = VIEWS.some(([v]) => v === sp.view) ? (sp.view as View) : "you";
  const org = /^[0-9a-f-]{36}$/i.test(sp.org ?? "") ? (sp.org as string) : null;
  const { supabase } = await getSession();
  // RLS: staff (aal2) see every org's tickets; test-scope staff see is_test orgs only
  let q = supabase
    .from("tickets")
    .select("id, ref, org_id, title, body, type, priority, status, author_id, created_at, updated_at, organizations(name), projects(name)")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (org) q = q.eq("org_id", org);
  const { data, error } = await q;
  const all = (data ?? []) as Row[];
  const list = all
    .filter((t) => inView(view, t.status))
    .sort((a, b) => (view === "you" ? Number(b.priority === "urgent") - Number(a.priority === "urgent") : 0) || b.updated_at.localeCompare(a.updated_at))
    .slice(0, 150);
  const people = await peopleById(supabase, list.map((t) => t.author_id));
  const files = new Map<string, number>();
  if (list.length) {
    const { data: fl } = await supabase.from("files").select("ticket_id").in("ticket_id", list.slice(0, 150).map((t) => t.id)).eq("status", "ready");
    for (const f of (fl ?? []) as { ticket_id: string }[]) files.set(f.ticket_id, (files.get(f.ticket_id) ?? 0) + 1);
  }
  const now = new Date();
  const rows: QueueRow[] = list.map((t) => {
    const s = staffStatus(t.status);
    const orgName = one(t.organizations)?.name ?? "";
    const project = one(t.projects)?.name ?? "";
    return {
      id: t.id,
      ref: t.ref,
      title: t.title,
      meta: `${t.ref} · ${TYPE_LABEL[t.type] ?? t.type}`,
      urgent: t.priority === "urgent",
      client: [orgName, project].filter(Boolean).join(" · "),
      status: { ...s, raw: t.status },
      when: relativeDay(t.updated_at, now),
      body: t.body,
      fields: [
        ["Client", orgName],
        ["Project", project],
        ["Opened", `${stamp(t.created_at)} · ${people.get(t.author_id ?? "")?.name ?? "someone"}`],
        ["Urgency", PRIORITY_LABEL[t.priority] ?? t.priority],
        ["Files", String(files.get(t.id) ?? 0)],
      ],
    };
  });
  const orgName = org ? one(all[0]?.organizations ?? null)?.name : null;
  const href = (v: View) => `/tickets?${new URLSearchParams({ ...(v !== "you" ? { view: v } : {}), ...(org ? { org } : {}) }).toString()}`.replace(/\?$/, "");

  return (
    <>
      <PageHeader
        title="Tickets"
        refresh={15}
        sub={
          <>
            {orgName ? `${orgName} · ` : "Every client · "}
            {all.filter((t) => inView("you", t.status)).length} waiting on you · {all.filter((t) => inView("client", t.status)).length} with the client
            {org && (
              <>
                {" · "}
                <Link href="/tickets">all clients</Link>
              </>
            )}
          </>
        }
      />
      <section className="panel clip">
        <div className="q-head">
          <nav className="tabs" aria-label="Filter tickets">
            {VIEWS.map(([v, label]) => (
              <Link key={v} className="tab" href={href(v)} aria-current={view === v ? "page" : undefined}>
                {label} <span className="c-3">{all.filter((t) => inView(v, t.status)).length}</span>
              </Link>
            ))}
          </nav>
          <span className="c-3 t-12 hide-m ml-auto">
            <span className="kbd">J</span> <span className="kbd">K</span> move · <span className="kbd">O</span> open
          </span>
        </div>
        {error ? (
          <Note tone="error" retry className="m-16">Couldn&apos;t load tickets.</Note>
        ) : rows.length ? (
          <TicketQueue rows={rows} />
        ) : (
          <Empty title="All clear">
            <span>{view === "you" ? "Nothing waits on you. New client requests land here within 15 seconds." : "No tickets in this view."}</span>
          </Empty>
        )}
      </section>
    </>
  );
}
