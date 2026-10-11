import { describe, expect, it } from "vitest";
import {
  ago, countdown, deckOrder, detailIssue, detailSummary, fmtAmount, fmtBytes, fmtDetail, isVerify, kindLabel, money, oppValue,
  pktMidnight, safeUrl, until, usagePct, usageTone, workerOnline,
} from "./admin-ops";
import { AGENT_CATALOG, agentRow, type CatalogEntry } from "./admin-agents";
import { formToSettings } from "./admin-settings";

const NOW = new Date("2026-10-12T06:00:00Z"); // 11:00 PKT

describe("formatting (data.py parity)", () => {
  it("ago", () => {
    expect(ago(null, NOW)).toBe("never");
    expect(ago("2026-10-12T05:59:55Z", NOW)).toBe("now");
    expect(ago("2026-10-12T05:59:15Z", NOW)).toBe("45s");
    expect(ago("2026-10-12T05:48:00Z", NOW)).toBe("12m");
    expect(ago("2026-10-12T02:55:00Z", NOW)).toBe("3h 05m");
    expect(ago("2026-10-12T03:00:00Z", NOW)).toBe("3h");
    expect(ago("2026-10-10T05:00:00Z", NOW)).toBe("2d");
  });
  it("pkt midnight", () => {
    expect(pktMidnight(NOW)).toBe("2026-10-11T19:00:00.000Z");
    expect(pktMidnight(NOW, 13)).toBe("2026-09-28T19:00:00.000Z");
  });
  it("money and amounts", () => {
    expect(money(7200)).toBe("$7,200");
    expect(money(18000)).toBe("$18.0k");
    expect(fmtAmount(2_500_000)).toBe("2.5M");
    expect(fmtAmount(3_000_000)).toBe("3M");
    expect(fmtAmount(45_000)).toBe("45k");
    expect(fmtAmount(900)).toBe("900");
    expect(oppValue({ value_min: null, value_max: null })).toBe("Not stated");
    expect(oppValue({ value_min: 50000, value_max: 50000, currency: "EUR" })).toBe("EUR 50k");
    expect(oppValue({ value_min: 10000, value_max: 2_000_000, currency: "USD" })).toBe("USD 10k-2M");
    expect(oppValue({ value_min: null, value_max: "12000", currency: "GBP" })).toBe("GBP 12k");
  });
  it("countdown", () => {
    expect(countdown(null, NOW)).toEqual(["No deadline stated", ""]);
    expect(countdown("2026-10-11T00:00:00Z", NOW)).toEqual(["Closed", "red"]);
    expect(countdown("2026-10-12T20:00:00Z", NOW)).toEqual(["Closes today", "red"]);
    expect(countdown("2026-10-15T07:00:00Z", NOW)).toEqual(["3d left", "red"]);
    expect(countdown("2026-10-19T07:00:00Z", NOW)).toEqual(["7d left", "amber"]);
    expect(countdown("2026-11-12T07:00:00Z", NOW)).toEqual(["31d left", ""]);
  });
  it("safeUrl", () => {
    expect(safeUrl("https://ted.europa.eu/x")).toBe("https://ted.europa.eu/x");
    expect(safeUrl("javascript:alert(1)")).toBe("");
    expect(safeUrl("https://a b")).toBe("");
    expect(safeUrl(null)).toBe("");
  });
  it("until", () => {
    expect(until("2026-10-12T06:00:30Z", NOW)).toBe("due now");
    expect(until("2026-10-12T09:12:00Z", NOW)).toBe("in 3h 12m");
    expect(until("2026-10-12T06:20:00Z", NOW)).toBe("in 20m");
    expect(until("2026-10-15T08:00:00Z", NOW)).toBe("in 3d 2h");
  });
});

describe("free-plan usage (F16)", () => {
  it("percent and tone with the 70% warning", () => {
    expect(usagePct(350 * 1024 ** 2, 500 * 1024 ** 2)).toBe(70);
    expect(usageTone(69.9)).toBe("good");
    expect(usageTone(70)).toBe("warn");
    expect(usageTone(90)).toBe("bad");
    expect(usagePct(5, 0)).toBe(0);
    expect(fmtBytes(14 * 1024 ** 2)).toBe("14.0 MB");
    expect(fmtBytes(1024 ** 3)).toBe("1.00 GB");
  });
});

