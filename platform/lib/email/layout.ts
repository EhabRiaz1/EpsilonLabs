// The branded email layout and blocks for the Next app. The source is layout-core.mjs (dependency-free, so the site's
// Vercel function gets a generated CommonJS copy, api/_email-layout.js, and the Supabase auth templates are rendered
// from it too). Types come from its JSDoc. See layout-core.mjs for the escaping rule.
export {
  ASSET,
  COMPANY_LINE,
  CONTACT,
  PORTAL_URL,
  SITE_URL,
  button,
  codeBlock,
  email,
  esc,
  eyebrow,
  h1,
  items,
  kv,
  layout,
  linkBox,
  mono,
  money,
  note,
  p,
  pill,
  quote,
  signature,
  small,
  steps,
  strong,
  subhead,
  text,
} from "./layout-core.mjs";
export type { Item, KvValue } from "./layout-core.mjs";

export type Mail = { subject: string; html: string; text: string };
