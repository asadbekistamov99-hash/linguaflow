'use strict';
// Usage: node scripts/make-admin.js user@example.com [--remove]   (honours DATA_DIR)
const path = require('node:path');
const { open } = require('../src/db');

const email = String(process.argv[2] || '').trim().toLowerCase();
const remove = process.argv.includes('--remove');
if (!email || email.startsWith('--')) { console.error('Foydalanish: npm run make-admin -- user@example.com [--remove]'); process.exit(1); }
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const db = open(path.join(dataDir, 'linguaflow.db'));
const u = db.prepare('SELECT id, role FROM users WHERE email=?').get(email);
if (!u) { console.error(`Bunday foydalanuvchi topilmadi: ${email} (avval ro'yxatdan o'ting)`); process.exit(1); }
db.prepare('UPDATE users SET role=? WHERE id=?').run(remove ? 'user' : 'admin', u.id);
console.log(remove ? `${email} endi oddiy foydalanuvchi.` : `${email} endi admin. /admin sahifasiga kiring.`);
