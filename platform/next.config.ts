import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // a stray lockfile in the home directory must not be taken as the workspace root
  turbopack: { root: process.cwd() },
  // F15: headless Chromium for invoice PDFs. Kept out of the bundle, and its compressed binary is traced into the
  // functions that render (the PDF downloads and the deal room's accept action).
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/client/invoices/*/pdf": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/admin/invoices/*/pdf": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/client/p/*": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
