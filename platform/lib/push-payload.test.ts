import { describe, expect, it } from "vitest";
import { buildPushPayload, isGoneStatus, pushOptions, safePath, urgentMailFields, type PushRow } from "./push-payload";

const row = (o: Partial<PushRow> = {}): PushRow => ({
  id: "11111111-1111-1111-1111-111111111111", title: "New ticket EL-52", body: "Open Tickets to triage it.",
  url: "/tickets/abc", kind: "ticket", urgent: false, ...o,
});

describe("buildPushPayload", () => {
  it("keeps exactly title, body, url and tag", () => {
    const p = buildPushPayload(row());
    expect(p).toEqual({ title: "New ticket EL-52", body: "Open Tickets to triage it.", url: "/tickets/abc", tag: "ticket:11111111-1111-1111-1111-111111111111" });
    expect(Object.keys(p).sort()).toEqual(["body", "tag", "title", "url"]);
  });

  it("drops extra fields a row might carry (E5: no client content)", () => {
    const p = buildPushPayload({ ...row(), user_id: "u", error: "x", draft: "secret client words" } as PushRow);
    expect(JSON.stringify(p)).not.toContain("secret client words");
    expect(JSON.stringify(p)).not.toContain("user_id");
  });

  it("clips title to 120 and body to 200 characters", () => {
    const p = buildPushPayload(row({ title: "t".repeat(500), body: "b".repeat(500) }));
    expect(p.title.length).toBe(120);
    expect(p.body?.length).toBe(200);
  });

  it("omits an empty body and never sends an empty title", () => {
    const p = buildPushPayload(row({ body: null, title: "   " }));
    expect(p.body).toBeUndefined();
    expect(p.title).toBe("Epsilon Admin");
  });

  it("coalesces drafts and agent errors under one tag", () => {
    expect(buildPushPayload(row({ kind: "draft" })).tag).toBe("draft");
    expect(buildPushPayload(row({ kind: "agent_error" })).tag).toBe("agent_error");
    expect(buildPushPayload(row({ kind: "weird" })).tag).toMatch(/^other:/);
  });
});

describe("safePath", () => {
  it("keeps same-origin paths", () => {
    for (const u of ["/", "/approvals", "/intake/0a1b-2c", "/settings?x=1"]) expect(safePath(u)).toBe(u);
  });
  it("forces everything else to /", () => {
    for (const u of [null, undefined, "", "approvals", "//evil.example/x", "https://evil.example", "javascript:alert(1)",
      "/a b", "/../etc", "/x\"onload", `/${"a".repeat(400)}`]) expect(safePath(u)).toBe("/");
  });
});

describe("pushOptions / isGoneStatus", () => {
  it("uses high urgency only for urgent rows, a day TTL", () => {
    expect(pushOptions({ urgent: true })).toEqual({ TTL: 86400, urgency: "high" });
    expect(pushOptions({ urgent: false }).urgency).toBe("normal");
  });
  it("treats 404 and 410 as an expired subscription", () => {
    expect(isGoneStatus(404)).toBe(true);
    expect(isGoneStatus(410)).toBe(true);
    for (const s of [undefined, 400, 401, 413, 429, 500]) expect(isGoneStatus(s)).toBe(false);
  });
});

describe("urgentMailFields", () => {
  it("links into admin with the same safe path and fixed words", () => {
    expect(urgentMailFields(row({ title: "Proposal accepted", body: "Deposit invoice is next.", url: "/proposals/x" }))).toEqual({
      subject: "Proposal accepted",
      lines: ["Deposit invoice is next.", "Also sent as a push notification to your devices."],
      link: "https://admin.epsilon-labs.co/proposals/x",
    });
    expect(urgentMailFields(row({ url: "https://evil.example" })).link).toBe("https://admin.epsilon-labs.co/");
  });
});
