import type { NextRequest } from "next/server";
import { fileDownload } from "@/lib/file-download";

// GET /files/<id> on admin.*: staff (aal2) read any org's files through RLS.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return fileDownload((await params).id);
}

export const dynamic = "force-dynamic";
