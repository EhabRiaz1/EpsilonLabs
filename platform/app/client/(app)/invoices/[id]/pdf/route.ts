import { downloadInvoicePdf } from "@/lib/invoice-download";
import { getSession } from "@/lib/session";
import { inDemo } from "@/lib/orgs";
import { demoPdfResponse } from "@/lib/demo";

export const maxDuration = 60;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { supabase, claims } = await getSession();
  if (claims && (await inDemo(supabase, claims.sub))) return demoPdfResponse(`/invoices/${id}`);
  return downloadInvoicePdf(id);
}
