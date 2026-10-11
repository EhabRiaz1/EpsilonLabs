import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // app/styles/ holds the approved design system copied verbatim; it is not linted or edited here.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "app/styles/**"]),
  // F11 narrowing: the service-role client is allowed ONLY in the public deal room and the invoice PDF code.
  {
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{ group: ["**/supabase/service"], message: "Service role: only app/client/p/** and lib/invoice-pdf.ts (see lib/supabase/service.ts)." }],
      }],
    },
  },
  { files: ["app/client/p/**", "lib/invoice-pdf.ts"], rules: { "no-restricted-imports": "off" } },
]);
