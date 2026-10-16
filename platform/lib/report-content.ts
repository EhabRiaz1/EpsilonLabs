// Delivery report content (epsilon-os/skills/delivery-report/SKILL.md). The shape is report-schema.json, a byte-identical
// copy of the worker's schema (epsilon-os/tests/test_platform_jobs.py checks they match). Pure (unit-tested).
import schema from "./report-schema.json";

export type Kpi = { value: string; label: string };
export type Measure = { measure: string; before: string; after: string };
export type Row = { item: string; outcome: string; new: boolean };
export type Section = { title: string; intro: string; callout: { label: string; text: string } | null; rows: Row[] };
export type ReportContent = {
  title: string;
  subtitle: string;
  prepared_for?: string;
  summary: string[];
  kpis: Kpi[];
  measures: Measure[];
  sections: Section[];
  verification: { claim: string; proof: string }[];
  outstanding: { item: string; action: string }[];
};

type S = {
  type?: string;
  anyOf?: S[];
  required?: string[];
  properties?: Record<string, S>;
  additionalProperties?: boolean;
  items?: S;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
};

/** The subset of JSON Schema report-schema.json uses. Returns the first error as "path: message", or null. */
export function schemaError(v: unknown, s: S, path = "report"): string | null {
  if (s.anyOf) return s.anyOf.some((x) => schemaError(v, x, path) === null) ? null : `${path}: not an allowed shape`;
  switch (s.type) {
    case "null":
      return v === null ? null : `${path}: must be empty`;
    case "boolean":
      return typeof v === "boolean" ? null : `${path}: must be true or false`;
    case "string":
      if (typeof v !== "string") return `${path}: must be text`;
      if (s.minLength !== undefined && v.length < s.minLength) return `${path}: is empty`;
      if (s.maxLength !== undefined && v.length > s.maxLength) return `${path}: is longer than ${s.maxLength} characters`;
      return null;
    case "array": {
      if (!Array.isArray(v)) return `${path}: must be a list`;
      if (s.minItems !== undefined && v.length < s.minItems) return `${path}: needs at least ${s.minItems}`;
      if (s.maxItems !== undefined && v.length > s.maxItems) return `${path}: has more than ${s.maxItems}`;
      for (let i = 0; i < v.length; i++) {
        const e = s.items ? schemaError(v[i], s.items, `${path}[${i + 1}]`) : null;
        if (e) return e;
      }
      return null;
    }
    case "object": {
      if (typeof v !== "object" || v === null || Array.isArray(v)) return `${path}: must be an object`;
      const o = v as Record<string, unknown>;
      for (const k of s.required ?? []) if (!(k in o)) return `${path}.${k}: is missing`;
      for (const [k, val] of Object.entries(o)) {
        const sub = s.properties?.[k];
        if (!sub) {
          if (s.additionalProperties === false) return `${path}.${k}: is not part of a report`;
          continue;
        }
        const e = schemaError(val, sub, `${path}.${k}`);
        if (e) return e;
      }
      return null;
    }
    default:
      return null;
  }
}

/** Validates stored or edited content against the shared schema (the worker's `notes` is never part of content). */
export function checkReport(v: unknown): { ok: true; content: ReportContent } | { ok: false; error: string } {
  const s = schema as unknown as S;
  const err = schemaError(v, s);
  if (err) return { ok: false, error: err };
  if (v && typeof v === "object" && "notes" in v) return { ok: false, error: "report.notes: is not part of a report" };
  return { ok: true, content: v as ReportContent };
}

/** Stored content of an older or partial draft, with every list present (for the preview and the editor). */
const str = (x: unknown): string => (typeof x === "string" ? x : "");
/** A callout is { label, text }; a bare string (hand-written content) becomes a "Note" callout instead of crashing. */
const callout = (x: unknown): Section["callout"] => {
  if (typeof x === "string") return x.trim() ? { label: "Note", text: x } : null;
  if (x && typeof x === "object") {
    const c = x as { label?: unknown; text?: unknown };
    const text = str(c.text);
    return text ? { label: str(c.label) || "Note", text } : null;
  }
  return null;
};

export function normalise(v: unknown): ReportContent {
  const o = (v && typeof v === "object" ? v : {}) as Partial<ReportContent>;
  const arr = <T,>(x: T[] | undefined): T[] => (Array.isArray(x) ? x : []);
  return {
    title: typeof o.title === "string" ? o.title : "",
    subtitle: typeof o.subtitle === "string" ? o.subtitle : "",
    ...(typeof o.prepared_for === "string" ? { prepared_for: o.prepared_for } : {}),
    summary: arr(o.summary).filter((x) => typeof x === "string"),
    kpis: arr(o.kpis),
    measures: arr(o.measures),
    sections: arr(o.sections).map((x) => ({ title: str(x?.title), intro: str(x?.intro), callout: callout(x?.callout), rows: arr(x?.rows) })),
    verification: arr(o.verification),
    outstanding: arr(o.outstanding),
  };
}
