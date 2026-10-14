'use strict';
// Usage: node scripts/backup.js [keep]   (honours DATA_DIR) -> DATA_DIR/backups/linguaflow-<time>.db
const path = require('node:path');
const { open } = require('../src/db');
const { backupNow } = require('../src/backup');
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const db = open(path.join(dataDir, 'linguaflow.db'));
const r = backupNow(db, path.join(dataDir, 'backups'), { keep: Number(process.argv[2]) || 7 });
console.log(`Zaxira nusxa: ${r.file} (${Math.round(r.size / 1024)} KB)`);
