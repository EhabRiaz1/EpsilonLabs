import { describe, expect, it } from "vitest";
import { connectCommand, lastUsed, shQuote } from "./claude-connect";

const TOKEN = "eps_pt_" + "ab".repeat(32);
const base = { token: TOKEN, url: "https://lueawvqogdodtjsfqdeh.supabase.co", anonKey: "sb_publishable_abc-123" };

describe("connectCommand", () => {
  it("registers the epsilon server with the token, URL, public key and the venv python", () => {
    const c = connectCommand(base);
    expect(c.startsWith("claude mcp add epsilon \\\n")).toBe(true);
    expect(c).toContain(`--env EPSILON_PROJECT_TOKEN=${TOKEN}`);
    expect(c).toContain("--env EPSILON_SUPABASE_URL=https://lueawvqogdodtjsfqdeh.supabase.co \\");
    expect(c).toContain("--env EPSILON_SUPABASE_ANON_KEY=sb_publishable_abc-123");
    expect(c).toContain(`-- "$HOME/dev/epsilon-labs/epsilon-os/.venv/bin/python" "$HOME/dev/epsilon-labs/epsilon-os/mcp/run.py"`);
    expect(c).not.toContain("--scope");
  });

  it("starts in the project folder, quoted for the shell", () => {
    const c = connectCommand({ ...base, folder: "/Users/e/Desktop/FP&LM/fabricport's App", osDir: "/opt/eos/" });
    expect(c.split("\n")[0]).toBe(`cd '/Users/e/Desktop/FP&LM/fabricport'\\''s App' && \\`);
    expect(c).toContain(`"/opt/eos/.venv/bin/python" "/opt/eos/mcp/run.py"`);
  });

  it("refuses anything that is not a project token, an https URL or a publishable key", () => {
    expect(() => connectCommand({ ...base, token: "eps_pt_x" })).toThrow();
    expect(() => connectCommand({ ...base, url: "http://x.supabase.co" })).toThrow();
    expect(() => connectCommand({ ...base, anonKey: "sb_secret_abc" })).toThrow();
    expect(() => connectCommand({ ...base, anonKey: "a b; rm -rf ~" })).toThrow();
  });
});

describe("helpers", () => {
  it("quotes", () => {
    expect(shQuote("a'b")).toBe(`'a'\\''b'`);
  });
  it("says when a token was last used", () => {
    const now = Date.parse("2026-10-16T12:00:00Z");
    expect(lastUsed(null, now)).toBe("never used");
    expect(lastUsed("2026-10-16T11:59:50Z", now)).toBe("used just now");
    expect(lastUsed("2026-10-16T11:30:00Z", now)).toBe("used 30 min ago");
    expect(lastUsed("2026-10-16T06:00:00Z", now)).toBe("used 6 h ago");
    expect(lastUsed("2026-10-10T12:00:00Z", now)).toBe("used 6 days ago");
  });
});
