// Upload rules (Reliability baseline: 25 MB, MIME allow-list). Pure (unit-tested). The same table is enforced by
// upload_mime_for() / begin_upload() in migration 010 and by the bucket's own limits.

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const MIME_BY_EXT: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  txt: "text/plain",
  csv: "text/csv",
  zip: "application/zip",
  step: "model/step",
  stp: "model/step",
  stl: "model/stl",
};

/** For <input accept>. */
export const ACCEPT = Object.keys(MIME_BY_EXT).map((e) => `.${e}`).join(",");

export const ALLOWED_TEXT = "PDF, images, text, CSV, ZIP (KiCad or Gerber archives) and STEP/STL, up to 25 MB";

export type UploadCheck = { ok: true; mime: string } | { ok: false; error: string };

/** Decides the MIME type from the extension (browsers report CAD files inconsistently). */
export function uploadCheck(name: string, size: number): UploadCheck {
  const ext = /\.([A-Za-z0-9]{1,10})$/.exec(name)?.[1]?.toLowerCase() ?? "";
  const mime = MIME_BY_EXT[ext];
  if (!name.trim() || name.length > 255) return { ok: false, error: "That file name is too long." };
  if (!mime) return { ok: false, error: `${name}: this type can't be uploaded. Allowed: ${ALLOWED_TEXT}.` };
  if (size <= 0) return { ok: false, error: `${name} is empty.` };
  if (size > MAX_UPLOAD_BYTES) return { ok: false, error: `${name} is over 25 MB. Share big CAD or video files by link instead.` };
  return { ok: true, mime };
}

export function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
