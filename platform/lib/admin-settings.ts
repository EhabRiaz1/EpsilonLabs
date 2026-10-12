// Labels and option lists from epsilon-os/core/settings.py, for the admin Settings and Opportunities pages.
// Validation is NOT here: save_settings() in migration 011 is the one rulebook.

export const SEGMENTS: [string, string][] = [
  ["industrial", "Industrial operations"],
  ["oem_hardware", "OEMs and hardware startups"],
  ["smb_software", "SMBs needing software"],
];
export const STRATEGIES: [string, string][] = [
  ["s2_trigger", "Trigger events"], ["s3_regulation", "Regulation"], ["s4_partner", "Partners"], ["s5_intent", "Outsourcing intent"],
  ["s7_orphaned", "Orphaned devices"], ["s8_tradeshow", "Trade-show exhibitors"], ["s9_crowdfund", "Crowdfunded hardware"],
  ["s10_accelerator", "Accelerators and spinouts"], ["s11_software", "Software triggers"],
  ["s12_devpartner", "Seeking a dev partner"], ["s13_hn", "Hacker News Seeking Freelancer"],
];
export const TENDER_LIVE = ["ted", "uk_fts", "uk_cf", "canadabuys", "austender", "ungm", "samgov", "worldbank", "ebrd", "ppra_epms"];
export const TENDER_DISABLED = ["adb", "afdb", "isdb", "aiib", "etimad", "dubai", "monaqasat", "oman", "bahrain", "kuwait"];
export const TENDER_SOURCE_LABEL: Record<string, string> = {
  ted: "EU TED", uk_fts: "UK Find a Tender", uk_cf: "UK Contracts Finder", canadabuys: "CanadaBuys", austender: "AusTender",
  ungm: "UNGM", samgov: "SAM.gov", worldbank: "World Bank", ebrd: "EBRD", ppra_epms: "Pakistan PPRA (EPMS)",
  adb: "ADB (disabled)", afdb: "AfDB (disabled)",
  isdb: "IsDB (disabled)", aiib: "AIIB (disabled)", etimad: "Saudi Etimad (disabled)", dubai: "Dubai eSupply (disabled)",
  monaqasat: "Qatar Monaqasat (disabled)", oman: "Oman Tender Board (disabled)", bahrain: "Bahrain Tender Board (disabled)",
  kuwait: "Kuwait CTC (disabled)",
};

/** Settings values (get_settings(): code defaults overlaid with the stored rows) as the strings the form posts. */
export type SettingsValues = Record<string, unknown>;
export const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
export const asText = (v: unknown): string => (v == null ? "" : String(v));

/** FormData -> the JSON object save_settings() takes: the same fields and shapes as the 8787 form post. */
export function formToSettings(fd: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== "string" || k.startsWith("$")) continue;
    if (k === "segments" || k === "tenders_sources") out[k] = [...((out[k] as string[]) ?? []), v];
    else out[k] = v;
  }
  // an unticked checkbox group posts nothing; say "none" explicitly so the rulebook reports it
  if (fd.has("$segments") && !out.segments) out.segments = [];
  if (fd.has("$tenders") && !out.tenders_sources) out.tenders_sources = [];
  return out;
}
