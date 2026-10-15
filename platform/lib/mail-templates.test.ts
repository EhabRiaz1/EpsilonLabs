import { describe, expect, it } from "vitest";
import { ASSET, COMPANY_LINE } from "./email/layout";
import type { MailItem } from "./digest";
import {
  acceptCodeEmail,
  founderNotice,
  inviteEmail,
  notificationEmail,
  portalReadyEmail,
  proposalLinkEmail,
  type Mail,
} from "./mail-templates";

const EVIL = `<img src=x onerror="alert(1)">`;
const item = (o: Partial<MailItem>): MailItem => ({ id: "1", kind: "reply", title: "EL-21 · Supplier CSV import", link: "/tickets/t1", urgent: false, created_at: "2026-10-14T13:40:00Z", org_name: "FabricPort", ...o });

/** Every template, once with ordinary values and once with markup in every field a person could have typed. */
function all(v: string): Record<string, Mail> {
  return {
    acceptCode: acceptCodeEmail({ code: "482701", title: `Pilot ${v}`, minutes: 10 }),
    proposal: proposalLinkEmail({ contactName: `Tom ${v}`, title: `Decode ${v}`, link: "https://client.epsilon-labs.co/p/abc", validUntil: `29 Oct ${v}`, version: 2 }),
    portalReady: portalReadyEmail({ contactName: `Tom ${v}`, company: `Cardog ${v}`, loginUrl: "https://client.epsilon-labs.co/login", invoiceNumber: `EL-2026-004 ${v}`, invoiceAmount: "USD 3,000.00" }),
    founder: founderNotice({ subject: `Accepted ${v}`, lines: [`Line ${v}`], link: "https://admin.epsilon-labs.co/proposals/x" }),
    invite: inviteEmail({ orgName: `FabricPort ${v}`, inviter: `Ehab ${v}`, link: "https://client.epsilon-labs.co/invite/t", expiresOn: `22 Oct ${v}`, role: "member" }),
    immediate: notificationEmail({ name: `Omar ${v}`, mode: "immediate", items: [item({ title: `EL-22 ${v}`, org_name: `Fabric ${v}`, urgent: true })] }),
    digest: notificationEmail({ name: `Omar ${v}`, mode: "digest", items: [item({ title: `EL-22 ${v}`, org_name: `A ${v}` }), item({ id: "2", org_name: "Beta" })] }),
  };
}

describe("mail templates", () => {
  it("puts the code in subject, html and text", () => {
    const m = acceptCodeEmail({ code: "482701", title: "Plant Visibility Pilot", minutes: 10 });
    expect(m.subject).toBe('482 701 is your code to accept "Plant Visibility Pilot"');
    expect(m.html).toContain("482 701"); // the preheader
    expect(m.html).toContain(">482701</div>"); // the code block
    expect(m.html).toContain(">Verification</td>");
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

  it("never lets typed markup through, in any template", () => {
    for (const [name, m] of Object.entries(all(EVIL))) {
      expect(m.html, name).not.toContain(EVIL);
      expect(m.html, name).not.toContain("<img src=x");
      expect(m.html, name).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    }
  });

  it("brands every mail: logo with alt, header label, preheader, legal line, text part", () => {
    for (const [name, m] of Object.entries(all("x"))) {
      expect(m.html, name).toContain(`<img src="${ASSET}logo-white@2x.png" width="129" height="20" alt="Epsilon Labs"`);
      expect(m.html, name).toContain(`src="${ASSET}logo-ink@2x.png"`);
      expect(m.html, name).toMatch(/<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">[^<&]+&#847;/);
      expect(m.html, name).toContain(COMPANY_LINE);
      expect(m.html, name).toContain('<meta name="color-scheme" content="light dark">');
      if (name !== "acceptCode") expect(m.html, name).toContain("<!--[if mso]><v:roundrect"); // Outlook-safe button
      expect(m.text, name).toContain(COMPANY_LINE); // a plain-text part with the legal line
      expect(m.text, name).not.toMatch(/<[a-z]/i);
    }
    expect(COMPANY_LINE).toBe("Epsilon Labs AI Solutions (SMC-PVT) Ltd. · SECP CUIN 0290150 · 21-A Zahoor Afridi Rd., Cantt, Lahore, Pakistan");
  });

  it("labels the header band by kind of mail", () => {
    const m = all("x");
    const label = (x: Mail) => /color:#F0B98E;white-space:nowrap">([^<]+)<\/td>/.exec(x.html)?.[1];
    expect(label(m.acceptCode)).toBe("Verification");
    expect(label(m.proposal)).toBe("Proposal");
    expect(label(m.portalReady)).toBe("Client portal");
    expect(label(m.invite)).toBe("Client portal");
    expect(label(m.immediate)).toBe("Notification");
    expect(label(m.digest)).toBe("Daily digest");
    expect(label(m.founder)).toBe("Notice");
  });

  it("links email preferences only for portal notifications", () => {
    const m = all("x");
    for (const k of ["immediate", "digest"]) {
      expect(m[k].html).toContain('href="https://client.epsilon-labs.co/account#email"');
      expect(m[k].text).toContain("Email preferences: https://client.epsilon-labs.co/account#email");
    }
    for (const k of ["acceptCode", "proposal", "portalReady", "founder", "invite"]) {
      expect(m[k].html, k).not.toContain("Email preferences");
      expect(m[k].text, k).not.toContain("Email preferences");
    }
  });

  it("shows the invoice amount with greyed decimals", () => {
    const m = portalReadyEmail({ contactName: "Jonas", company: "Northwind", loginUrl: "https://client.epsilon-labs.co/login", invoiceNumber: "EL-2026-004", invoiceAmount: "$7,200.00" });
    expect(m.html).toContain('$7,200<span class="faint" style="color:#8A8F92">.00</span>');
    expect(m.text).toContain("EL-2026-004");
  });
});
