// Pure helpers for POST /api/intake (the /start wizard). No I/O here, so it is unit-tested from platform/ (vitest).
// The leading underscore keeps Vercel from deploying this file as its own function.
'use strict';

const crypto = require('node:crypto');

const MAX_BYTES = 32 * 1024;
const KINDS = ['software', 'hardware', 'both'];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ANSWER_KEYS = ['need', 'offer', 'offer_name', 'state', 'when'];
const FOUNDER = 'er@epsilon-labs.co';
const ADMIN = 'https://admin.epsilon-labs.co';

/** Same-origin only. Browsers send Origin on POST; a request without one is not from a page (curl), which the
 *  database limits cover. */
function originAllowed(origin) {
  if (!origin) return true;
  let u;
  try { u = new URL(origin); } catch (e) { return false; }
  const h = u.hostname;
  if (u.protocol === 'https:' && (h === 'epsilon-labs.co' || h === 'www.epsilon-labs.co' || h.endsWith('.vercel.app'))) return true;
  return u.protocol === 'http:' && (h === 'localhost' || h === '127.0.0.1');
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Validates and normalises the wizard's JSON. Returns { ok: true, value } or { ok: false, errors: {field: message} }.
 * The database function checks the same rules again; this gives the visitor field-level messages.
 */
function validate(body) {
  const errors = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, errors: { form: 'Expected a JSON object.' } };
  const name = str(body.name);
  const email = str(body.email).toLowerCase();
  const company = str(body.company);
  const kind = str(body.kind);
  const budget = str(body.budget);
  const message = str(body.message);
  const website = str(body.website);
  if (!name) errors.name = 'Your name is required.';
  else if (name.length > 200) errors.name = 'Keep the name under 200 characters.';
  if (!email || email.length > 254 || !EMAIL.test(email)) errors.email = 'A valid email address is required.';
  if (company.length > 200) errors.company = 'Keep the company under 200 characters.';
  if (!KINDS.includes(kind)) errors.kind = 'Pick software, hardware or both.';
  if (budget.length > 80) errors.budget = 'Budget is too long.';
  if (message.length > 10000) errors.message = 'Keep the details under 10,000 characters.';
  const answers = {};
  const raw = body.answers == null ? {} : body.answers;
  if (typeof raw !== 'object' || Array.isArray(raw)) errors.answers = 'Invalid answers.';
  else {
    for (const k of ANSWER_KEYS) {
      if (raw[k] == null || raw[k] === '') continue;
      if (typeof raw[k] !== 'string' || raw[k].length > 500) { errors.answers = 'Invalid answers.'; break; }
      answers[k] = raw[k].trim();
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: { name, email, company, kind, budget, message, answers, website, source: 'epsilon-labs.co/start' },
  };
}

/** The visitor's IP from Vercel's forwarding headers (first hop), or '' when absent. */
function clientIp(headers) {
  const fwd = String(headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || String(headers['x-real-ip'] || '').trim();
}

/** UTC day, "2026-10-12": the salt changes daily, so yesterday's counters cannot be linked to today's. */
function day(now) {
  return now.toISOString().slice(0, 10);
}

/** sha256(ip + daily salt), the only form of the address that leaves this function. */
function ipKey(ip, secret, now) {
  if (!secret || secret.length < 16) throw new Error('INTAKE_IP_SALT must be at least 16 characters');
  const salt = crypto.createHmac('sha256', secret).update(`intake-day:${day(now)}`).digest('hex');
  return crypto.createHash('sha256').update(`${ip || 'unknown'}|${salt}`).digest('hex');
}

/** PostgREST headers for the anon (publishable) key. A legacy JWT key also goes in Authorization. */
function supabaseHeaders(key) {
  const h = { apikey: key, 'Content-Type': 'application/json' };
  if (/^eyJ/.test(key)) h.Authorization = `Bearer ${key}`;
  return h;
}

// ---- email (fixed templates, F13: no AI wording, so they go automatically) ------------------------------------------

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const FOOT_TEXT = 'Epsilon Labs · epsilon-labs.co\nThis is an automatic message from notifications@epsilon-labs.co. Replies go to Ehab.';

function layout(preheader, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>Epsilon Labs</title></head>
<body style="margin:0;padding:0;background:#efede9;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#1b1a18">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efede9;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:24px;padding:32px 30px">
<tr><td style="padding-bottom:22px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:34px;height:34px;border-radius:10px;background:#1b1a18;color:#ffffff;font:400 20px/34px Georgia,'Times New Roman',serif;text-align:center">ε</td>
<td style="padding-left:10px;font-weight:600;font-size:14px">Epsilon Labs</td></tr></table></td></tr>
<tr><td style="font-size:14px;line-height:1.6;color:#3d3b37">${body}</td></tr>
</table>
<p style="max-width:520px;margin:18px auto 0;font-size:11px;line-height:1.6;color:#8a867f;text-align:center">
Epsilon Labs · <a href="https://epsilon-labs.co" style="color:#8a867f">epsilon-labs.co</a><br>
This is an automatic message from notifications@epsilon-labs.co. Replies go to Ehab.</p>
</td></tr></table></body></html>`;
}

const h1 = (t) => `<h1 style="margin:0 0 10px;font-size:22px;font-weight:500;color:#1b1a18">${esc(t)}</h1>`;
const p = (html) => `<p style="margin:0 0 14px">${html}</p>`;

/** The enquirer's acknowledgement. Fixed text; only their first name is interpolated. */
function ackEmail(v) {
  const first = v.name.split(/\s+/)[0] || 'there';
  return {
    subject: 'We have your enquiry · Epsilon Labs',
    html: layout(
      'Thanks. Ehab replies within two working days.',
      h1(`Thanks, ${first}`) +
        p('Your enquiry reached Epsilon Labs. Ehab reads every one himself and replies within two working days, usually sooner.') +
        p('If you have a model number, a photo of the connector or a sample file, reply to this email with it.') +
        p('<span style="color:#8a867f;font-size:12px">You are getting this because someone used this address on epsilon-labs.co/start. If that wasn\'t you, ignore it; we won\'t write again unless you reply.</span>'),
    ),
    text: `Thanks, ${first}.\n\nYour enquiry reached Epsilon Labs. Ehab reads every one himself and replies within two working days, usually sooner.\nIf you have a model number, a photo of the connector or a sample file, reply to this email with it.\n\nIf you didn't use this address on epsilon-labs.co/start, ignore this email.\n\n${FOOT_TEXT}`,
  };
}

/** The founder's notice, with everything the visitor typed (escaped). */
function founderEmail(v, id) {
  const who = v.company ? `${v.name} (${v.company})` : v.name;
  const rows = [
    ['From', `${v.name} <${v.email}>`], ['Company', v.company || '–'], ['Track', v.kind], ['Work', v.answers.need || '–'],
    ['Offer', v.answers.offer_name || '–'], ['Today', v.answers.state || '–'], ['Timing', v.answers.when || '–'],
    ['Budget', v.budget || '–'],
  ];
  const link = id ? `${ADMIN}/intake/${id}` : `${ADMIN}/intake`;
  return {
    subject: `[Epsilon] New enquiry from ${who}`,
    html: layout(`New enquiry from ${who}`,
      h1(`New enquiry from ${who}`) +
        `<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:13px;margin:0 0 14px">${rows.map(([k, val]) =>
          `<tr><td style="color:#8a867f;padding:2px 14px 2px 0;vertical-align:top">${esc(k)}</td><td style="padding:2px 0">${esc(val)}</td></tr>`).join('')}</table>` +
        p(`<span style="white-space:pre-wrap">${esc(v.message || '(no details)')}</span>`) +
        `<p style="margin:22px 0"><a href="${esc(link)}" style="display:inline-block;background:#d9532f;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:13px 24px;border-radius:999px">Open in admin</a></p>`),
    text: `New enquiry from ${who}\n\n${rows.map(([k, val]) => `${k}: ${val}`).join('\n')}\n\n${v.message || '(no details)'}\n\n${link}\n`,
  };
}

module.exports = { MAX_BYTES, FOUNDER, originAllowed, validate, clientIp, ipKey, supabaseHeaders, ackEmail, founderEmail, esc };
