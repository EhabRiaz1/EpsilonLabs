// POST /api/intake: the /start wizard posts here, same origin (EN1). Vercel Node function, no framework.
//
// Validates the JSON (32 KB cap, honeypot), hashes the client IP with a daily salt (the raw IP is never stored or
// sent on), and calls submit_intake() with the PUBLIC (anon) key: that RPC is the only thing anon may execute
// (F11), and it applies the per-client limit (5/hour) and a global cap. Then it emails the founder and sends the
// enquirer a fixed-template acknowledgement from notifications@ (F9, F13).
//
// Env (site project): SUPABASE_URL, SUPABASE_ANON_KEY (publishable), INTAKE_IP_SALT, SMTP_HOST, SMTP_PORT,
// SMTP_USER, SMTP_PASSWORD.
'use strict';

const core = require('./_intake.js');

const FROM = 'Epsilon Labs <notifications@epsilon-labs.co>';

function send(res, status, body, extra) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(extra || {})) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

/** Reads the raw body ourselves (never more than the cap), so the size limit holds whatever the platform buffers. */
function readBody(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body !== 'object') return Promise.resolve(String(req.body));
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body.toString('utf8'));
  if (req.body && typeof req.body === 'object') return Promise.resolve(JSON.stringify(req.body));
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > core.MAX_BYTES) { reject(Object.assign(new Error('too large'), { tooLarge: true })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

let transport = null;
function smtp() {
  const { SMTP_HOST: host, SMTP_PORT: port, SMTP_USER: user, SMTP_PASSWORD: pass } = process.env;
  if (!host || !port || !user || !pass) return null;
  if (!transport) {
    const nodemailer = require('nodemailer');
    const p = Number(port);
    transport = nodemailer.createTransport({ host, port: p, secure: p === 465, auth: { user, pass }, connectionTimeout: 8000, socketTimeout: 10000 });
  }
  return transport;
}

async function mail(to, m, replyTo, what) {
  const t = smtp();
  if (!t) { console.error(`intake: SMTP not configured, ${what} not sent`); return false; }
  try {
    await t.sendMail({ from: FROM, to, replyTo, subject: m.subject, html: m.html, text: m.text });
    return true;
  } catch (e) {
    console.error(`intake: ${what} failed:`, e && e.message ? e.message : e);
    return false;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' }, { Allow: 'POST' });
  if (!core.originAllowed(req.headers.origin)) return send(res, 403, { error: 'origin' });
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return send(res, 415, { error: 'json' });
  if (Number(req.headers['content-length'] || 0) > core.MAX_BYTES) return send(res, 413, { error: 'too_large' });

  let raw;
  try {
    raw = await readBody(req);
  } catch (e) {
    return e && e.tooLarge ? send(res, 413, { error: 'too_large' }) : send(res, 400, { error: 'invalid' });
  }
  if (Buffer.byteLength(raw, 'utf8') > core.MAX_BYTES) return send(res, 413, { error: 'too_large' });
  let body;
  try { body = JSON.parse(raw); } catch (e) { return send(res, 400, { error: 'invalid', fields: { form: 'Not JSON.' } }); }

  const v = core.validate(body);
  if (!v.ok) return send(res, 400, { error: 'invalid', fields: v.errors });
  // honeypot: answer like a success, store and send nothing
  if (v.value.website) return send(res, 200, { ok: true });

  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: key, INTAKE_IP_SALT: salt } = process.env;
  if (!url || !key || !salt) {
    console.error('intake: SUPABASE_URL, SUPABASE_ANON_KEY and INTAKE_IP_SALT must be set');
    return send(res, 503, { error: 'unavailable' });
  }

  let out;
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/submit_intake`, {
      method: 'POST',
      headers: core.supabaseHeaders(key),
      body: JSON.stringify({ p_ip_hash: core.ipKey(core.clientIp(req.headers), salt, new Date()), p_payload: v.value }),
      signal: AbortSignal.timeout(10000),
    });
    const text = await r.text();
    if (r.status === 400) {
      console.error('intake: refused by submit_intake:', text.slice(0, 300));
      return send(res, 400, { error: 'invalid' });
    }
    if (!r.ok) throw new Error(`submit_intake ${r.status}: ${text.slice(0, 300)}`);
    out = JSON.parse(text);
  } catch (e) {
    console.error('intake: database unavailable:', e && e.message ? e.message : e);
    return send(res, 503, { error: 'unavailable' });
  }

  if (out.state === 'rate_limited') return send(res, 429, { error: 'rate_limited', retry_at: out.retry_at || null }, { 'Retry-After': '3600' });
  if (out.state === 'disabled') return send(res, 503, { error: 'disabled' });
  if (out.state !== 'ok') return send(res, 503, { error: 'unavailable' });

  // The row is stored; mail failures are logged and never turn a stored enquiry into an error for the visitor.
  // Awaited before responding: a serverless function may be frozen once the response is sent.
  await Promise.all([
    out.notify ? mail(core.FOUNDER, core.founderEmail(v.value, out.id), v.value.email, 'founder notice') : null,
    out.ack ? mail(v.value.email, core.ackEmail(v.value), core.FOUNDER, 'acknowledgement') : null,
  ]);
  return send(res, 200, { ok: true });
};
