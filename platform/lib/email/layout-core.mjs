// The Epsilon email layout and blocks: the ONE source for every branded email (portal, site enquiry, Supabase auth).
// Ported from the approved mockups (designs/admin-v3-20261015/email/build.py). Pure, dependency-free ES module:
//  - platform/lib/email/layout.ts re-exports it, typed, for the Next app;
//  - tools/build-email-layout.mjs turns it into api/_email-layout.js (CommonJS) for the site's Vercel function;
//  - epsilon-os/scripts/sb_auth_templates.py renders the Supabase auth templates from it with node.
// Keep it free of imports and of `export default`: the CommonJS build is a plain text transform.
//
// Email-client safe: table layout, inline styles, 600 px, bulletproof buttons (VML for Outlook), light + dark.
// Escaping rule: blocks that take TEXT escape it; parameters named `html` (and p/small/note bodies) are HTML the
// caller has already built with esc(). Everything a person typed must go through esc() or a text parameter.

export const PAPER = "#F4F4F4";
export const CARD = "#FFFFFF";
export const INK = "#0A0A0A";
export const BODY = "#2B2B2B";
export const MUTED = "#5E5E5E";
export const RULE = "#E4E4E4";
/** Monochrome (founder, 2026-10-15): the action colour is ink; the names stay so the blocks read the same. */
export const COPPER = "#0A0A0A";
export const COPPER_LIFT = "#A3A3A3";
export const SIGNAL = "#0A0A0A";
export const TINT = "#F7F7F7";
export const FAINT = "#9A9A9A";
export const SANS = "'Instrument Sans','Helvetica Neue',Helvetica,Arial,sans-serif";
export const MONO = "'IBM Plex Mono',ui-monospace,'SF Mono',Menlo,Consolas,monospace";

/** The full legal line, in every footer (HTML and text). */
export const COMPANY_LINE =
  "Epsilon Labs AI Solutions (SMC-PVT) Ltd. · SECP CUIN 0290150 · 21-A Zahoor Afridi Rd., Cantt, Lahore, Pakistan";
/** Logo PNGs and web fonts, served by the site deploy from assets/brand/email/. */
export const ASSET = "https://www.epsilon-labs.co/assets/brand/email/";
/** The lockup (ε mark + EPSILON LABS), rendered at 4x. Platform and site mail embed them inline (cid) at send time. */
export const LOGO_WHITE = `${ASSET}logo-white@4x.png`;
export const LOGO_BLACK = `${ASSET}logo-black@4x.png`;
/** White lockup on its own black badge: mail apps recolour backgrounds (forced dark mode, stripped styles) but never
 * images, so the badge stays legible whatever happens to the band behind it. Used in the header and footer. */
export const LOGO_BADGE = `${ASSET}logo-badge@4x.png`;
export const SITE_URL = "https://epsilon-labs.co";
export const PORTAL_URL = "https://client.epsilon-labs.co";
export const CONTACT = "er@epsilon-labs.co";

/**
 * HTML-escape anything (same rules as platform/lib/html.ts `esc`; a test keeps them identical).
 * @param {unknown} s
 * @returns {string}
 */
export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ------------------------------------------------------------------------------------------------------------ layout

/**
 * @param {string} k
 * @param {string} v
 * @param {string} href
 */
function footCol(k, v, href) {
  return (
    `<td class="stack" valign="top" width="33%" style="padding:0 12px 20px 0">` +
    `<div class="muted" style="font:500 10px/1 ${MONO};letter-spacing:.14em;text-transform:uppercase;color:${MUTED};padding-bottom:7px">${esc(k)}</div>` +
    `<a href="${esc(href)}" class="ink" style="font:500 13px/1.4 ${SANS};color:${INK};text-decoration:none">${esc(v)}</a></td>`
  );
}

