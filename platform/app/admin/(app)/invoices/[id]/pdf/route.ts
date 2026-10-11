import { downloadInvoicePdf } from "@/lib/invoice-download";

export const maxDuration = 60;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return downloadInvoicePdf(id);
}
