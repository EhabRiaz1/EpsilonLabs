import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { renderPdf } from "./invoice-pdf";
import { checkReport } from "./report-content";
import { monthYear, reportDocument } from "./report-template";

// F15: a delivery report is rendered to PDF ONCE, when the founder publishes it (headless Chromium on the server, the
// same path as invoices), stored in the private `reports` bucket at <org_id>/<report_id>.pdf, and only then marked
// published (mark_report_published, service role only), which notifies the client's team. If rendering or storing
// fails the report stays `approved` with pdf_error set and nothing reaches the client; "Publish" tries again.

export type PublishResult = { ok: true; path: string; already: boolean } | { ok: false; error: string };

type Row = { id: string; org_id: string; title: string; content: unknown; status: string; pdf_path: string | null; approved_at: string | null; organizations: { name: string } | { name: string }[] | null };

export async function publishReport(reportId: string): Promise<PublishResult> {
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("reports")
    .select("id, org_id, title, content, status, pdf_path, approved_at, organizations(name)")
    .eq("id", reportId)
    .maybeSingle();
  if (error || !data) return { ok: false, error: error ? `lookup failed: ${error.message}` : "report not found" };
  const r = data as unknown as Row;
  if (r.status === "published" && r.pdf_path) return { ok: true, path: r.pdf_path, already: true };
  if (r.status !== "approved") return { ok: false, error: "the report is not approved" };

  const fail = async (msg: string): Promise<PublishResult> => {
    await svc.from("reports").update({ pdf_error: msg.slice(0, 1000), pdf_attempted_at: new Date().toISOString() }).eq("id", reportId);
    return { ok: false, error: msg };
  };
  const checked = checkReport(r.content);
  if (!checked.ok) return fail(`content: ${checked.error}`);
  const org = Array.isArray(r.organizations) ? r.organizations[0] : r.organizations;
  const html = reportDocument(checked.content, { orgName: org?.name, dateLabel: monthYear(r.approved_at ?? new Date()) });

  let pdf: Uint8Array | null = null;
  let lastError = "";
  for (let attempt = 0; attempt < 2 && !pdf; attempt++) {
    try {
      pdf = await renderPdf(html);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  if (!pdf) return fail(`render failed: ${lastError}`);

  const path = `${r.org_id}/${r.id}.pdf`;
  const up = await svc.storage.from("reports").upload(path, pdf, { contentType: "application/pdf", upsert: false });
  // a concurrent publish may have stored it first: keep that file, it was rendered from the same frozen content
  if (up.error && !/exists|duplicate/i.test(up.error.message)) return fail(`upload failed: ${up.error.message}`);
  const { data: done, error: e2 } = await svc.rpc("mark_report_published", { p_id: reportId, p_pdf_path: path });
  if (e2) return fail(`publish failed: ${e2.message}`);
  return { ok: true, path, already: Boolean((done as { already?: boolean } | null)?.already) };
}