/**
 * The whole email: black header band (white lockup + mono label), white body card, light-grey footer
 * (lockup, portal / website / contact, why-you-got-this, preferences link, legal line).
 * @param {{ label: string, preheader: string, body: string, why: string, prefsUrl?: string, title?: string, year?: number }} o
 *   label, preheader, why and title are TEXT (escaped here); body is HTML built from the blocks below.
 * @returns {string}
 */
export function layout(o) {
  const title = o.title || "Epsilon Labs";
  const year = o.year ?? new Date().getUTCFullYear();
  const pref = o.prefsUrl
    ? ` &nbsp;·&nbsp; <a href="${esc(o.prefsUrl)}" class="ink" style="color:${INK};text-decoration:underline">Email preferences</a>`
    : "";
  return `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="x-ua-compatible" content="ie=edge">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no">
<title>${esc(title)}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
@font-face{font-family:'Instrument Sans';font-weight:400 700;font-stretch:75% 100%;src:url(${ASSET}instrument-sans-normal-400-700-latin.woff2) format('woff2')}
@font-face{font-family:'IBM Plex Mono';font-weight:400;src:url(${ASSET}ibm-plex-mono-normal-400-latin.woff2) format('woff2')}
@font-face{font-family:'IBM Plex Mono';font-weight:500;src:url(${ASSET}ibm-plex-mono-normal-500-latin.woff2) format('woff2')}
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
a{text-decoration:none}
.dark-img{display:none;max-height:0;overflow:hidden}
@media (max-width:620px){
  .wrap{width:100%!important}
  .pad{padding:28px 22px!important}
  .hpad{padding:18px 22px!important}
  .fpad{padding:24px 22px!important}
  .h1{font-size:21px!important;line-height:28px!important}
  .stack{display:block!important;width:100%!important;padding:0 0 14px!important}
  .hide-sm{display:none!important}
  .kv-k{width:42%!important}
}
@media (prefers-color-scheme:dark){
  .bg{background:#000000!important}
  .card{background:#111111!important}
  .band{background:#000000!important}
  .ink,.h1{color:#F2F2F2!important}
  .body{color:#D4D4D4!important}
  .muted{color:#9E9E9E!important}
  .faint{color:#777777!important}
  .rule{border-color:#2A2A2A!important}
  .tint{background:#1A1A1A!important;border-color:#333333!important}
  .pill{background:#1A1A1A!important;border-color:#333333!important;color:#D4D4D4!important}
  .pill-hot{background:#FFFFFF!important;border-color:#FFFFFF!important;color:#000000!important}
  .btn{background:#FFFFFF!important}
  .btn a{color:#000000!important}
  .link{color:#FFFFFF!important}
  .light-img{display:none!important;max-height:0!important;overflow:hidden!important}
  .dark-img{display:block!important;max-height:none!important;overflow:visible!important}
}
[data-ogsc] .card{background:#111111!important}
[data-ogsc] .ink,[data-ogsc] .h1{color:#F2F2F2!important}
</style>
</head>
<body class="bg" bgcolor="${PAPER}" style="margin:0;padding:0;background:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(o.preheader)}${"&#847;&zwnj;&nbsp;".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" bgcolor="${PAPER}" style="background:${PAPER};">
<tr><td align="center" style="padding:32px 12px 40px">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<table role="presentation" width="600" cellpadding="0" cellspacing="0" class="wrap" style="width:600px;max-width:600px;">

<!-- header band -->
<tr><td class="band hpad" bgcolor="${INK}" style="background:${INK};border-radius:10px 10px 0 0;padding:14px 30px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td align="left" valign="middle"><a href="${SITE_URL}" style="display:inline-block"><img src="${LOGO_BADGE}" width="157" height="40" alt="Epsilon Labs" style="display:block;width:157px;height:40px;border:0;color:#FFFFFF;font:700 16px ${SANS}"></a></td>
    <td align="right" valign="middle" style="font:500 11px/1 ${MONO};letter-spacing:.14em;text-transform:uppercase;color:${COPPER_LIFT};white-space:nowrap">${esc(o.label)}</td>
  </tr></table>
</td></tr>

<!-- body card -->
<tr><td class="card pad" bgcolor="${CARD}" style="background:${CARD};padding:40px 40px 36px;border-radius:0 0 10px 10px;">
${o.body}
</td></tr>

<!-- footer -->
<tr><td class="fpad" style="padding:30px 36px 0;">
  <img src="${LOGO_BADGE}" width="118" height="30" alt="Epsilon Labs" style="display:block;width:118px;height:30px;border:0;margin:0 0 20px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    ${footCol("Client portal", "client.epsilon-labs.co", PORTAL_URL)}
    ${footCol("Website", "epsilon-labs.co", SITE_URL)}
    ${footCol("Contact", CONTACT, `mailto:${CONTACT}`)}
  </tr></table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="rule" style="border-top:1px solid ${RULE};padding:18px 0 0;font:400 11px/1.7 ${SANS};color:${MUTED}">
    <span class="muted">${esc(o.why)}${pref}</span><br>
    <span class="muted">${esc(COMPANY_LINE)} &middot; &copy; ${esc(year)} Epsilon Labs</span>
  </td></tr></table>
</td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
`;
}

