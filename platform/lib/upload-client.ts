"use client";
import { createClient } from "@/lib/supabase/browser";
import { uploadCheck } from "@/lib/files";

// Browser uploads (Vercel functions cap request bodies far below 25 MB, so files go straight to Storage):
// 1. begin_upload registers the file and returns its path (the RPC checks membership, type and size),
// 2. Storage accepts that exact path only (bucket policy), 3. finish_upload confirms it and notifies the org.

export type UploadTarget = { projectId?: string | null; ticketId?: string | null };
export type UploadResult = { ok: true; name: string } | { ok: false; name: string; error: string };

function friendly(msg: string, name: string): string {
  if (/25 MB/.test(msg)) return `${name} is over 25 MB. Share big CAD or video files by link instead.`;
  if (/not allowed|does not match/.test(msg)) return `${name}: this file type can't be uploaded.`;
  if (/too many unfinished/.test(msg)) return "Too many uploads in a row. Wait a few minutes and try again.";
  if (/read-only/.test(msg)) return "This organisation is read-only.";
  return `${name} couldn't be uploaded. Try again.`;
}

export async function uploadOne(file: File, target: UploadTarget): Promise<UploadResult> {
  const check = uploadCheck(file.name, file.size);
  if (!check.ok) return { ok: false, name: file.name, error: check.error };
  const supabase = createClient();
  const begun = await supabase.rpc("begin_upload", {
    p_project_id: target.projectId ?? null,
    p_ticket_id: target.ticketId ?? null,
    p_name: file.name,
    p_mime: check.mime,
    p_size: file.size,
  });
  if (begun.error) return { ok: false, name: file.name, error: friendly(begun.error.message, file.name) };
  const { id, path } = begun.data as { id: string; path: string };
  const up = await supabase.storage.from("client-files").upload(path, file, { contentType: check.mime, upsert: false, cacheControl: "0" });
  if (up.error) return { ok: false, name: file.name, error: friendly(up.error.message, file.name) };
  const done = await supabase.rpc("finish_upload", { p_id: id });
  if (done.error) return { ok: false, name: file.name, error: friendly(done.error.message, file.name) };
  return { ok: true, name: file.name };
}

/** One at a time, so a failure names its file and the rest still go. */
export async function uploadAll(files: File[], target: UploadTarget): Promise<UploadResult[]> {
  const out: UploadResult[] = [];
  for (const f of files) out.push(await uploadOne(f, target));
  return out;
}
