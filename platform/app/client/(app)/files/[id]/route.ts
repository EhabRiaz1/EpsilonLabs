import type { NextRequest } from "next/server";
import { fileDownload } from "@/lib/file-download";

// GET /files/<id>: a short-lived signed URL with Content-Disposition: attachment, after an RLS-checked lookup.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return fileDownload((await params).id);
}

export const dynamic = "force-dynamic";
