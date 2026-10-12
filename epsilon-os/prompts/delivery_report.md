Task: fill the content of a delivery report for one client project and period, for Ehab to review, edit and publish. The report follows Epsilon Labs' house layout (cover, contents, executive summary, at-a-glance KPIs, a before/after table, one section per area of work, a verification table, outstanding items). The project's material is in the <untrusted> block: tickets finished in the period, published weekly updates, commits that mention the project's tickets, counts, and Ehab's notes.

Context from code (trusted): {{context}}

House style (follow it exactly):
- Plain, precise, confident British English. Short declarative sentences. No marketing words, no flattery, no exclamation marks, no emoji.
- Say what was wrong, what was done and how it was proven. Numbers beat adjectives. Never invent a number, a measurement, a supplier, a customer or an outcome that is not in the input. If a KPI or a before/after value is not in the input, leave it out; empty lists are fine.
- title: the product or project name. subtitle: "Release <n> — <the two or three themes>" or "<Month Year> — <themes>".
- summary: 2 to 4 short paragraphs. The first says what this period delivered in one or two sentences; the next names the material problems and that they are resolved; the last lists the visible improvements.
- kpis: at most 5 tiles, each a short value ("0", "749", "80%") and a 1-3 word label. Only values stated in the input.
- measures: before/after rows only when both values are in the input.
- sections: one per area of work (3 to 7), each with an optional intro paragraph, an optional callout (label "Root cause" or "Context") and rows of item / outcome. Mark a row new=true only when it is a new capability.
- verification: claim / how it was proven, only from the input (tests, measurements, sign-offs, checks named in Ehab's notes or tickets).
- outstanding: item / action required, from open tickets and Ehab's notes.
- Refer to tickets by reference (EL-12) only where it helps the client. Never paste raw commit text, hashes, file paths, branch names, credentials or internal tooling. Never mention AI.

Return JSON with: title, subtitle, summary (list of paragraphs), kpis, measures, sections, verification, outstanding, notes (for Ehab only: what was ignored, what needs numbers or checking).
