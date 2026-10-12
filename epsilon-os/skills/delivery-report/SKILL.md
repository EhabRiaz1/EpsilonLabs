---
name: delivery-report
description: Build an Epsilon Labs delivery report (the "R2" house layout the founder uses for FabricPort) from a client project's data — cover, contents, executive summary, at-a-glance KPIs, before/after table, one section per area of work, a Verification table (claim / how proven) and Outstanding items. Used by the Mac worker's report_draft job and by anyone writing a report by hand.
---

# Delivery report

A delivery report tells a client, in plain words, what a period of work changed, how each claim was
proven, and what is still open. It is the document the founder hands over at the end of a release. The
reference is `~/Desktop/FP&LM/fabricport-delivery-report-r2.html` (FabricPort Release 2); every report keeps
its skeleton, typography and tone.

## Where things live

| Piece | File |
|---|---|
| Content schema (what a report contains) | `skills/delivery-report/schema.json` (byte-identical copy: `platform/lib/report-schema.json`) |
| Model prompt (writing rules) | `prompts/delivery_report.md` + `prompts/preamble_platform.md` |
| Data gathering + model call | `agents/platform_jobs.py` → `report_draft()` |
| Template (R2 skeleton and CSS, copied verbatim) | `platform/lib/report-template.ts` → `reportDocument()` |
| Editor text format (round-trips the content) | `platform/lib/report-text.ts` |
| Review, edit, approve, publish | admin.epsilon-labs.co `/reports/<id>` |
| PDF (rendered once, on publish) | `platform/lib/report-pdf.ts` → private `reports` bucket, `<org_id>/<report_id>.pdf` |
| Client view and download | client.epsilon-labs.co `/reports`, `/reports/<id>`, `/reports/<id>/pdf` |

There is one template, on the hosted side, so the admin preview, the client's web view and the PDF are the
same document (F15). The worker never renders HTML: it fills the schema.

## The flow

1. **Queue.** In admin, a project's page → "Draft a delivery report" with a period (and optional notes:
   measurements, sign-offs, anything the founder knows that the tickets don't). This is the
   `queue_report_draft` RPC → a `report_draft` job `{project_id, period_start, period_end[, notes]}`.
2. **Gather (worker, service role, read-only).** For the period: tickets finished and opened, open tickets,
   client-visible ticket activity, the founder's internal notes, published weekly updates, and `git log` in
   the project's `repo_path` limited to commits whose message mentions one of the project's own tickets
   (`EL-<n>`), subject lines only.
3. **Draft (one tool-less call).** `core.llm.ask` with the schema above, `sonnet`, 300 s. Everything from
   tickets, comments, commits and notes goes inside `<untrusted>`; the system prompt carries only the project
   name, client name, period and counts. Output is validated against the schema; the model's `notes` (for the
   founder) is stripped from the content and kept in the job result.
4. **Save.** `save_report_draft` → `reports` row, `status = draft`. The founder gets a push.
5. **Review.** Admin shows the rendered report next to an editor. Every edit goes through
   `save_report_draft` (an approved report returns to draft: approval is of the exact content).
6. **Approve + publish.** "Approve & publish" = `approve_report` (frozen) → the hosted side renders the PDF
   with headless Chromium, stores it, then `mark_report_published` (service role only) sets `published`
   and notifies the client's team (urgent: emailed at once). If rendering fails the report stays `approved`
   with `pdf_error`, and "Publish" retries. A published report never changes; a wrong one is voided.

## Content (schema.json)

```
title          product or project name, the cover title                       "FabricPort"
subtitle       "Release <n> — <themes>" or "<Month Year> — <themes>"           "Release 2 — Data Integrity, Imagery & Marketplace"
prepared_for   set by code                                                      "Prepared for the FabricPort team"
summary[]      2-4 paragraphs: what the period delivered; the material problems and that they are fixed; the visible improvements
kpis[]         ≤5 tiles {value, label}: "0" / "Ownership errors", "80%" / "Lighter first load"
measures[]     before/after rows {measure, before, after}: only when both values are known
sections[]     one per area of work {title, intro, callout {label, text} | null, rows[] {item, outcome, new}}
verification[] {claim, proof}: how each claim was proven (tests, measurements, sign-offs, comparisons)
outstanding[]  {item, action}: what is still open and who acts
```

The template numbers the sections: 1 Executive Summary, 2 <Release|Period> at a Glance, 3..n the work
sections, then Verification and Outstanding Items, and builds the Contents list from the same order.

## Writing rules (the house style)

- Plain, precise British English. Short declarative sentences. No marketing words, no flattery, no
  exclamation marks, no emoji, never "AI".
- Say what was wrong, what was done, how it was proven. Numbers beat adjectives.
- **Never invent** a number, a measurement, a supplier, a customer or an outcome. If a KPI or a before/after
  value isn't in the material, leave it out (empty lists are fine). The founder adds measurements in review.
- A callout labelled "Root cause" explains a defect in two to four sentences.
- Mark a row `new` only for a new capability (rendered as a small "New" tag).
- Refer to tickets (EL-12) only where it helps the client. Never paste raw commit text, hashes, file paths,
  branch names, credentials or internal tooling.
- Verification is the heart of the report: every claim the summary makes should have a row here.

## Editing by hand

The admin editor uses a line format that maps 1:1 to the schema (`platform/lib/report-text.ts`):

```
# Title
> Subtitle
@ Prepared for the Alpha Mills team

## Summary
First paragraph.

Second paragraph.

## KPIs
749 | Images restored

## Measures
Initial download (compressed) | 992 KB | 192 KB

## Section: Product Photography
Intro paragraph (optional).
! Root cause | The migration read the thumbnails folder.
Images restored | 749 of 1,190 replaced at full resolution
+ Zoom | Hover magnifier on product pages            (a leading "+ " marks the row New)

## Verification
Image restoration | Stored dimensions measured before and after

## Outstanding
Two fabrics without specifications | The supplier can add them
```

## Tests

`tests/test_platform_jobs.py` (gathering, untrusted wrapping, schema, notes stripped, schema copy in sync),
`tests/test_comms_billing_migration.py` (draft → approve → publish rules, PDF path, client visibility),
`platform/lib/report-*.test.ts` (template escaping, numbering, the text format round trip), and the golden
example `evals/platform/P02.json` (`python -m evals.run_platform_eval`, real model, run on purpose).
