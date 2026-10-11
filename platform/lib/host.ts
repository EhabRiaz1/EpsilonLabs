// Host-based routing (EN1). One app, two hostnames: the Host header picks the route tree.
// Pure functions so they can be unit-tested without Next.

export type Site = "client" | "admin";

export const SITE_HOSTS: Readonly<Record<string, Site>> = {
  "client.epsilon-labs.co": "client",
  "admin.epsilon-labs.co": "admin",
};

const DEV_HOSTS: Readonly<Record<string, Site>> = {
  "client.localhost": "client",
  "admin.localhost": "admin",
};

/** Cookie that remembers a `?host=` override between requests on a shared dev/preview host. */
export const DEV_SITE_COOKIE = "eps-dev-site";

export function isSite(v: unknown): v is Site {
  return v === "client" || v === "admin";
}

/**
 * Which site a request belongs to, or null (404).
 * `dev` enables client.localhost / admin.localhost and the `?host=client|admin` override; it is never on in
 * production, so a production request can only reach a site through its real hostname.
 */
export function siteFromHost(
  host: string | null | undefined,
  opts: { dev: boolean; override?: string | null; remembered?: string | null },
): Site | null {
  const h = (host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  const prod = SITE_HOSTS[h];
  if (prod) return prod;
  if (!opts.dev) return null;
  const dev = DEV_HOSTS[h];
  if (dev) return dev;
  if (isSite(opts.override)) return opts.override;
  if (isSite(opts.remembered)) return opts.remembered;
  return null;
}

/** The internal route for a public path: "/" on admin.* is served by app/admin, and so on. */
export function internalPath(site: Site, pathname: string): string {
  const p = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return p === "/" ? `/${site}` : `/${site}${p}`;
}

/**
 * Paths reachable without a session. Everything else redirects to /login. On client.* the deal room (/p/<token>),
 * a portal invite (/invite/<token>; in both the token is the credential) and the published contract terms
 * (/legal/*.pdf) are public too. On admin.* the PWA shell (manifest, service worker, offline page, icons: static
 * files with no data) and the push sender (/api/cron/push, which checks its own bearer secret) are public.
 */
export function isPublicPath(pathname: string, site?: Site): boolean {
  if (pathname === "/login" || pathname.startsWith("/login/") || pathname.startsWith("/auth/")) return true;
  if (site === "admin") {
    return (
      ADMIN_PUBLIC.has(pathname) || /^\/icons\/[A-Za-z0-9-]+\.png$/.test(pathname)
    );
  }
  return (
    site === "client" &&
    (/^\/p\/[^/]+$/.test(pathname) || /^\/invite\/[^/]+$/.test(pathname) || /^\/legal\/[A-Za-z0-9._-]+\.pdf$/.test(pathname))
  );
}

const ADMIN_PUBLIC: ReadonlySet<string> = new Set(["/manifest.webmanifest", "/sw.js", "/offline.html", "/api/cron/push"]);

/** The client.* origin that matches an admin.* request (links admin sends to prospects). */
export function clientOrigin(h: { host?: string | null; forwardedHost?: string | null; forwardedProto?: string | null }): string {
  const host = (h.forwardedHost || h.host || "").toLowerCase();
  const dev = /^admin\.localhost(:\d+)?$/.exec(host);
  if (dev) return `${h.forwardedProto || "http"}://client.localhost${dev[1] ?? ""}`;
  return "https://client.epsilon-labs.co";
}

/**
 * Absolute URL on the host the browser actually used. Inside the proxy and after its rewrite, nextUrl can carry
 * the server's bind host (e.g. "localhost") instead of client.* / admin.*, so redirects are built from Host.
 */
export function publicUrl(path: string, h: { host?: string | null; forwardedHost?: string | null; forwardedProto?: string | null }, fallbackProto: string): URL {
  const host = h.forwardedHost || h.host || "localhost";
  const proto = (h.forwardedProto || fallbackProto).replace(/:$/, "");
  return new URL(path, `${proto}://${host}`);
}
