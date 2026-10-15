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
  .ink,.h1{color:#EDF0F1!important}
  .body{color:#C9CFD3!important}
  .muted{color:#8A949B!important}
  .faint{color:#6B757C!important}
  .rule{border-color:#1C2124!important}
  .tint{background:#14181B!important;border-color:#2A3136!important}
  .pill{background:#14181B!important;border-color:#2A3136!important;color:#C9CFD3!important}
  .pill-hot{background:#FFFFFF!important;border-color:#FFFFFF!important;color:#000000!important}
  .btn{background:#FFFFFF!important}
  .btn a{color:#000000!important}
  .link{color:#FFFFFF!important}
  .light-img{display:none!important;max-height:0!important;overflow:hidden!important}
  .dark-img{display:block!important;max-height:none!important;overflow:visible!important}
}
[data-ogsc] .card{background:#111111!important}
[data-ogsc] .ink,[data-ogsc] .h1{color:#EDF0F1!important}
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(o.preheader)}${"&#847;&zwnj;&nbsp;".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" style="background:${PAPER};">
<tr><td align="center" style="padding:32px 12px 40px">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<table role="presentation" width="600" cellpadding="0" cellspacing="0" class="wrap" style="width:600px;max-width:600px;">

<!-- header band -->
<tr><td class="band hpad" style="background:${INK};border-radius:10px 10px 0 0;padding:22px 36px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td align="left" valign="middle"><a href="${SITE_URL}" style="display:inline-block"><img src="${LOGO_WHITE}" width="142" height="22" alt="Epsilon Labs" style="display:block;width:142px;height:22px;color:#FFFFFF;font:700 16px ${SANS}"></a></td>
    <td align="right" valign="middle" style="font:500 11px/1 ${MONO};letter-spacing:.14em;text-transform:uppercase;color:${COPPER_LIFT};white-space:nowrap">${esc(o.label)}</td>
  </tr></table>
</td></tr>

<!-- body card -->
<tr><td class="card pad" style="background:${CARD};padding:40px 40px 36px;border-radius:0 0 10px 10px;">
${o.body}
</td></tr>

<!-- footer -->
<tr><td class="fpad" style="padding:30px 36px 0;">
  <img class="light-img" src="${LOGO_BLACK}" width="103" height="16" alt="Epsilon Labs" style="display:block;width:103px;height:16px;margin:0 0 20px">
  <!--[if !mso]><!--><div class="dark-img" style="display:none;max-height:0;overflow:hidden"><img src="${LOGO_WHITE}" width="103" height="16" alt="Epsilon Labs" style="display:block;width:103px;height:16px;margin:0 0 20px"></div><!--<![endif]-->
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
 * Ehab's sign-off under a hairline.
 * @param {{ line2?: string, reply?: string }} [o]
 */
export function signature(o = {}) {
  const line2 = o.line2 ?? "Founder, Epsilon Labs";
  const reply = o.reply ?? "Reply to this email and it reaches me directly.";
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:30px 0 0"><tr>` +
    `<td class="rule" style="border-top:1px solid ${RULE};padding:20px 0 0">` +
    `<div class="ink" style="font:600 14px/20px ${SANS};color:${INK}">Ehab Riaz</div>` +
    `<div class="muted" style="font:400 13px/20px ${SANS};color:${MUTED}">${esc(line2)}</div>` +
    `<div class="muted" style="font:400 12px/18px ${MONO};color:${MUTED};margin:6px 0 0">${esc(reply)}</div></td></tr></table>`
  );
}

// --------------------------------------------------------------------------------------------------- inline logos

/** The two lockup PNGs (same files as assets/brand/email/logo-*@4x.png), base64, so mail can carry them inline. */
const LOGO_DATA = {
  "logo-white@4x.png": "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",
  "logo-black@4x.png": "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",
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
