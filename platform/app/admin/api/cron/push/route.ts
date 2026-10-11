import { NextResponse, type NextRequest } from "next/server";
import { bearerOk } from "@/lib/push-auth";
import { sendPushBatch } from "@/lib/push-send";

// POST https://admin.epsilon-labs.co/api/cron/push with "Authorization: Bearer $PUSH_CRON_SECRET".
// Called every minute by the Mac worker: Vercel Hobby crons run at most once a day. Other methods get 405.
export async function POST(req: NextRequest) {
  if (!bearerOk(req.headers.get("authorization"), process.env.PUSH_CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const counts = await sendPushBatch(50);
    return NextResponse.json({ ok: true, ...counts }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("push sender:", e instanceof Error ? e.message.slice(0, 200) : "error");
    return NextResponse.json({ ok: false, error: "send_failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export const dynamic = "force-dynamic";
