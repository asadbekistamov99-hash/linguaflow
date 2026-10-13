'use strict';
// Usage: node scripts/import-items.js [--dry-run] file.json [more.json ...]   (honours DATA_DIR)
// Each file is a JSON array of items {lang, skill, level, type, payload, exam?}. Valid items are stored as
// DRAFTS (source 'ai', no author) so a native reviewer must approve them in the admin panel. Re-running is safe:
// items identical to an existing one are skipped.
const fs = require('node:fs');
const path = require('node:path');
const { open } = require('../src/db');
const { normalizeItem } = require('../src/items');

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) { console.error('Foydalanish: npm run import-items -- [--dry-run] fayl.json ...'); process.exit(1); }

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const db = open(path.join(dataDir, 'linguaflow.db'));
const langs = new Set(db.prepare('SELECT code FROM languages').all().map((l) => l.code));
const exists = db.prepare('SELECT 1 FROM items WHERE lang=? AND skill=? AND level=? AND type=? AND payload=?');
const ins = db.prepare("INSERT INTO items (lang,skill,level,exam,type,payload,status,source,author_id,created_at,updated_at) VALUES (?,?,?,?,?,?,'draft','ai',NULL,?,?)");

let created = 0, dup = 0, failed = 0;
for (const f of files) {
  let list;
  try { list = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { console.error(`${f}: o'qib bo'lmadi (${e.message})`); failed++; continue; }
  if (!Array.isArray(list)) { console.error(`${f}: JSON massiv bo'lishi kerak`); failed++; continue; }
  const now = Date.now();
  list.forEach((raw, i) => {
    try {
      const it = normalizeItem(raw, langs);
      const payload = JSON.stringify(it.payload);
      if (exists.get(it.lang, it.skill, it.level, it.type, payload)) { dup++; return; }
      if (!dry) ins.run(it.lang, it.skill, it.level, it.exam, it.type, payload, now, now);
      created++;
    } catch (e) { failed++; console.error(`${path.basename(f)}[${i}]: ${e.message}`); }
  });
}
console.log(`${dry ? '[dry-run] ' : ''}qoralama: ${created}, takror: ${dup}, xato: ${failed}`);
process.exit(failed ? 1 : 0);
