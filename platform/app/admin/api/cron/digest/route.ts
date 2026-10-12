import { NextResponse, type NextRequest } from "next/server";
import { bearerOk } from "@/lib/push-auth";
import { runDigest } from "@/lib/digest-send";

// POST https://admin.epsilon-labs.co/api/cron/digest with "Authorization: Bearer $PUSH_CRON_SECRET" (the same shared
// secret as /api/cron/push). Called every 5 minutes by the Mac worker (Vercel Hobby crons run once a day): emails
// urgent portal notifications at once, daily digests at 10:00 local, and flags overdue invoices. Other methods: 405.
export async function POST(req: NextRequest) {
  if (!bearerOk(req.headers.get("authorization"), process.env.PUSH_CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const counts = await runDigest();
    return NextResponse.json({ ok: true, ...counts }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("digest sender:", e instanceof Error ? e.message.slice(0, 200) : "error");
    return NextResponse.json({ ok: false, error: "send_failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;
