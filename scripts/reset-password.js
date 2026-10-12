'use strict';
// Usage: node scripts/reset-password.js user@example.com newpassword   (honours DATA_DIR)
const path = require('node:path');
const { open } = require('../src/db');
const auth = require('../src/auth');

const email = String(process.argv[2] || '').trim().toLowerCase();
const password = String(process.argv[3] || '').trim();

if (!email || !password) {
  console.error('Foydalanish: node scripts/reset-password.js user@example.com yangiparol');
  process.exit(1);
}

if (password.length < 8) {
  console.error("Xato: Parol kamida 8 ta belgidan iborat bo'lishi kerak.");
  process.exit(1);
}

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const db = open(path.join(dataDir, 'linguaflow.db'));
const u = db.prepare('SELECT id, email FROM users WHERE email=?').get(email);
if (!u) {
  console.error(`Bunday foydalanuvchi topilmadi: ${email}`);
  process.exit(1);
}

const hash = auth.hashPassword(password);
db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(hash, u.id);
console.log(`Muvaffaqiyatli! ${email} foydalanuvchisi paroli yangilandi.`);
