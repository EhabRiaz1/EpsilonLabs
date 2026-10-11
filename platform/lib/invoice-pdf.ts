import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { INVOICE_COLUMNS, invoiceHtml, type StoredInvoice } from "./invoice-view";

// F15: an issued invoice is rendered to PDF ONCE (headless Chromium on the server), stored in the private
// `invoices` bucket, and that stored file is what everyone downloads afterwards. If rendering fails the invoice
// keeps pdf_path = null ("PDF pending"), the HTML view still works, and the next request tries again.

const ISSUED = new Set(["sent", "paid", "overdue", "void"]);

async function launch() {
  const puppeteer = (await import("puppeteer-core")).default;
  if (process.env.VERCEL) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({
      args: puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
      executablePath: await chromium.executablePath(),
      headless: "shell",
    });
  }
  // local dev: the system Chrome (override with CHROME_PATH)
  return puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
}

export async function renderPdf(html: string): Promise<Uint8Array> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    // the document is self-contained (inline CSS, no external requests)
    await page.setJavaScriptEnabled(false);
    await page.setContent(html, { waitUntil: "load", timeout: 20_000 });
    return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, timeout: 20_000 });
  } finally {
    await browser.close();
  }
}

export type PdfResult = { ok: true; path: string } | { ok: false; error: string };

/** Renders and stores the PDF if it isn't stored yet. Safe to call concurrently and repeatedly. */
export async function ensureInvoicePdf(invoiceId: string): Promise<PdfResult> {
  const svc = createServiceClient();
  const { data, error } = await svc.from("invoices").select(INVOICE_COLUMNS).eq("id", invoiceId).maybeSingle();
  if (error || !data) return { ok: false, error: error ? `lookup failed: ${error.message}` : "invoice not found" };
  const inv = data as unknown as StoredInvoice;
  if (inv.pdf_path) return { ok: true, path: inv.pdf_path };
  if (!inv.number || !ISSUED.has(inv.status)) return { ok: false, error: "the invoice is not issued yet" };

  const fail = async (msg: string): Promise<PdfResult> => {
    await svc.from("invoices").update({ pdf_error: msg.slice(0, 1000), pdf_attempted_at: new Date().toISOString() }).eq("id", invoiceId);
    return { ok: false, error: msg };
  };

  const html = invoiceHtml(inv);
  if (!html) return fail("INVOICE_DETAILS_JSON (issuer address and payment details) is not configured");

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

  const path = `${inv.org_id}/${inv.number}.pdf`;
  const up = await svc.storage.from("invoices").upload(path, pdf, { contentType: "application/pdf", upsert: false });
  // a concurrent request may have stored it first: keep that file, it was rendered from the same frozen invoice
  if (up.error && !/exists|duplicate/i.test(up.error.message)) return fail(`upload failed: ${up.error.message}`);
  const { error: e2 } = await svc
    .from("invoices")
    .update({ pdf_path: path, pdf_error: null, pdf_attempted_at: new Date().toISOString() })
    .eq("id", invoiceId)
    .is("pdf_path", null);
  if (e2) return fail(`saving pdf_path failed: ${e2.message}`);
  return { ok: true, path };
}
