import "server-only";
import { getSession } from "@/lib/session";
import { slugify } from "./slug";

/**
 * GET /reports/<id>/pdf on client.* and admin.*. RLS decides who may read the row and the stored file (members of the
 * org see published reports; staff with aal2 see all). Served as an attachment. Nothing is rendered here: a report's
 * PDF exists from the moment it is published.
 */
export async function downloadReportPdf(id: string): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const { supabase, claims } = await getSession();
  if (!claims) return new Response("Sign in first", { status: 401 });
  const { data: r } = await supabase.from("reports").select("id, title, pdf_path").eq("id", id).maybeSingle();
  if (!r) return new Response("Not found", { status: 404 });
  if (!r.pdf_path) return new Response("This report has no PDF yet.", { status: 409 });
  const { data: file, error } = await supabase.storage.from("reports").download(r.pdf_path as string);
  if (error || !file) {
    console.error(`report ${id}: stored PDF download failed: ${error?.message}`);
    return new Response("The PDF couldn't be fetched just now. Try again in a minute.", { status: 503, headers: { "Retry-After": "60" } });
  }
  const name = `${slugify(String(r.title)) || "report"}-delivery-report.pdf`;
  return new Response(file, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
