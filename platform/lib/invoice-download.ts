import "server-only";
import { getSession } from "@/lib/session";
import { esc } from "./html";
import { ensureInvoicePdf } from "./invoice-pdf";

/**
 * GET /invoices/<id>/pdf on client.* and admin.*. Who may download is decided by RLS as the signed-in user
 * (members of the org, or staff with aal2); the service role is used only to render and store a missing PDF.
 * The stored file is always served as an attachment.
 */
export async function downloadInvoicePdf(id: string): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const { supabase, claims } = await getSession();
  if (!claims) return new Response("Sign in first", { status: 401 });
  const { data: inv } = await supabase.from("invoices").select("id, number, status, pdf_path").eq("id", id).maybeSingle();
  if (!inv) return new Response("Not found", { status: 404 });
  if (!inv.number) return new Response("This invoice has not been issued yet.", { status: 409 });

  let path = inv.pdf_path as string | null;
  if (!path) {
    const r = await ensureInvoicePdf(id);
    if (!r.ok) {
      console.error(`invoice ${inv.number}: PDF not ready: ${r.error}`);
      return pending(id, inv.number as string);
    }
    path = r.path;
  }
  const { data: file, error } = await supabase.storage.from("invoices").download(path);
  if (error || !file) {
    console.error(`invoice ${inv.number}: stored PDF download failed: ${error?.message}`);
    return pending(id, inv.number as string);
  }
  return new Response(file, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${inv.number}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function pending(id: string, number: string): Response {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PDF not ready</title>
<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#efede9;color:#1b1a18;display:grid;place-items:center;min-height:100vh;margin:0">
<main style="background:#fff;border-radius:24px;padding:28px 30px;max-width:420px">
<h1 style="font-size:20px;font-weight:500;margin:0 0 8px">PDF not ready yet</h1>
<p style="color:#5d5a55;line-height:1.6;margin:0 0 16px">The PDF for ${esc(number)} couldn't be prepared just now. The invoice itself is fine; open the web version, or try the download again in a minute.</p>
<a href="/invoices/${esc(id)}" style="color:#b8431f;font-weight:600">Open the web version</a></main></body>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Retry-After": "60", "Cache-Control": "no-store" } });
}
