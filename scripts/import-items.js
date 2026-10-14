'use strict';
// Usage: node scripts/import-items.js [--dry-run] file.json [more.json ...]   (honours DATA_DIR)
// Each file is a JSON array of items {lang, skill, level, type, payload, exam?}. Valid items are stored as
// DRAFTS (source 'ai', no author) so a native reviewer must approve them in the admin panel. Re-running is safe:
// items identical to an existing one are skipped. Admins can do the same for the bundled files from the panel.
const path = require('node:path');
const { open } = require('../src/db');
const { importFiles } = require('../src/bundled');

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) { console.error('Foydalanish: npm run import-items -- [--dry-run] fayl.json ...'); process.exit(1); }

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const db = open(path.join(dataDir, 'linguaflow.db'));
const r = importFiles(db, files, { dryRun: dry });
for (const e of r.errors) console.error(e);
console.log(`${dry ? '[dry-run] ' : ''}qoralama: ${r.created}, takror: ${r.duplicates}, xato: ${r.failed}`);
process.exit(r.failed ? 1 : 0);
