// Pure helpers for POST /api/events (assets/js/track.js). No I/O here, so it is unit-tested from platform/ (vitest).
// The leading underscore keeps Vercel from deploying this file as its own function.
'use strict';

const crypto = require('crypto');

const MAX_BYTES = 16 * 1024;
const MAX_EVENTS = 20;
const KINDS = new Set(['view', 'click', 'start_step', 'start_submit']);
const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'];
const SESSION = /^[A-Za-z0-9_-]{8,64}$/;
const HOST = /^[a-z0-9.-]{1,253}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly|curl|wget|python-|go-http|okhttp|axios|node-fetch/i;

/** A clean path, or null: starts with "/", no query, fragment or whitespace, at most 300 characters. */
function cleanPath(v) {
  if (typeof v !== 'string') return null;
  const p = v.split(/[?#]/)[0];
  return p.startsWith('/') && p.length <= 300 && !/\s/.test(p) ? p : null;
}

function cleanText(v, max) {
  if (typeof v !== 'string') return null;
  const t = v.replace(CONTROL, '').trim().slice(0, max);
  return t || null;
}

/** Keeps only the known utm keys with 1-100 character string values; null when nothing is left. */
function cleanUtm(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = {};
  for (const k of UTM_KEYS) {
    const t = cleanText(v[k], 100);
    if (t) out[k] = t;
  }
  return Object.keys(out).length ? out : null;
}

/** "mobile" | "tablet" | "desktop" from the user agent, which is then dropped (never stored or sent on). */
function deviceClass(ua) {
  const s = String(ua || '');
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(s)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|Opera Mini|IEMobile/i.test(s)) return 'mobile';
  return 'desktop';
}

function isBot(ua) {
  return !ua || BOT.test(String(ua));
}

/** Do-Not-Track or Global Privacy Control: the tracker already sends nothing, this is the server's own check. */
function optedOut(headers) {
  return String(headers.dnt || '') === '1' || String(headers['sec-gpc'] || '') === '1';
}

/** Vercel's x-vercel-ip-country, two upper-case letters, or null. The only source of the country. */
function country(headers) {
  const c = String(headers['x-vercel-ip-country'] || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

/**
 * The anonymous visit id: sha256 of the IP, the user agent and a salt that changes every UTC day, cut to 32 hex
 * characters. Same browser + network on the same day = one visit; nothing is stored on the device, the inputs are
 * never stored, and tomorrow's id cannot be linked to today's.
 */
function visitorId(ip, ua, secret, now) {
  if (!secret || secret.length < 16) throw new Error('INTAKE_IP_SALT must be at least 16 characters');
  const salt = crypto.createHmac('sha256', secret).update(`visit-day:${now.toISOString().slice(0, 10)}`).digest('hex');
  return crypto.createHash('sha256').update(`${ip || 'unknown'}|${ua || ''}|${salt}`).digest('hex').slice(0, 32);
}

/**
 * The tracker's body {e: [...]} to the events record_events() takes. Invalid events are dropped one by one (the
 * database refuses a whole batch with any bad event), at most 20 are kept, and the country and device class come
 * from the request, never from the body. The visit id is ctx.sid (visitorId) when given.
 */
function normalise(body, ctx) {
  const list = body && typeof body === 'object' && Array.isArray(body.e) ? body.e : [];
  const out = [];
  for (const raw of list) {
    if (out.length >= MAX_EVENTS) break;
    if (!raw || typeof raw !== 'object') continue;
    const s = ctx && ctx.sid ? ctx.sid : (typeof raw.s === 'string' && SESSION.test(raw.s) ? raw.s : null);
    const p = cleanPath(raw.p);
    const k = typeof raw.k === 'string' && KINDS.has(raw.k) ? raw.k : null;
    if (!s || !p || !k) continue;
    const e = { s, p, k };
    const t = cleanText(raw.t, 300);
    if (t) e.t = t;
    const r = typeof raw.r === 'string' ? raw.r.trim().toLowerCase() : '';
    if (r && HOST.test(r)) e.r = r;
    const u = k === 'view' ? cleanUtm(raw.u) : null;
    if (u) e.u = u;
    if (ctx && ctx.country) e.c = ctx.country;
    if (ctx && ctx.device) e.d = ctx.device;
    out.push(e);
  }
  return out;
}

module.exports = { MAX_BYTES, MAX_EVENTS, cleanPath, cleanUtm, deviceClass, isBot, optedOut, country, normalise, visitorId };
