// "Copy for website" (E4): a snippet the founder pastes into the site source by hand. Nothing edits epsilon-labs.co
// automatically (tools/offers.py and the scaffold stay the founder's). Pure (unit-tested).
import { esc } from "./html";

export type Testimonial = { quote: string; author_name: string; author_role: string; org_name: string };

/** The attribution line: "Ayesha Khan, Plant manager, Alpha Mills". */
export function attribution(t: Testimonial): string {
  return [t.author_name, t.author_role, t.org_name].map((x) => x.trim()).filter(Boolean).join(", ");
}

/** An HTML <figure> (escaped) plus a plain-text version, ready to paste. */
export function websiteSnippet(t: Testimonial): { html: string; text: string } {
  const q = t.quote.replace(/\s+/g, " ").trim().replace(/^["“]|["”]$/g, "");
  return {
    html: `<figure class="testimonial">\n  <blockquote>“${esc(q)}”</blockquote>\n  <figcaption>${esc(attribution(t))}</figcaption>\n</figure>`,
    text: `“${q}” — ${attribution(t)}`,
  };
}
