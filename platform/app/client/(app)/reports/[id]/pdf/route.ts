import { downloadReportPdf } from "@/lib/report-download";
import { getSession } from "@/lib/session";
import { inDemo } from "@/lib/orgs";
import { demoPdfResponse } from "@/lib/demo";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, claims } = await getSession();
  if (claims && (await inDemo(supabase, claims.sub))) return demoPdfResponse(`/reports/${id}`);
  return downloadReportPdf(id);
}
