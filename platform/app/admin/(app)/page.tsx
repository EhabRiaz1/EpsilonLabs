import type { Metadata } from "next";
import { MenuButton } from "@/app/components/ShellControls";
import { Icon } from "@/app/components/Icon";
import { firstName, getSession } from "@/lib/session";
import { greeting, longDate } from "@/lib/dates";

export const metadata: Metadata = { title: "Overview" };

const TZ = "Asia/Karachi"; // the founder's clock (Epsilon OS runs on PKT)

export default async function AdminHome() {
  const { supabase, claims } = await getSession();
  // RLS: full staff (aal2) count every org; test-scope staff count only is_test orgs.
  const { count, error } = await supabase.from("organizations").select("id", { count: "exact", head: true });
  const now = new Date();
  return (
    <>
      <header className="greet">
        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
          <MenuButton />
          <div>
            <h1>
              {greeting(now, TZ)}, {claims ? firstName(claims) : "there"}
            </h1>
            <div className="date">{longDate(now, TZ)}</div>
          </div>
        </div>
      </header>

      <section className="kpi">
        <div className="panel tile">
          <div className="l">
            <div className="k">Client organisations</div>
            <div className="v big num">{error ? "–" : (count ?? 0)}</div>
            <div className="d">{error ? "Couldn't load. Reload to retry." : count ? "active and archived" : "none yet"}</div>
          </div>
        </div>
      </section>

      {!error && !count && (
        <section className="panel" style={{ marginTop: 14 }}>
          <div className="empty">
            <div className="orb">
              <span className="wave" />
              <span className="wave" />
              <span className="core">
                <Icon name="users" className="i-lg" />
              </span>
            </div>
            <h2 className="display">No client organisations yet</h2>
            <p className="c-2" style={{ maxWidth: "40ch" }}>
              An organisation is created when a proposal is accepted in the deal room. It will show here.
            </p>
          </div>
        </section>
      )}
    </>
  );
}
