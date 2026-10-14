'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Consistent online snapshot of the SQLite database (VACUUM INTO works while the app is serving requests).
// Old snapshots beyond `keep` are deleted. File names sort chronologically.
function backupNow(db, dir, { keep = 7, now = new Date() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const file = path.join(dir, `linguaflow-${stamp}.db`);
  if (fs.existsSync(file)) fs.rmSync(file);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const all = fs.readdirSync(dir).filter((f) => /^linguaflow-.*\.db$/.test(f)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - keep))) fs.rmSync(path.join(dir, old), { force: true });
  db.prepare("INSERT INTO settings (key,value) VALUES ('last_backup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({ at: now.getTime(), file: path.basename(file), size: fs.statSync(file).size }));
  return { file, size: fs.statSync(file).size };
}

const lastBackup = (db) => { try { return JSON.parse(db.prepare("SELECT value FROM settings WHERE key='last_backup'").get()?.value || 'null'); } catch { return null; } };

// Daily backups without cron: runs shortly after start when the last one is older than the interval, then on a timer.
function scheduleBackups(db, dir, { everyHours = 24, keep = 7 } = {}) {
  const ms = everyHours * 3600000;
  const run = () => { try { const r = backupNow(db, dir, { keep }); console.log(`[backup] ${path.basename(r.file)} (${Math.round(r.size / 1024)} KB)`); } catch (e) { console.error('[backup] failed:', e.message); } };
  const last = lastBackup(db);
  const first = setTimeout(run, !last || Date.now() - last.at > ms ? 30000 : Math.max(30000, ms - (Date.now() - last.at)));
  const timer = setInterval(run, ms);
  first.unref(); timer.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}

module.exports = { backupNow, lastBackup, scheduleBackups };