// ------------------------------------------------------------------------------------------------------------ blocks

/** Mono uppercase line above the title ("EL-21 · FABRICPORT"). @param {string} text */
export function eyebrow(text) {
  return `<div class="muted" style="font:500 11px/1 ${MONO};letter-spacing:.14em;text-transform:uppercase;color:${MUTED};margin:0 0 14px">${esc(text)}</div>`;
}

/** The 24 px title. @param {string} text */
export function h1(text) {
  return `<h1 class="h1" style="margin:0 0 16px;font:600 24px/31px ${SANS};letter-spacing:-0.02em;color:${INK}">${esc(text)}</h1>`;
}

/** Small bold heading inside the body ("What happens next"). @param {string} text */
export function subhead(text) {
  return `<div class="ink" style="font:600 14px/22px ${SANS};color:${INK};margin:24px 0 0">${esc(text)}</div>`;
}

/**
 * Body paragraph. `html` is HTML: escape anything typed with esc().
 * @param {string} html
 * @param {{ muted?: boolean, mb?: number }} [o]
 */
export function p(html, o = {}) {
  const muted = !!o.muted;
  const mb = o.mb ?? 16;
  return `<p class="${muted ? "muted" : "body"}" style="margin:0 0 ${mb}px;font:400 15px/24px ${SANS};color:${muted ? MUTED : BODY}">${html}</p>`;
}

/**
 * Small muted paragraph (fine print under a button). `html` is HTML.
 * @param {string} html
 * @param {number} [mb]
 */
export function small(html, mb = 0) {
  return `<p class="muted" style="margin:0 0 ${mb}px;font:400 13px/20px ${SANS};color:${MUTED}">${html}</p>`;
}

/** Inline bold ink text (escaped). @param {string} text */
export function strong(text) {
  return `<strong class="ink" style="color:${INK}">${esc(text)}</strong>`;
}

/** Inline mono ink text, for addresses and references (escaped). @param {string} text */
export function mono(text) {
  return `<span class="ink" style="font-family:${MONO};color:${INK}">${esc(text)}</span>`;
}

/**
 * The centred ink button, with a VML fallback so Outlook draws it; optional secondary text link beside it.
 * @param {string} href
 * @param {string} label
 * @param {{ label: string, href: string }} [secondary]
 */
