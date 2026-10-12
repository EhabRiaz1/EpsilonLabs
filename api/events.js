// POST /api/events: the site's analytics beacon (assets/js/track.js), same origin. Vercel Node function, no framework.
//
// Drops bots and Do-Not-Track / GPC requests, validates the batch (16 KB, at most 20 events), adds the country from
// Vercel's x-vercel-ip-country header and a coarse device class from the user agent (the agent itself is dropped),
// and calls record_events() with the PUBLIC (anon) key: it is the only 016 function anon may execute, and it applies
// the per-client limit (keyed by sha256(ip + daily salt), as /api/intake does; the raw IP never leaves this
// function) and the global daily cap. Answers 204 whatever the database decided, so a visitor learns nothing.
//
// Env (site project): SUPABASE_URL, SUPABASE_ANON_KEY (publishable), INTAKE_IP_SALT (shared with /api/intake).
'use strict';

const intake = require('./_intake.js');
const core = require('./_events.js');

function done(res, status) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

function readBody(req) {
  if (typeof req.body === 'string') return Promise.resolve(req.body);
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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return done(res, 405); }
  const h = req.headers || {};
  if (!intake.originAllowed(h.origin)) return done(res, 403);
  // sendBeacon posts text/plain (no preflight); fetch from the tracker uses the same
  if (!/^(application\/json|text\/plain)\b/i.test(String(h['content-type'] || ''))) return done(res, 415);
  if (Number(h['content-length'] || 0) > core.MAX_BYTES) return done(res, 413);
  if (core.optedOut(h) || core.isBot(h['user-agent'])) return done(res, 204);

  let raw;
  try {
    raw = await readBody(req);
  } catch (e) {
    return done(res, e && e.tooLarge ? 413 : 400);
  }
  if (Buffer.byteLength(raw, 'utf8') > core.MAX_BYTES) return done(res, 413);
  let body;
  try { body = JSON.parse(raw); } catch (e) { return done(res, 400); }
  const events = core.normalise(body, { country: core.country(h), device: core.deviceClass(h['user-agent']) });
  if (!events.length) return done(res, 204);

  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: key, INTAKE_IP_SALT: salt } = process.env;
  if (!url || !key || !salt) {
    console.error('events: SUPABASE_URL, SUPABASE_ANON_KEY and INTAKE_IP_SALT must be set');
    return done(res, 503);
  }
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/record_events`, {
      method: 'POST',
      headers: intake.supabaseHeaders(key),
      body: JSON.stringify({ p_batch: { client: intake.ipKey(intake.clientIp(h), salt, new Date()), events } }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      const text = await r.text();
      console.error(`events: record_events ${r.status}: ${text.slice(0, 300)}`);
      return done(res, r.status === 400 ? 400 : 503);
    }
  } catch (e) {
    console.error('events: database unavailable:', e && e.message ? e.message : e);
    return done(res, 503);
  }
  return done(res, 204);
};
