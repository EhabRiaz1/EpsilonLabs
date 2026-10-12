import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // app/styles/ holds the approved design system copied verbatim; it is not linted or edited here.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "app/styles/**"]),
  // F11 narrowing: the service-role client is allowed ONLY in the public deal room, the portal invite landing, the
  // invoice and report PDF code, the push sender (lib/push-send.ts) and the portal mailer (lib/digest-send.ts), both
  // behind bearer-secret routes (/api/cron/push, /api/cron/digest).
  {
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{ group: ["**/supabase/service"], message: "Service role: only app/client/p/**, app/client/invite/**, lib/invoice-pdf.ts, lib/report-pdf.ts, lib/push-send.ts and lib/digest-send.ts (see lib/supabase/service.ts)." }],
      }],
    },
  },
  { files: ["app/client/p/**", "app/client/invite/**", "lib/invoice-pdf.ts", "lib/report-pdf.ts", "lib/push-send.ts", "lib/digest-send.ts"], rules: { "no-restricted-imports": "off" } },
]);
