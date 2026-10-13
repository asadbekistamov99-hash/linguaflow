'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { LANGS, RAW_UNITS } = require('./base');

// Seed = base units + every units_*.js file, with sentences merged in by unit key.
function loadSeed() {
  const units = RAW_UNITS.map((u) => ({ key: u.key, title: u.title, emoji: u.emoji, level: 'A1', rows: u.rows, sentences: [] }));
  const extra = fs.readdirSync(__dirname).filter((f) => /^units_.*\.js$/.test(f)).sort();
  for (const f of extra) {
    const m = /^units_lvl_([a-c][12])_/.exec(f);
    const level = m ? m[1].toUpperCase() : 'A1';
    for (const u of require(path.join(__dirname, f))) units.push({ key: u.key, title: u.title, emoji: u.emoji, level, rows: u.rows, sentences: u.sentences || [] });
  }
  try {
    for (const s of require('./sentences_base')) {
      const u = units.find((x) => x.key === s.key);
      if (u) u.sentences = s.sentences;
    }
  } catch { /* optional */ }
  return { LANGS, units };
}

module.exports = { loadSeed };
