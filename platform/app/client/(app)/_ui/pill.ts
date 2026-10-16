/** The portal's status pill tone: copper (.pill-acc) only for "waiting on you"; green and red keep their meaning;
 *  everything else (Received, Planned, …) is neutral. */
export function clientPill(tone: string, waiting: boolean): string {
  if (waiting) return "pill-acc";
  return tone === "pill-good" || tone === "pill-bad" ? tone : "";
}
