import type { Metadata } from "next";
import { Icon } from "@/app/components/Icon";
import { MenuButton } from "@/app/components/ShellControls";
import { firstName, getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Home" };

type Project = { id: string; name: string; status: string; summary: string | null };

const STATUS: Record<string, { label: string; pill: string }> = {
  active: { label: "On track", pill: "pill-good" },
  paused: { label: "Paused", pill: "pill-warn" },
  done: { label: "Delivered", pill: "" },
  archived: { label: "Archived", pill: "" },
};

export default async function ClientHome() {
  const { supabase, claims } = await getSession();
  // RLS returns only projects of the user's own organisations. repo_path is not granted to clients.
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, status, summary")
    .neq("status", "archived")
    .order("created_at", { ascending: false });
  const projects = (data ?? []) as Project[];

  return (
    <>
      <header className="greet">
        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
          <MenuButton />
          <div>
            <h1>Welcome, {claims ? firstName(claims) : "there"}</h1>
            <div className="date">Your projects, requests and invoices with Epsilon Labs</div>
          </div>
        </div>
      </header>

      {error ? (
        <section className="panel panel-pad">
          <p className="c-bad t-13">We couldn&apos;t load your projects. Reload the page to try again.</p>
        </section>
      ) : projects.length === 0 ? (
        <section className="panel">
          <div className="empty">
            <div className="orb">
              <span className="wave" />
              <span className="wave" />
              <span className="core">
                <Icon name="folder" className="i-lg" />
              </span>
            </div>
            <h2 className="display">Your projects will appear here</h2>
            <p className="c-2" style={{ maxWidth: "40ch" }}>
              Once your first project starts, you can follow its progress, raise requests and download reports from this page.
            </p>
          </div>
        </section>
      ) : (
        <section className="home-grid" aria-label="Your projects">
          {projects.map((p, i) => {
            const s = STATUS[p.status] ?? { label: p.status, pill: "" };
            return (
              <article key={p.id} className="panel proj lift" style={{ animation: "enter var(--d-slow) var(--ease) both", animationDelay: `${i * 50}ms` }}>
                <div className="row between">
                  <span className={`pill ${s.pill}`}>
                    <span className="dot" />
                    {s.label}
                  </span>
                  <span className="c-3 t-12">Project</span>
                </div>
                <div className="title">{p.name}</div>
                {p.summary && <div className="c-3 t-13">{p.summary}</div>}
              </article>
            );
          })}
        </section>
      )}
    </>
  );
}
