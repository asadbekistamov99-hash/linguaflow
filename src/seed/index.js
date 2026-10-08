'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { LANGS, RAW_UNITS } = require('./base');

// Seed = base units + every units_*.js file, with sentences merged in by unit key.
function loadSeed() {
  const units = RAW_UNITS.map((u) => ({ key: u.key, title: u.title, emoji: u.emoji, rows: u.rows, sentences: [] }));
  const extra = fs.readdirSync(__dirname).filter((f) => /^units_.*\.js$/.test(f)).sort();
  for (const f of extra) for (const u of require(path.join(__dirname, f))) units.push({ key: u.key, title: u.title, emoji: u.emoji, rows: u.rows, sentences: u.sentences || [] });
  try {
    for (const s of require('./sentences_base')) {
      const u = units.find((x) => x.key === s.key);
      if (u) u.sentences = s.sentences;
    }
  } catch { /* optional */ }
  return { LANGS, units };
}

module.exports = { loadSeed };
