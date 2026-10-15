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
// The layout is the shared Epsilon email system: api/_email-layout.js, generated from platform/lib/email/layout-core.mjs.

const L = require('./_email-layout.js');

const esc = L.esc;
const TRACK = { software: 'Software', hardware: 'Hardware', both: 'Software and hardware' };

/** "15 Oct 2026" in Lahore time. */
function lahoreDate(now) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' }).format(now);
}

/**
 * The enquirer's acknowledgement. Fixed text: only their first name and the validated track are interpolated, never
 * the free-text answers or message (anyone can type any address into the form, so this mail must not carry their
 * words to it).
 */
function ackEmail(v, now) {
  const first = v.name.split(/\s+/)[0] || 'there';
  const received = lahoreDate(now || new Date());
  return L.email({
    subject: 'We have your enquiry · Epsilon Labs',
    label: 'Enquiry',
    preheader: 'We have your enquiry. Ehab reads every one himself and replies within two working days.',
    title: 'We have your enquiry',
    why: 'You got this because someone used this address on epsilon-labs.co/start. If that wasn’t you, ignore it; we won’t write again unless you reply.',
    html:
      L.eyebrow(`Enquiry received · ${received}`) +
      L.h1(`We have your enquiry, ${first}`) +
      L.p('Thanks for getting in touch. Ehab reads every enquiry himself and replies within two working days (Lahore, UTC+5), usually sooner, often with two or three questions or a call slot.') +
      L.p('If you have a model number, a photo of the connector or a sample file, reply to this email with it.', { mb: 0 }) +
      L.kv([['Track', TRACK[v.kind] || 'Not sure yet'], ['Received', received], ['Reply within', 'Two working days']]) +
      L.subhead('What happens next') +
      L.steps([
        ['A reply from Ehab', 'Questions, or a 20-minute call slot.'],
        ['Short scoping call', 'We agree what done looks like.'],
        ['Fixed-scope proposal', 'Price, timeline and terms on one page.'],
      ]) +
      L.signature(),
    text: [
      `Thanks, ${first}.`,
      'Your enquiry reached Epsilon Labs. Ehab reads every one himself and replies within two working days, usually sooner.\nIf you have a model number, a photo of the connector or a sample file, reply to this email with it.',
      'What happens next: a reply from Ehab, a short scoping call, then a fixed-scope proposal (price, timeline and terms on one page).',
      'Ehab Riaz\nFounder, Epsilon Labs',
    ],
  });
}

/** The founder's notice, with everything the visitor typed (escaped by the layout's text blocks). */
function founderEmail(v, id) {
  const who = v.company ? `${v.name} (${v.company})` : v.name;
  const rows = [
    ['From', `${v.name} <${v.email}>`], ['Company', v.company || '–'], ['Track', v.kind], ['Work', v.answers.need || '–'],
    ['Offer', v.answers.offer_name || '–'], ['Today', v.answers.state || '–'], ['Timing', v.answers.when || '–'],
    ['Budget', v.budget || '–'],
  ];
  const link = id ? `${ADMIN}/intake/${id}` : `${ADMIN}/intake`;
  return L.email({
    subject: `[Epsilon] New enquiry from ${who}`,
    label: 'Enquiry',
    preheader: `New enquiry from ${who}`,
    title: `New enquiry from ${who}`,
    why: 'Internal notice: a visitor sent the form at epsilon-labs.co/start. Reply to this email to answer them.',
    html:
      L.eyebrow(`New enquiry · ${TRACK[v.kind] || v.kind}`) +
      L.h1(`New enquiry from ${who}`) +
      L.kv(rows, { mt: 8 }) +
      L.quote(v.message || '(no details)', 'Their message') +
      L.button(link, 'Open in admin'),
    text: [`New enquiry from ${who}`, rows.map(([k, val]) => `${k}: ${val}`).join('\n'), v.message || '(no details)', link],
  });
}

module.exports = { MAX_BYTES, FOUNDER, originAllowed, validate, clientIp, ipKey, supabaseHeaders, ackEmail, founderEmail, esc };