describe("heartbeat details", () => {
  it("fmtDetail / summary / issue", () => {
    expect(fmtDetail({ sent: 3, failed: 0, errors: 1, error: "DBError" })).toEqual(["sent 3 · errors 1", "DBError"]);
    expect(fmtDetail(null)).toEqual(["", ""]);
    expect(detailSummary({ state: "done", run_id: "x", created: 4, ok: true, held: 1 })).toBe("done · created 4 · held 1");
    expect(detailIssue({ feeds: { ted: "ok", ungm: "failed: 503" } })).toBe("ungm: failed: 503");
  });
});

describe("approval queue helpers", () => {
  it("kind labels", () => {
    expect(kindLabel("outbound", 1)).toBe("Cold email");
    expect(kindLabel("outbound", null)).toBe("Cold email");
    expect(kindLabel("outbound", 2)).toBe("Follow-up 2");
    expect(kindLabel("reply", null)).toBe("Reply");
    expect(kindLabel("optout_confirm", null)).toBe("Opt-out confirmation");
  });
  it("deck order puts 'later' items last", () => {
    const rows = [
      { id: "a", created_at: "2026-10-12T01:00:00Z" },
      { id: "b", created_at: "2026-10-12T02:00:00Z" },
      { id: "c", created_at: "2026-10-12T03:00:00Z" },
    ];
    const later = new Map([["a", "2026-10-12T05:00:00Z"]]);
    expect(deckOrder(rows, later).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });
  it("isVerify and worker online", () => {
    expect(isVerify({ status: "sending", claimed_at: "2026-10-12T05:40:00Z" }, NOW)).toBe(true);
    expect(isVerify({ status: "sending", claimed_at: "2026-10-12T05:55:00Z" }, NOW)).toBe(false);
    expect(isVerify({ status: "failed", send_error: "unverified: check Sent folder" }, NOW)).toBe(true);
    expect(workerOnline("2026-10-12T05:59:00Z", NOW)).toBe(true);
    expect(workerOnline("2026-10-12T05:57:00Z", NOW)).toBe(false);
    expect(workerOnline(null, NOW)).toBe(false);
  });
});

describe("agent state (data.agents_overview)", () => {
  const find = (k: string) => AGENT_CATALOG.flatMap(([, a]) => a).find((a) => a.key === k) as CatalogEntry;
  const beat = (status: string, at: string) => ({ agent: "x", last_run: at, status, detail: {} });
  it("error is red, stale ok is overdue, warn is amber", () => {
    expect(agentRow(find("outbox"), [beat("error", "2026-10-12T05:59:00Z")], null, 0, NOW).state).toBe("red");
    const stale = agentRow(find("outbox"), [beat("ok", "2026-10-12T05:00:00Z")], null, 0, NOW);
    expect([stale.state, stale.text]).toEqual(["amber", "overdue"]);
    expect(agentRow(find("inbox"), [beat("warn", "2026-10-12T05:59:00Z")], null, 0, NOW).text).toBe("needs a look");
    expect(agentRow(find("inbox"), [beat("ok", "2026-10-12T05:59:00Z")], null, 0, NOW).text).toBe("healthy");
  });
  it("launchd facts from the worker snapshot", () => {
    expect(agentRow(find("prospector"), [], { loaded: false }, 0, NOW).text).toBe("not installed");
    expect(agentRow(find("prospector"), [], { loaded: true }, 0, NOW).text).toBe("not run yet");
    const r = agentRow(find("prospector"), [beat("ok", "2026-10-12T02:00:00Z")], { loaded: true, running: true }, 2, NOW);
    expect([r.text, r.runnable]).toEqual(["running now", false]);
    expect(agentRow(find("tenders"), [beat("ok", "2026-10-12T02:00:00Z")], { loaded: true }, 0, NOW).runnable).toBe(true);
    expect(agentRow(find("dashboard"), [], { loaded: true, running: true }, 0, NOW).text).toBe("running");
    expect(agentRow(find("dashboard"), [], null, 0, NOW).state).toBe("idle");
    expect(agentRow(find("followups"), [beat("ok", "2026-10-12T05:30:00Z")], { loaded: true, cadence: "every 5 min" }, 0, NOW).cadence).toBe("hourly, inside outreach");
  });
});

describe("settings form", () => {
  it("posts checkbox groups as lists, like the 8787 form", () => {
    const fd = new FormData();
    fd.append("$segments", "1");
    fd.append("$tenders", "1");
    fd.append("per_day", "40");
    fd.append("segments", "industrial");
    fd.append("segments", "smb_software");
    fd.append("paused", "on");
    expect(formToSettings(fd)).toEqual({ per_day: "40", segments: ["industrial", "smb_software"], paused: "on", tenders_sources: [] });
  });
});
