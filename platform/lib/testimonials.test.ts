import { describe, expect, it } from "vitest";
import { attribution, websiteSnippet } from "./testimonials";

describe("testimonial snippet", () => {
  it("builds an escaped figure and a text line", () => {
    const s = websiteSnippet({ quote: ' "Epsilon fixed our <plant> data\n in two weeks." ', author_name: "Ayesha Khan", author_role: "Plant manager", org_name: "Alpha & Co" });
    expect(s.html).toBe('<figure class="testimonial">\n  <blockquote>“Epsilon fixed our &lt;plant&gt; data in two weeks.”</blockquote>\n  <figcaption>Ayesha Khan, Plant manager, Alpha &amp; Co</figcaption>\n</figure>');
    expect(s.text).toBe("“Epsilon fixed our <plant> data in two weeks.” — Ayesha Khan, Plant manager, Alpha & Co");
    expect(attribution({ quote: "", author_name: "Bo", author_role: " ", org_name: "Beta" })).toBe("Bo, Beta");
  });
});
