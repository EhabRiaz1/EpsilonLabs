import { describe, expect, it } from "vitest";
import { acceptCodeEmail, founderNotice, portalReadyEmail, proposalLinkEmail } from "./mail-templates";

describe("mail templates", () => {
  it("puts the code in subject, html and text", () => {
    const m = acceptCodeEmail({ code: "482701", title: "Plant Visibility Pilot", minutes: 10 });
    expect(m.subject).toBe('482 701 is your code to accept "Plant Visibility Pilot"');
    expect(m.html).toContain("482 701");
    expect(m.text).toContain("expires in 10 minutes");
  });

  it("escapes everything a client or the founder typed", () => {
    const m = proposalLinkEmail({ contactName: "<b>Jonas</b> Weber", title: 'A "quoted" <title>', link: "https://client.epsilon-labs.co/p/abc", validUntil: "25 Oct 2026", version: 2 });
    expect(m.html).not.toContain("<b>Jonas</b>");
    expect(m.html).toContain("&lt;title&gt;");
    expect(m.html).toContain('href="https://client.epsilon-labs.co/p/abc"');
    expect(m.subject).toContain("(version 2)");
    const n = founderNotice({ subject: "Accepted", lines: ["<script>x</script>"] });
    expect(n.html).not.toContain("<script>x");
  });

  it("brands every mail with the mark and the footer", () => {
    const m = portalReadyEmail({ contactName: "Jonas", company: "Northwind", loginUrl: "https://client.epsilon-labs.co/login", invoiceNumber: "EL-2026-004", invoiceAmount: "$7,200.00" });
    expect(m.html).toContain(">ε</td>");
    expect(m.html).toContain("notifications@epsilon-labs.co");
    expect(m.text).toContain("EL-2026-004");
  });
});
