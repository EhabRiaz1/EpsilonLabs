import type { Metadata } from "next";
import { MenuButton } from "@/app/components/ShellControls";
import { PushToggle } from "@/app/components/PushToggle";
import { getSession } from "@/lib/session";
import type { SettingsValues } from "@/lib/admin-settings";
import { SettingsForm } from "./SettingsForm";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { supabase } = await getSession();
  const { data, error } = await supabase.rpc("get_settings");
  return (
    <>
      <header className="page-head">
        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
          <MenuButton />
          <div>
            <h1 className="display">Settings</h1>
            <div className="sub">The same settings the Mac cockpit edits, checked by the same rules. The agents read them on their next run.</div>
          </div>
        </div>
      </header>

      <section className="panel panel-pad" style={{ marginBottom: 14 }}>
        <h2 className="t-16 w-600">Notifications on this device</h2>
        <p className="hint" style={{ marginTop: 4 }}>
          Push to this phone or browser for interested replies, new drafts, enquiries, tickets, proposals viewed or accepted, invoices paid
          and agent errors. Titles only, never a client&apos;s words. Urgent ones are also emailed to er@.
        </p>
        <div style={{ marginTop: 12 }}>
          <PushToggle />
        </div>
      </section>

      {error || !data ? (
        <p className="auth-error" role="alert">Couldn&apos;t load settings. Reload to retry.</p>
      ) : (
        <SettingsForm v={data as SettingsValues} />
      )}
    </>
  );
}
