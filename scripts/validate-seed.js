'use strict';
// Usage: node scripts/validate-seed.js [files...]  (default: all src/seed/*.js except index/validate)
const path = require('node:path');
const fs = require('node:fs');
const dir = path.join(__dirname, '..', 'src', 'seed');
const files = process.argv.slice(2).length ? process.argv.slice(2).map((f) => path.resolve(f))
  : fs.readdirSync(dir).filter((f) => /^(units_|sentences_)/.test(f)).map((f) => path.join(dir, f));
let errors = 0;
const err = (m) => { errors++; console.log('ERROR', m); };
const keys = new Set();
for (const f of files) {
  const data = require(f);
  if (!Array.isArray(data)) { err(`${f}: must export an array`); continue; }
  for (const u of data) {
    if (!u.key || !/^[a-z0-9]+$/.test(u.key)) err(`${f}: bad key ${u.key}`);
    if (u.rows) {
      if (keys.has(u.key)) err(`duplicate unit key ${u.key}`); keys.add(u.key);
      if (!u.title || !u.emoji) err(`${u.key}: title/emoji missing`);
      if (u.rows.length !== 10) err(`${u.key}: needs exactly 10 rows, has ${u.rows.length}`);
      const seen = [new Set(), new Set(), new Set(), new Set(), new Set(), new Set(), new Set()];
      u.rows.forEach((r, i) => {
        if (r.length !== 8) err(`${u.key} row ${i}: needs 8 columns [uz,en,ru,de,fr,es,ar,ar_translit], has ${r.length}`);
        r.forEach((c, j) => { if (typeof c !== 'string' || !c.trim()) err(`${u.key} row ${i} col ${j}: empty`); });
        for (let j = 0; j < 7; j++) { const v = String(r[j]).trim().toLowerCase(); if (seen[j].has(v)) err(`${u.key} row ${i}: duplicate value "${r[j]}" in col ${j}`); seen[j].add(v); }
      });
    }
    if (u.sentences) {
      if (u.sentences.length !== 6) err(`${u.key}: needs exactly 6 sentences, has ${u.sentences.length}`);
      u.sentences.forEach((s, i) => {
        if (s.length !== 7) err(`${u.key} sentence ${i}: needs 7 columns [uz,en,ru,de,fr,es,ar], has ${s.length}`);
        s.forEach((c, j) => { if (typeof c !== 'string' || !c.trim()) err(`${u.key} sentence ${i} col ${j}: empty`); else { const n = c.trim().split(/\s+/).length; if (j > 0 && (n < 2 || n > 9)) err(`${u.key} sentence ${i} col ${j}: ${n} words (want 2-9): ${c}`); } });
      });
    }
  }
}
console.log(errors ? `${errors} error(s)` : `OK (${files.length} file(s))`);
process.exit(errors ? 1 : 0);
