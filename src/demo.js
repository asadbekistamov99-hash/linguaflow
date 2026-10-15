'use strict';
// DEMO MODE (used on hosts without a persistent disk, e.g. Vercel): fills a fresh database with all bundled content,
// approved and enabled, so every screen can be tried. Data does NOT survive restarts there.
const { importFiles, bundledFiles } = require('./bundled');

const BANNER = "Demo rejimi: ma'lumotlar vaqtincha saqlanadi va istalgan vaqt o'chib ketishi mumkin. Haqiqiy foydalanish uchun doimiy serverdan foydalaning.";

function seedDemo(db) {
  if (db.prepare("SELECT value FROM settings WHERE key='demo_seeded'").get()) return;
  db.exec('BEGIN');
  try {
    importFiles(db, bundledFiles());
    db.prepare("UPDATE items SET status='approved'").run();
    db.prepare('UPDATE units SET enabled=1').run();
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('announcement',?)").run(JSON.stringify({ enabled: true, text: BANNER, level: 'warn' }));
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('demo_seeded','1')").run();
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { seedDemo, BANNER };
