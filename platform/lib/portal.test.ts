import { describe, expect, it } from "vitest";
import { clientStatus, composeBody, isOpen, relativeDay, staffStatus, STATUSES } from "./tickets";
import { MAX_UPLOAD_BYTES, prettySize, uploadCheck } from "./files";
import { SLUG_RE, slugify } from "./slug";
import { answerLines, proposalPrefill } from "./intake";
import { pickOrg } from "./org-choice";
import { inviteUrl, newInviteToken } from "./invites";
import { sha256Hex, TOKEN_RE } from "./tokens";
import { inviteEmail } from "./mail-templates";

describe("tickets", () => {
  it("labels every status for clients and staff", () => {
    for (const s of STATUSES) {
      expect(clientStatus(s).label).not.toBe(s);
      expect(staffStatus(s).label).not.toBe(s);
    }
    expect(clientStatus("review")).toEqual({ label: "Needs your review", tone: "pill-warn" });
    expect(clientStatus("briefed").label).toBe("Triaged");   // the client sees status only
    expect(isOpen("done") || isOpen("declined")).toBe(false);
    expect(isOpen("review")).toBe(true);
  });
  it("composes the body with an optional where line", () => {
    expect(composeBody(" It crashes. ", "")).toBe("It crashes.");
    expect(composeBody("It crashes.", " Login   screen ")).toBe("It crashes.\n\nWhere: Login screen");
    expect(composeBody("", "Dealer app")).toBe("Where: Dealer app");
  });
  it("relative day in PKT", () => {
    const now = new Date("2026-10-12T09:00:00Z"); // Mon 14:00 PKT
    expect(relativeDay("2026-10-12T06:30:00Z", now)).toBe("11:30");
    expect(relativeDay("2026-10-11T06:30:00Z", now)).toBe("Yesterday");
    expect(relativeDay("2026-10-08T06:30:00Z", now)).toBe("Thu");
    expect(relativeDay("2026-09-30T06:30:00Z", now)).toMatch(/^30 Sep/);
  });
});

describe("files", () => {
  it("decides the MIME type from the extension and enforces the cap", () => {
    expect(uploadCheck("Board.ZIP", 10)).toEqual({ ok: true, mime: "application/zip" });
    expect(uploadCheck("part.step", 10)).toEqual({ ok: true, mime: "model/step" });
    expect(uploadCheck("photo.jpeg", 10)).toEqual({ ok: true, mime: "image/jpeg" });
    expect(uploadCheck("run.exe", 10).ok).toBe(false);
    expect(uploadCheck("noext", 10).ok).toBe(false);
    expect(uploadCheck("a.pdf", 0).ok).toBe(false);
    expect(uploadCheck("a.pdf", MAX_UPLOAD_BYTES).ok).toBe(true);
    expect(uploadCheck("a.pdf", MAX_UPLOAD_BYTES + 1).ok).toBe(false);
  });
  it("prints sizes", () => {
    expect(prettySize(900)).toBe("900 B");
    expect(prettySize(24 * 1024)).toBe("24 KB");
    expect(prettySize(1.8 * 1024 * 1024)).toBe("1.8 MB");
  });
});

describe("slugify", () => {
  it("makes slugs the database accepts", () => {
    expect(slugify("Master Paints (Pvt) Ltd.")).toBe("master-paints-pvt-ltd");
    expect(slugify("Ålesund Fisk & Co")).toBe("alesund-fisk-co");
    expect(SLUG_RE.test(slugify("x".repeat(80) + " y"))).toBe(true);
    expect(slugify("!!!")).toBe("");
  });
});

describe("intake prefill", () => {
  const row = {
    id: "i", name: "Jonas Weber", email: "jonas@northwind.example", company: "Northwind", kind: "hardware", budget: "$10k – $50k",
    message: "Twelve machines.", answers: { need: "A machine nobody can read", offer_name: "Protocol Decode Sprint", when: "This quarter", offer: "/x/" },
  };
  it("orders the answers and drafts the proposal fields", () => {
    expect(answerLines(row.answers)).toEqual([["The work", "A machine nobody can read"], ["Maps to", "Protocol Decode Sprint"], ["Timing", "This quarter"]]);
    const p = proposalPrefill(row);
    expect(p).toMatchObject({ title: "Protocol Decode Sprint", client_company: "Northwind", contact_name: "Jonas Weber", contact_email: "jonas@northwind.example" });
    expect(p.summary).toContain("Twelve machines.\nThe work: A machine nobody can read");
    expect(p.summary).toContain("Budget band: $10k – $50k");
    expect(proposalPrefill({ ...row, company: null, answers: {} }).client_company).toBe("Jonas Weber");
  });
});

describe("org choice and invites", () => {
  const ms = [{ orgId: "a" }, { orgId: "b" }];
  it("picks the wanted org only if the user is a member", () => {
    expect(pickOrg(ms, "b")).toEqual({ orgId: "b" });
    expect(pickOrg(ms, "zzz")).toEqual({ orgId: "a" });
    expect(pickOrg([], "a")).toBeNull();
  });
  it("invite tokens are link-safe and stored only as a hash", () => {
    const { token, hash } = newInviteToken();
    expect(TOKEN_RE.test(token)).toBe(true);
    expect(hash).toBe(sha256Hex(token));
    expect(newInviteToken().token).not.toBe(token);
    expect(inviteUrl("https://client.epsilon-labs.co/", token)).toBe(`https://client.epsilon-labs.co/invite/${token}`);
  });
  it("invite email escapes names", () => {
    const m = inviteEmail({ orgName: "A&B <x>", inviter: "Ayesha", link: "https://client.epsilon-labs.co/invite/t", expiresOn: "19 Oct 2026", role: "member" });
    expect(m.subject).toBe("Ayesha invited you to the A&B <x> portal");
    expect(m.html).toContain("A&amp;B &lt;x&gt;");
    expect(m.text).toContain("https://client.epsilon-labs.co/invite/t");
  });
});
