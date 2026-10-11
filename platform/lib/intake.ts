// Intake vocabulary and the proposal prefill made from an enquiry. Pure (unit-tested).

export type IntakeStatus = "new" | "contacted" | "converted" | "spam";
export const INTAKE_STATUSES: readonly IntakeStatus[] = ["new", "contacted", "converted", "spam"];

export const INTAKE_CHIP: Readonly<Record<IntakeStatus, { label: string; tone: string }>> = {
  new: { label: "New", tone: "pill-accent" },
  contacted: { label: "Contacted", tone: "pill-warn" },
  converted: { label: "Converted", tone: "pill-good" },
  spam: { label: "Spam", tone: "pill-bad" },
};

export type IntakeRow = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  kind: string;
  budget: string | null;
  message: string;
  answers: Record<string, string>;
};

const ANSWER_LABELS: ReadonlyArray<[string, string]> = [
  ["need", "The work"],
  ["offer_name", "Maps to"],
  ["state", "Today"],
  ["when", "Timing"],
];

/** "Label: value" lines for the answers the wizard sends, in a stable order. */
export function answerLines(answers: Record<string, string> | null | undefined): [string, string][] {
  const a = answers ?? {};
  return ANSWER_LABELS.filter(([k]) => typeof a[k] === "string" && a[k].trim()).map(([k, label]) => [label, a[k].trim()]);
}

/** Fields of a new proposal drafted from an enquiry. The founder edits everything before sending. */
export function proposalPrefill(i: IntakeRow): { title: string; client_company: string; contact_name: string; contact_email: string; summary: string } {
  const offer = i.answers?.offer_name?.trim() || i.answers?.need?.trim() || "";
  const summary = [i.message.trim(), ...answerLines(i.answers).map(([k, v]) => `${k}: ${v}`), i.budget ? `Budget band: ${i.budget}` : ""]
    .filter(Boolean)
    .join("\n")
    .slice(0, 2000);
  return {
    title: (offer || "Project proposal").slice(0, 200),
    client_company: (i.company?.trim() || i.name).slice(0, 200),
    contact_name: i.name.slice(0, 200),
    contact_email: i.email,
    summary,
  };
}
