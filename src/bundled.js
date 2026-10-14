'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { normalizeItem } = require('./items');

const ITEMS_DIR = path.join(__dirname, '..', 'content', 'items');

// Imports JSON item files (arrays of items) as AI-sourced DRAFTS. Items identical to an existing one are skipped,
// so it is safe to run repeatedly (CLI and the admin "bundled content" button share this).
function importFiles(db, files, { dryRun = false } = {}) {
  const langs = new Set(db.prepare('SELECT code FROM languages').all().map((l) => l.code));
  const exists = db.prepare('SELECT 1 FROM items WHERE lang=? AND skill=? AND level=? AND type=? AND payload=?');
  const ins = db.prepare("INSERT INTO items (lang,skill,level,exam,type,payload,status,source,author_id,created_at,updated_at) VALUES (?,?,?,?,?,?,'draft','ai',NULL,?,?)");
  const total = { created: 0, duplicates: 0, failed: 0 };
  const perFile = [];
  const errors = [];
  for (const f of files) {
    const stat = { file: path.basename(f), created: 0, duplicates: 0, failed: 0 };
    let list;
    try { list = JSON.parse(fs.readFileSync(f, 'utf8')); if (!Array.isArray(list)) throw new Error('JSON massiv bo\'lishi kerak'); }
    catch (e) { stat.failed++; errors.push(`${stat.file}: ${e.message}`); perFile.push(stat); total.failed++; continue; }
    const now = Date.now();
    list.forEach((raw, i) => {
      try {
        const it = normalizeItem(raw, langs);
        const payload = JSON.stringify(it.payload);
        if (exists.get(it.lang, it.skill, it.level, it.type, payload)) { stat.duplicates++; return; }
        if (!dryRun) ins.run(it.lang, it.skill, it.level, it.exam, it.type, payload, now, now);
        stat.created++;
      } catch (e) { stat.failed++; errors.push(`${stat.file}[${i}]: ${e.message}`); }
    });
    for (const k of ['created', 'duplicates', 'failed']) total[k] += stat[k];
    perFile.push(stat);
  }
  return { ...total, files: perFile, errors: errors.slice(0, 50) };
}

const bundledFiles = () => (fs.existsSync(ITEMS_DIR) ? fs.readdirSync(ITEMS_DIR).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(ITEMS_DIR, f)) : []);

module.exports = { importFiles, bundledFiles, ITEMS_DIR };
