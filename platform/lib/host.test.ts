import { describe, expect, it } from "vitest";
import { clientOrigin, internalPath, isPublicPath, publicUrl, siteFromHost } from "./host";

const prod = { dev: false };
const dev = { dev: true };

describe("siteFromHost", () => {
  it("routes the two production hostnames", () => {
    expect(siteFromHost("client.epsilon-labs.co", prod)).toBe("client");
    expect(siteFromHost("admin.epsilon-labs.co", prod)).toBe("admin");
    expect(siteFromHost("ADMIN.epsilon-labs.co:443", prod)).toBe("admin");
    expect(siteFromHost("client.epsilon-labs.co.", prod)).toBe("client");
  });

  it("404s every other host in production, and ignores dev overrides there", () => {
    expect(siteFromHost("epsilon-labs.co", prod)).toBeNull();
    expect(siteFromHost("admin.epsilon-labs.co.evil.com", prod)).toBeNull();
    expect(siteFromHost("client.localhost:3000", prod)).toBeNull();
    expect(siteFromHost("platform.vercel.app", { dev: false, override: "admin", remembered: "admin" })).toBeNull();
    expect(siteFromHost(null, prod)).toBeNull();
  });

  it("supports *.localhost and the ?host= override in dev", () => {
    expect(siteFromHost("client.localhost:3000", dev)).toBe("client");
    expect(siteFromHost("admin.localhost:3000", dev)).toBe("admin");
    expect(siteFromHost("localhost:3000", { dev: true, override: "admin" })).toBe("admin");
    expect(siteFromHost("localhost:3000", { dev: true, remembered: "client" })).toBe("client");
    expect(siteFromHost("localhost:3000", { dev: true, override: "client", remembered: "admin" })).toBe("client");
    expect(siteFromHost("localhost:3000", { dev: true, override: "root" })).toBeNull();
    expect(siteFromHost("localhost:3000", dev)).toBeNull();
  });

  it("never lets an override beat a real hostname", () => {
    expect(siteFromHost("client.epsilon-labs.co", { dev: true, override: "admin" })).toBe("client");
    expect(siteFromHost("client.localhost:3000", { dev: true, override: "admin" })).toBe("client");
  });
});

describe("internalPath", () => {
  it("maps public paths into the site's route tree", () => {
    expect(internalPath("client", "/")).toBe("/client");
    expect(internalPath("admin", "/mfa")).toBe("/admin/mfa");
    expect(internalPath("admin", "/login/sent")).toBe("/admin/login/sent");
  });

  it("cannot be used to reach the other site's tree", () => {
    expect(internalPath("client", "/admin")).toBe("/client/admin");
    expect(internalPath("client", "/admin/mfa")).toBe("/client/admin/mfa");
  });
});

describe("isPublicPath", () => {
  it("allows only sign-in and auth callback paths without a session", () => {
    for (const p of ["/login", "/login/sent", "/auth/confirm"]) expect(isPublicPath(p)).toBe(true);
    for (const p of ["/", "/mfa", "/loginx", "/projects"]) expect(isPublicPath(p)).toBe(false);
  });

  it("opens the deal room and the terms PDF on client.* only", () => {
    expect(isPublicPath("/p/abcDEF_123-xyz", "client")).toBe(true);
    expect(isPublicPath("/legal/T-2026-1.pdf", "client")).toBe(true);
    for (const p of ["/p/abc/extra", "/p/", "/legal/x.html", "/legal/../x.pdf", "/invoices/1/pdf"]) expect(isPublicPath(p, "client")).toBe(false);
    expect(isPublicPath("/p/abc", "admin")).toBe(false);
    expect(isPublicPath("/legal/T-2026-1.pdf", "admin")).toBe(false);
  });

  it("opens the admin PWA shell and the push sender on admin.* only", () => {
    for (const p of ["/manifest.webmanifest", "/sw.js", "/offline.html", "/icons/icon-192.png", "/icons/maskable-512.png", "/api/cron/push"]) {
      expect(isPublicPath(p, "admin")).toBe(true);
      expect(isPublicPath(p, "client")).toBe(false);
    }
    for (const p of ["/api/cron/push/x", "/api/cron", "/icons/../sw.js", "/icons/x.svg", "/icons/a/b.png", "/approvals", "/settings"]) {
      expect(isPublicPath(p, "admin")).toBe(false);
    }
  });

  it("opens a portal invite link on client.* only, and nothing else in the portal", () => {
    expect(isPublicPath("/invite/abcDEF_123-xyz", "client")).toBe(true);
    for (const p of ["/invite/a/b", "/invite/", "/tickets/1", "/files/1", "/account"]) expect(isPublicPath(p, "client")).toBe(false);
    expect(isPublicPath("/invite/abc", "admin")).toBe(false);
  });
});

describe("publicUrl", () => {
  it("keeps the subdomain the browser used", () => {
    expect(publicUrl("/login", { host: "admin.localhost:3000" }, "http:").href).toBe("http://admin.localhost:3000/login");
    expect(publicUrl("/mfa", { host: "internal:3000", forwardedHost: "admin.epsilon-labs.co", forwardedProto: "https" }, "http:").href)
      .toBe("https://admin.epsilon-labs.co/mfa");
  });
});

describe("clientOrigin", () => {
  it("maps admin.* to the matching client.* origin", () => {
    expect(clientOrigin({ host: "admin.epsilon-labs.co" })).toBe("https://client.epsilon-labs.co");
    expect(clientOrigin({ host: "admin.localhost:3000" })).toBe("http://client.localhost:3000");
    expect(clientOrigin({ host: "x.vercel.app" })).toBe("https://client.epsilon-labs.co");
  });
});
