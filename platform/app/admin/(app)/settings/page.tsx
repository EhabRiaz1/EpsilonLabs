import type { Metadata } from "next";
import { PageHeader } from "@/app/components/PageHeader";
import { Note } from "@/app/components/Note";
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
      <PageHeader title="Settings" sub="The same settings the Mac cockpit edits, checked by the same rules. The agents read them on their next run." />

      <section className="panel panel-pad mb-14">
        <h2 className="t-16 w-600">Notifications on this device</h2>
        <p className="hint mt-4">
          Push to this phone or browser for interested replies, new drafts, enquiries, tickets, proposals viewed or accepted, invoices paid
          and agent errors. Titles only, never a client&apos;s words. Urgent ones are also emailed to er@.
        </p>
        <div className="mt-12">
          <PushToggle />
        </div>
      </section>

      {error || !data ? (
        <Note tone="error" retry>Couldn&apos;t load settings.</Note>
      ) : (
        <SettingsForm v={data as SettingsValues} />
      )}
    </>
  );
}
