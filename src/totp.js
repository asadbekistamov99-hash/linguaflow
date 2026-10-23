'use strict';
const crypto = require('node:crypto');
const QRCode = require('qrcode');

const B32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let val = 0;
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    val = (val << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += B32_CHARS[(val >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_CHARS[(val << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/=+$/, '').replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let val = 0;
  let idx = 0;
  const out = Buffer.alloc(Math.floor((clean.length * 5) / 8));
  for (let i = 0; i < clean.length; i++) {
    const v = B32_CHARS.indexOf(clean[i]);
    if (v === -1) continue;
    val = (val << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out[idx++] = (val >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }
  return out;
}

function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

function formatSecret(secret) {
  return String(secret || '').replace(/\s+/g, '').toUpperCase().match(/.{1,4}/g)?.join(' ') || secret;
}

function calculateTotp(secret, timeStep = 30, t = Date.now()) {
  const counter = Math.floor(t / 1000 / timeStep);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const key = base32Decode(secret);
  if (!key || !key.length) return '';
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) |
               ((hmac[offset + 1] & 0xff) << 16) |
               ((hmac[offset + 2] & 0xff) << 8) |
               (hmac[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, '0');
}

function verify(secret, token, window = 1, t = Date.now()) {
  if (!secret || !token) return false;
  const tok = String(token).replace(/\s+/g, '');
  if (!/^\d{6}$/.test(tok)) return false;
  const step = 30;
  for (let i = -window; i <= window; i++) {
    if (calculateTotp(secret, step, t + i * step * 1000) === tok) return true;
  }
  return false;
}

function otpAuthUrl({ email, secret, issuer = 'LinguaFlow' }) {
  const cleanEmail = encodeURIComponent(String(email || 'user').trim());
  const cleanIssuer = encodeURIComponent(issuer);
  return `otpauth://totp/${cleanIssuer}:${cleanEmail}?secret=${secret}&issuer=${cleanIssuer}&algorithm=SHA1&digits=6&period=30`;
}

async function qrDataUrl(url) {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 240,
    color: {
      dark: '#111827',
      light: '#ffffff',
    },
  });
}

function generateBackupCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const hex = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(`${hex.slice(0, 4)}-${hex.slice(4, 8)}`);
  }
  return codes;
}

function verifyBackupCode(savedCodes, input) {
  if (!Array.isArray(savedCodes) || !input) return { valid: false, remaining: savedCodes || [] };
  const normalized = String(input).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (normalized.length !== 8) return { valid: false, remaining: savedCodes };
  const idx = savedCodes.findIndex((c) => String(c).replace(/[^a-zA-Z0-9]/g, '').toUpperCase() === normalized);
  if (idx === -1) return { valid: false, remaining: savedCodes };
  const remaining = [...savedCodes];
  remaining.splice(idx, 1);
  return { valid: true, remaining };
}

module.exports = {
  generateSecret,
  formatSecret,
  calculateTotp,
  verify,
  otpAuthUrl,
  qrDataUrl,
  generateBackupCodes,
  verifyBackupCode,
};
