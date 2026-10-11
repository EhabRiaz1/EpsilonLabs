import type { Metadata } from "next";
import { headers } from "next/headers";
import { MenuButton } from "@/app/components/ShellControls";
import { getSession } from "@/lib/session";
import { clientOrigin } from "@/lib/host";
import { stamp } from "@/lib/dates";
import { TermsToggle } from "./TermsToggle";

export const metadata: Metadata = { title: "Terms" };

type Row = { version: string; title: string; pdf_path: string; sha256: string; active: boolean; activated_at: string | null; created_at: string };

export default async function TermsPage() {
  const { supabase } = await getSession();
  const [{ data, error }, { data: acc }] = await Promise.all([
    supabase.from("terms_versions").select("*").order("created_at", { ascending: false }),
    supabase.from("acceptances").select("terms_version"),
  ]);
  const counts = new Map<string, number>();
  for (const a of acc ?? []) counts.set(a.terms_version, (counts.get(a.terms_version) ?? 0) + 1);
  const h = await headers();
  const origin = clientOrigin({ host: h.get("host"), forwardedHost: h.get("x-forwarded-host"), forwardedProto: h.get("x-forwarded-proto") });
  const rows = (data ?? []) as Row[];
  return (
    <>
      <header className="page-head">
        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
          <MenuButton />
          <div>
            <h1 className="display">Contract terms</h1>
            <div className="sub">
              A proposal can only be accepted while its terms version is active. Changed terms are a new version, never an edit, once anything has been accepted.
            </div>
          </div>
        </div>
      </header>
      {error ? (
        <section className="panel panel-pad">
          <p className="c-bad t-13">Couldn&apos;t load terms. Reload to retry.</p>
        </section>
      ) : (
        <section className="panel table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Status</th>
                <th>Fingerprint</th>
                <th>Accepted under it</th>
                <th style={{ textAlign: "right" }}>Activate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.version}>
                  <td>
                    <div className="w-500">{t.version}</div>
                    <a className="c-3 t-12" href={`${origin}${t.pdf_path}`} target="_blank" rel="noopener noreferrer">
                      {t.title} (PDF)
                    </a>
                  </td>
                  <td>
                    {t.active ? (
                      <span className="pill pill-good">
                        <span className="dot" />
                        Active{t.activated_at ? ` since ${stamp(t.activated_at)}` : ""}
                      </span>
                    ) : (
                      <span className="pill pill-warn">
                        <span className="dot" />
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="id">
                    {t.sha256.slice(0, 4)}…{t.sha256.slice(-4)}
                  </td>
                  <td>{counts.get(t.version) ?? 0}</td>
                  <td style={{ textAlign: "right" }}>
                    <TermsToggle version={t.version} active={t.active} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
