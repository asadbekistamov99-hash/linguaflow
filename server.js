'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Minimal .env loader (no dependencies). Real environment variables win over the file.
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch { /* no .env file */ }

const { createApp } = require('./src/app');
const { activeProvider } = require('./src/tutor');

const port = Number(process.env.PORT) || 3000;
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const { server, db } = createApp({ dataDir, dbFile: path.join(dataDir, 'linguaflow.db') });
const host = '0.0.0.0';
if (process.env.BACKUP_ENABLED !== '0') {
  require('./src/backup').scheduleBackups(db, path.join(dataDir, 'backups'), { everyHours: Number(process.env.BACKUP_EVERY_HOURS) || 24, keep: Number(process.env.BACKUP_KEEP) || 7 });
}
server.listen(port, host, () => console.log(`LinguaFlow: http://${host}:${port} | AI ustoz: ${activeProvider() || "o'chiq"}`));

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
