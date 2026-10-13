// The demo portal (Phase 7 / E3). Pure constants and checks; the database is the real guard (migration 016's
// demo_guard triggers refuse every user write to a demo org), these only give visitors a clear message first.

/** The one demo login (migration 016 demo_user_email()). No mailbox: it is signed in by the /demo server action. */
export const DEMO_EMAIL = "demo-portal@epsilon-labs.co";

/** The name the portal shows for the demo login, whatever its Auth metadata says (visitors share one login). */
export const DEMO_NAME = "Demo visitor";

export const DEMO_READ_ONLY = "This is the demo portal: it is read-only, so nothing was saved.";

/** PDFs are rendered and stored on first download (a write), so the demo shows the web versions only. */
export function demoPdfResponse(back: string): Response {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Demo</title>
<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#efede9;color:#1b1a18;display:grid;place-items:center;min-height:100vh;margin:0">
<main style="background:#fff;border-radius:24px;padding:28px 30px;max-width:420px">
<p style="font-size:12px;font-weight:600;letter-spacing:.04em;margin:0 0 8px">DEMO · SAMPLE DATA</p>
<h1 style="font-size:20px;font-weight:500;margin:0 0 8px">PDF downloads are off in the demo</h1>
<p style="color:#5d5a55;line-height:1.6;margin:0 0 16px">A real client downloads the PDF here. In the demo, the web version shows the same content.</p>
<a href="${back.replace(/[^A-Za-z0-9/_-]/g, "")}" style="color:#b8431f;font-weight:600">Open the web version</a></main></body>`;
  return new Response(html, { status: 403, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

/** True when every organisation the user is in is a demo org (a real client is never treated as a demo). */
export function isDemoOnly(memberships: readonly { isDemo: boolean }[]): boolean {
  return memberships.length > 0 && memberships.every((m) => m.isDemo);
}
