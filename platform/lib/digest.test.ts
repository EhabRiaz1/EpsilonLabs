import { describe, expect, it } from "vitest";
import { groupByOrg, itemUrl, kindLabel, subjectFor, summarise, type MailItem, type MailJob } from "./digest";
import { notificationEmail } from "./mail-templates";

const item = (o: Partial<MailItem>): MailItem => ({ id: "1", kind: "ticket_status", title: "EL-4 · In progress: Sensor drift", link: "/tickets/abc", urgent: false, created_at: "2026-10-13T05:00:00Z", org_name: "Alpha Mills", ...o });

describe("digest grouping", () => {
  it("groups by organisation in first-seen order, urgent first then oldest", () => {
    const g = groupByOrg([
      item({ id: "a", created_at: "2026-10-13T06:00:00Z" }),
      item({ id: "b", org_name: "Beta Fuels" }),
      item({ id: "c", created_at: "2026-10-13T04:00:00Z" }),
      item({ id: "d", urgent: true, created_at: "2026-10-13T09:00:00Z" }),
      item({ id: "e", org_name: null }),
    ]);
    expect(g.map((x) => [x.org, x.items.map((i) => i.id)])).toEqual([
      ["Alpha Mills", ["d", "c", "a"]],
      ["Beta Fuels", ["b"]],
      ["Epsilon Labs", ["e"]],
    ]);
  });

  it("writes subjects for one item, several, urgent and the daily digest", () => {
    expect(subjectFor("immediate", [item({ title: "Invoice EL-2026-004 issued" })])).toBe("Invoice EL-2026-004 issued");
    expect(subjectFor("immediate", [item({}), item({ urgent: true })])).toBe("1 item needs your attention · Epsilon");
    expect(subjectFor("immediate", [item({}), item({})])).toBe("2 updates from Epsilon");
    expect(subjectFor("digest", [item({}), item({}), item({})])).toBe("Your Epsilon digest · 3 updates");
    expect(subjectFor("digest", [item({})])).toBe("Your Epsilon digest · 1 update");
  });

  it("only links to same-origin portal paths", () => {
    expect(itemUrl("https://client.epsilon-labs.co", "/invoices/x")).toBe("https://client.epsilon-labs.co/invoices/x");
    expect(itemUrl("https://client.epsilon-labs.co", "//evil.example")).toBe("https://client.epsilon-labs.co/");
    expect(itemUrl("https://client.epsilon-labs.co", "javascript:alert(1)")).toBe("https://client.epsilon-labs.co/");
    expect(itemUrl("https://client.epsilon-labs.co", null)).toBe("https://client.epsilon-labs.co/");
    expect(kindLabel("report")).toBe("Report");
    expect(kindLabel("weird")).toBe("Update");
  });

  it("summarises counts without addresses", () => {
    const jobs = [{ mode: "digest", items: [item({}), item({})] }, { mode: "immediate", items: [item({})] }] as MailJob[];
    expect(summarise(jobs)).toEqual({ emails: 2, items: 3, digests: 1 });
  });
});

describe("notification email", () => {
  it("brands the mail with the company footer, a text part and the preferences link", () => {
    const m = notificationEmail({ name: "Ayesha Khan", items: [item({ urgent: true, kind: "invoice", title: "Invoice EL-2026-004 issued", link: "/invoices/i1" })], mode: "immediate" });
    expect(m.subject).toBe("Invoice EL-2026-004 issued");
    expect(m.html).toContain(">ε</td>");
    expect(m.html).toContain("21-A Zahoor Afridi Rd., Cantt, Lahore");
    expect(m.html).toContain("Epsilon Labs AI Solutions (SMC-PVT) Ltd.");
    expect(m.html).toContain('href="https://client.epsilon-labs.co/account#email"');
    expect(m.html).toContain('href="https://client.epsilon-labs.co/invoices/i1"');
    expect(m.text).toContain("Hi Ayesha,");
    expect(m.text).toContain("https://client.epsilon-labs.co/invoices/i1");
    expect(m.text).toContain("Email preferences: https://client.epsilon-labs.co/account#email");
    expect(m.text).toContain("21-A Zahoor Afridi Rd., Cantt, Lahore");
  });

  it("escapes titles and org names and labels groups only for several orgs", () => {
    const m = notificationEmail({
      name: "",
      mode: "digest",
      timezone: "America/New_York",
      items: [item({ title: "<script>x</script> EL-9", org_name: "A & <B>" }), item({ id: "2", org_name: "Beta" })],
    });
    expect(m.html).not.toContain("<script>x");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("A &amp; &lt;B&gt;");
    expect(m.text).toContain("Hi,");
    expect(m.subject).toBe("Your Epsilon digest · 2 updates");
    expect(m.html).toContain("at most one digest a day");
    const one = notificationEmail({ name: "Bo", mode: "digest", items: [item({})] });
    expect(one.html).not.toContain("letter-spacing:.12em;text-transform:uppercase;color:#8a867f\">Alpha Mills");
  });

  it("survives an unknown timezone", () => {
    const m = notificationEmail({ name: "Bo", mode: "immediate", timezone: "Mars/Base", items: [item({})] });
    expect(m.html).toContain("EL-4");
  });
});
