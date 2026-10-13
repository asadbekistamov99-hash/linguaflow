'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const COOKIE = 'lf_session';
const TTL_MS = 30 * 86400000;

function loadSecret(dataDir) {
  if (process.env.SESSION_SECRET) return Buffer.from(process.env.SESSION_SECRET);
  const f = path.join(dataDir, '.secret');
  try { return fs.readFileSync(f); } catch { /* generate below */ }
  fs.mkdirSync(dataDir, { recursive: true });
  const s = crypto.randomBytes(48);
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

const scryptAsync = (pw, salt, len) => new Promise((res, rej) => crypto.scrypt(pw, salt, len, (e, k) => (e ? rej(e) : res(k))));
async function hashPasswordAsync(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await scryptAsync(pw, salt, 64)).toString('hex')}`;
}
async function verifyPasswordAsync(pw, stored) {
  const [alg, saltHex, keyHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(keyHex, 'hex');
  return crypto.timingSafeEqual(await scryptAsync(pw, Buffer.from(saltHex, 'hex'), expected.length), expected);
}
const DUMMY_HASH = hashPassword('dummy-password-for-timing');

function verifyPassword(pw, stored) {
  const [alg, saltHex, keyHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(keyHex, 'hex');
  const key = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(key, expected);
}

const b64 = (b) => Buffer.from(b).toString('base64url');

function sign(secret, userId, createdAt, ver = 0) {
  const payload = b64(JSON.stringify({ uid: userId, ca: createdAt, sv: ver, exp: Date.now() + TTL_MS }));
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

function verify(secret, token) {
  if (typeof token !== 'string') return null;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? { uid: data.uid, ca: data.ca, sv: data.sv || 0 } : null;
  } catch { return null; }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed cookie */ } }
  }
  return out;
}

function sessionCookie(token, { secure } = {}) {
  const attrs = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${TTL_MS / 1000}`];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}
const clearCookie = ({ secure } = {}) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax;${secure ? ' Secure;' : ''} Max-Age=0`;

// Simple fixed-window limiter, in memory.
function createLimiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return true; }
    h.n++;
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    return h.n <= max;
  };
}

module.exports = { COOKIE, DUMMY_HASH, loadSecret, hashPassword, verifyPassword, hashPasswordAsync, verifyPasswordAsync, sign, verify, parseCookies, sessionCookie, clearCookie, createLimiter };
