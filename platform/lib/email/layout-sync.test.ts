// The site's Vercel function uses api/_email-layout.js, a generated CommonJS copy of layout-core.mjs (the site deploy
// excludes platform/). This fails when the copy is stale: run `node tools/build-email-layout.mjs` and commit it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { build, SOURCE, TARGET } from "../../../tools/build-email-layout.mjs";
import siteJs from "../../../api/_email-layout.js";
import { esc as htmlEsc } from "../html";
import * as core from "./layout-core.mjs";

const site = siteJs as unknown as typeof core;

describe("email layout single source", () => {
  it("api/_email-layout.js is the current build of layout-core.mjs", () => {
    expect(readFileSync(TARGET, "utf8")).toBe(build(readFileSync(SOURCE, "utf8")));
  });

  it("the CommonJS copy renders exactly what the source renders", () => {
    const o = { label: "Enquiry", preheader: "p <x>", why: "why & how", prefsUrl: "https://x/#e", year: 2026, body: core.kv([["a", "<b>"]]) + core.button("https://x/?a=1&b=2", "Go") };
    expect(site.layout(o)).toBe(core.layout(o));
    expect(Object.keys(site).sort()).toEqual(Object.keys(core).sort());
  });

  it("escapes exactly like lib/html esc", () => {
    for (const s of [`<a href="x">'&'</a>`, null, undefined, 0, "plain", "{{ .ConfirmationURL }}"]) {
      expect(core.esc(s)).toBe(htmlEsc(s));
    }
  });

  it("keeps Supabase template placeholders intact", () => {
    const html = core.button("{{ .ConfirmationURL }}", "Sign in") + core.codeBlock("{{ .Token }}", "x");
    expect(html).toContain('href="{{ .ConfirmationURL }}"');
    expect(html).toContain(">{{ .Token }}</div>");
  });
});