export function button(href, label, secondary) {
  const sec = secondary
    ? `<tr><td align="center" style="padding-top:14px"><a href="${esc(secondary.href)}" class="link" style="font:500 14px/1 ${SANS};color:${SIGNAL};text-decoration:underline">${esc(secondary.label)}</a></td></tr>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 10px"><tr>
<td align="center">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${esc(href)}" style="height:48px;v-text-anchor:middle;width:${32 + 9 * label.length}px" arcsize="17%" stroke="f" fillcolor="${COPPER}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold">${esc(label)}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto"><tr><td class="btn" style="background:${COPPER};border-radius:8px">
<a href="${esc(href)}" style="display:inline-block;padding:15px 32px;font:600 15px/18px ${SANS};color:#FFFFFF;text-decoration:none;border-radius:8px">${esc(label)}</a>
</td></tr></table><!--<![endif]-->
</td></tr>${sec}</table>`;
}

/** "USD 1,800.00" with greyed decimals (escaped). Returns HTML for a kv value. @param {string} text */
export function money(text) {
  const m = /^(.*?)(\.\d+)(\D*)$/.exec(String(text));
  if (!m) return esc(text);
  return `${esc(m[1])}<span class="faint" style="color:${FAINT}">${esc(m[2])}</span>${esc(m[3])}`;
}

/**
 * A kv value: plain text (escaped) or pre-built HTML (from money() etc.).
 * @typedef {string | { html: string }} KvValue
 */

/** @param {KvValue} v */
function kvValue(v) {
  return typeof v === "string" ? esc(v) : v.html;
}

/**
 * Receipt table: label | mono value, hairline rules, optional bold total row.
 * @param {Array<[string, KvValue]>} rows
 * @param {{ total?: [string, KvValue], mt?: number }} [o]
 */
export function kv(rows, o = {}) {
  const out = [`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:${o.mt ?? 24}px 0 4px">`];
  for (const [k, v] of rows) {
    out.push(
      `<tr><td class="rule muted kv-k" style="border-top:1px solid ${RULE};padding:11px 12px 11px 0;font:400 13px/20px ${SANS};color:${MUTED};width:38%;vertical-align:top">${esc(k)}</td>` +
        `<td class="rule ink" style="border-top:1px solid ${RULE};padding:11px 0;font:400 13px/20px ${MONO};color:${INK};text-align:right;vertical-align:top">${kvValue(v)}</td></tr>`,
    );
  }
  if (o.total) {
    const [k, v] = o.total;
    out.push(
      `<tr><td class="rule ink" style="border-top:2px solid ${INK};padding:14px 12px 4px 0;font:600 14px/20px ${SANS};color:${INK}">${esc(k)}</td>` +
        `<td class="rule ink" style="border-top:2px solid ${INK};padding:14px 0 4px;font:500 18px/20px ${MONO};color:${INK};text-align:right">${kvValue(v)}</td></tr>`,
    );
  } else {
    out.push(`<tr><td colspan="2" class="rule" style="border-top:1px solid ${RULE};font-size:0;line-height:0">&nbsp;</td></tr>`);
  }
  out.push("</table>");
  return out.join("");
}

/**
 * Small mono tag; `hot` is the copper "needs you" variant. Carries text, never colour alone.
 * @param {string} text
 * @param {boolean} [hot]
 */
export function pill(text, hot = false) {
  if (hot) {
    return `<span class="pill-hot" style="display:inline-block;padding:3px 7px;border:1px solid ${INK};border-radius:4px;background:${INK};font:500 10px/12px ${MONO};letter-spacing:.08em;text-transform:uppercase;color:#FFFFFF">${esc(text)}</span>`;
  }
  return `<span class="pill" style="display:inline-block;padding:3px 7px;border:1px solid ${RULE};border-radius:4px;background:${TINT};font:500 10px/12px ${MONO};letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">${esc(text)}</span>`;
}

/**
 * @typedef {{ kind: string, hot?: boolean, title: string, sub?: string, meta?: string, href: string }} Item
 *   All TEXT (escaped): kind (the pill), title (the link), sub (a line under it), meta (mono line).
 */

/**
 * Digest rows: pill, linked title, optional line, mono meta, chevron.
 * @param {Item[]} rows
 * @param {{ mt?: number }} [o]
 */
