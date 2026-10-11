import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Download of a client file (client.* and admin.*). The row is read as the signed-in user, so RLS decides access
 * (members of the org see ready files, staff see all). Storage RLS checks the same rows again when signing.
 * The signed URL lives 60 s and forces a download (Content-Disposition: attachment), so nothing renders inline.
 */
export async function fileDownload(id: string): Promise<NextResponse> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.from("files").select("path, name, status").eq("id", id).maybeSingle();
  if (!data || data.status !== "ready") return new NextResponse("Not found", { status: 404 });
  const { data: signed, error } = await supabase.storage.from("client-files").createSignedUrl(data.path as string, 60, { download: data.name as string });
  if (error || !signed?.signedUrl) {
    console.error("file download: signing failed:", error?.message);
    return new NextResponse("This file can't be downloaded right now. Try again in a minute.", { status: 503 });
  }
  return NextResponse.redirect(signed.signedUrl, { status: 303, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
