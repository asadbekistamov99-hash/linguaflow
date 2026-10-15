'use strict';
// DEMO ONLY: builds a database where every content draft is approved and every unit is enabled, so the video can
// show all screens. Usage: DATA_DIR=/tmp/demo node explainer/prepare-demo.js
const path = require('node:path');
const { open } = require('../src/db');
const { importFiles, bundledFiles } = require('../src/bundled');
const dataDir = process.env.DATA_DIR;
if (!dataDir) throw new Error('DATA_DIR required');
const db = open(path.join(dataDir, 'linguaflow.db'));
const r = importFiles(db, bundledFiles());
db.prepare("UPDATE items SET status='approved'").run();
db.prepare('UPDATE units SET enabled=1').run();
console.log(`demo content: ${r.created} items approved, ${db.prepare('SELECT COUNT(*) n FROM units').get().n} units enabled`);