export function items(rows, o = {}) {
  const out = [`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:${o.mt ?? 22}px 0 4px">`];
  for (const r of rows) {
    out.push(`<tr><td class="rule" style="border-top:1px solid ${RULE};padding:16px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td valign="top">
  <div style="margin:0 0 8px">${pill(r.kind, !!r.hot)}</div>
  <a href="${esc(r.href)}" class="ink" style="font:600 15px/22px ${SANS};color:${INK};text-decoration:none">${esc(r.title)}</a>
  ${r.sub ? `<div class="body" style="font:400 14px/21px ${SANS};color:${BODY};margin:4px 0 0">${esc(r.sub)}</div>` : ""}
  ${r.meta ? `<div class="muted" style="font:400 12px/18px ${MONO};color:${MUTED};margin:6px 0 0">${esc(r.meta)}</div>` : ""}
</td>
<td valign="middle" width="28" align="right" class="hide-sm"><a href="${esc(r.href)}" class="link" style="font:400 18px/1 ${SANS};color:${SIGNAL};text-decoration:none">&rsaquo;</a></td>
</tr></table></td></tr>`);
  }
  out.push(`<tr><td class="rule" style="border-top:1px solid ${RULE};font-size:0;line-height:0">&nbsp;</td></tr></table>`);
  return out.join("");
}

/**
 * Quoted text with a left rule and an optional mono attribution (both TEXT, escaped; newlines kept).
 * @param {string} text
 * @param {string} [who]
 */
export function quote(text, who) {
  const w = who ? `<div class="muted" style="font:400 12px/18px ${MONO};color:${MUTED};margin:8px 0 0">${esc(who)}</div>` : "";
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 6px"><tr>` +
    `<td class="rule" style="border-left:2px solid ${RULE};padding:2px 0 2px 16px">` +
    `<div class="muted" style="font:400 14px/22px ${SANS};color:${MUTED};white-space:pre-wrap">${esc(text)}</div>${w}</td></tr></table>`
  );
}

/**
 * The big spaced code in a tinted box, with a mono note under it (both TEXT).
 * @param {string} code
 * @param {string} note
 */
export function codeBlock(code, note) {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 10px"><tr>` +
    `<td class="tint" align="center" style="background:${TINT};border:1px solid ${RULE};border-radius:8px;padding:22px 12px">` +
    `<div class="ink" style="font:500 34px/1 ${MONO};letter-spacing:.32em;color:${INK};padding-left:.32em">${esc(code)}</div>` +
    `<div class="muted" style="font:400 12px/18px ${MONO};color:${MUTED};margin:12px 0 0">${esc(note)}</div></td></tr></table>`
  );
}

/** Tinted note box. `html` is HTML. @param {string} html */
export function note(html) {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 4px"><tr>` +
    `<td class="tint" style="background:${TINT};border:1px solid ${RULE};border-radius:8px;padding:14px 16px;` +
    `font:400 13px/20px ${SANS};color:${MUTED}"><span class="muted">${html}</span></td></tr></table>`
  );
}

/** A long URL in a tinted mono box, for "copy this link instead" (TEXT). @param {string} text */
export function linkBox(text) {
  return `<div class="tint muted" style="background:${TINT};border:1px solid ${RULE};border-radius:8px;padding:12px 14px;font:400 12px/18px ${MONO};color:${MUTED};word-break:break-all">${esc(text)}</div>`;
}

/**
 * Numbered steps (01, 02 …) with a title and a line each (TEXT).
 * @param {Array<[string, string]>} rows
 */
export function steps(rows) {
  const out = [`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 4px">`];
  rows.forEach(([t, d], i) => {
    out.push(
      `<tr><td valign="top" width="34" style="padding:8px 0;font:500 12px/22px ${MONO};color:${COPPER}" class="link">${String(i + 1).padStart(2, "0")}</td>` +
        `<td valign="top" style="padding:8px 0"><div class="ink" style="font:600 14px/22px ${SANS};color:${INK}">${esc(t)}</div>` +
        `<div class="muted" style="font:400 13px/20px ${SANS};color:${MUTED}">${esc(d)}</div></td></tr>`,
    );
  });
  out.push("</table>");
  return out.join("");
}

