import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // app/styles/ holds the approved design system copied verbatim; it is not linted or edited here.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "app/styles/**"]),
  // F11 narrowing: the service-role client is allowed ONLY in the public deal room, the portal invite landing, the
  // invoice PDF code and the push sender (lib/push-send.ts, behind the bearer-secret route /api/cron/push).
  {
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{ group: ["**/supabase/service"], message: "Service role: only app/client/p/**, app/client/invite/**, lib/invoice-pdf.ts and lib/push-send.ts (see lib/supabase/service.ts)." }],
      }],
    },
  },
  { files: ["app/client/p/**", "app/client/invite/**", "lib/invoice-pdf.ts", "lib/push-send.ts"], rules: { "no-restricted-imports": "off" } },
]);