/**
 * The Epsilon Labs sign-off under a hairline (the company first, the founder under it).
 * @param {{ line2?: string, reply?: string }} [o]
 */
export function signature(o = {}) {
  const line2 = o.line2 ?? "Ehab Riaz · Founder";
  const reply = o.reply ?? "Reply to this email and it reaches us directly.";
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:30px 0 0"><tr>` +
    `<td class="rule" style="border-top:1px solid ${RULE};padding:20px 0 0">` +
    `<div class="ink" style="font:600 14px/20px ${SANS};color:${INK}">Epsilon Labs</div>` +
    `<div class="muted" style="font:400 13px/20px ${SANS};color:${MUTED}">${esc(line2)}</div>` +
    `<div class="muted" style="font:400 12px/18px ${MONO};color:${MUTED};margin:6px 0 0">${esc(reply)}</div></td></tr></table>`
  );
}

// --------------------------------------------------------------------------------------------------- inline logos

/** The two lockup PNGs (same files as assets/brand/email/logo-*@4x.png), base64, so mail can carry them inline. */
const LOGO_DATA = {
  "logo-badge@4x.png": "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",
};

/**
 * Mail clients often block remote images until the reader clicks "load images", which hid the logo. For mail we
 * send ourselves (platform + site), swap the hosted logo URLs for inline cid: images and return the attachments
 * nodemailer needs. Supabase's auth mail cannot attach files, so it keeps the hosted URLs.
 * @param {string} html
 * @returns {{ html: string, attachments: Array<{ filename: string, content: string, encoding: string, cid: string, contentType: string, contentDisposition: string }> }}
 */
export function inlineLogos(html) {
  const attachments = [];
  let out = html;
  for (const [file, data] of Object.entries(LOGO_DATA)) {
    const url = `${ASSET}${file}`;
    if (!out.includes(url)) continue;
    const cid = `${file.replace(/[^a-z0-9]/gi, "-")}@epsilon-labs.co`;
    out = out.split(url).join(`cid:${cid}`);
    attachments.push({ filename: file, content: data, encoding: "base64", cid, contentType: "image/png", contentDisposition: "inline" });
  }
  return { html: out, attachments };
}

// ------------------------------------------------------------------------------------------------------- plain text

/**
 * The plain-text alternative: paragraphs separated by blank lines, then the footer (why, preferences, legal line).
 * Empty parts are dropped.
 * @param {Array<string | null | undefined | false>} parts
 * @param {{ why?: string, prefsUrl?: string }} [o]
 * @returns {string}
 */
export function text(parts, o = {}) {
  const body = parts.filter((x) => typeof x === "string" && x.trim() !== "").join("\n\n");
  const foot = [
    "--",
    o.why || "",
    o.prefsUrl ? `Email preferences: ${o.prefsUrl}` : "",
    COMPANY_LINE,
    `epsilon-labs.co · ${CONTACT}`,
  ].filter(Boolean);
  return `${body}\n\n${foot.join("\n")}\n`;
}

/**
 * One whole mail: { subject, html, text } from the layout options, the HTML body and the text parts.
 * @param {{ subject: string, label: string, preheader: string, title?: string, why: string, prefsUrl?: string, html: string, text: Array<string | null | undefined | false> }} o
 * @returns {{ subject: string, html: string, text: string }}
 */
export function email(o) {
  return {
    subject: o.subject,
    html: layout({ label: o.label, preheader: o.preheader, title: o.title ?? o.subject, why: o.why, prefsUrl: o.prefsUrl, body: o.html }),
    text: text(o.text, { why: o.why, prefsUrl: o.prefsUrl }),
  };
}
