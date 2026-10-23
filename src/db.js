'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DAY = 86400000;
const TZ_HOURS = Number(process.env.TZ_OFFSET_HOURS ?? 5);
const dateKey = (ms = Date.now()) => Math.floor((ms + TZ_HOURS * 3600000) / DAY);

const dayStartMs = (key) => key * DAY - TZ_HOURS * 3600000;

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      pass_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0,
      best_streak INTEGER NOT NULL DEFAULT 0,
      last_active INTEGER,
      daily_goal INTEGER NOT NULL DEFAULT 20,
      current_lang TEXT NOT NULL DEFAULT 'en'
    );
    CREATE TABLE IF NOT EXISTS lesson_progress (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lesson_id TEXT NOT NULL,
      stars INTEGER NOT NULL DEFAULT 0,
      best_acc REAL NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      completed_at INTEGER,
      PRIMARY KEY (user_id, lesson_id)
    );
    CREATE TABLE IF NOT EXISTS word_progress (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lang TEXT NOT NULL,
      concept_id TEXT NOT NULL,
      reps INTEGER NOT NULL DEFAULT 0,
      ease REAL NOT NULL DEFAULT 2.3,
      interval_days REAL NOT NULL DEFAULT 0,
      due_at INTEGER NOT NULL,
      lapses INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, lang, concept_id)
    );
    CREATE INDEX IF NOT EXISTS idx_word_due ON word_progress(user_id, lang, due_at);
    CREATE TABLE IF NOT EXISTS xp_events (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      lang TEXT,
      source TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_xp_user_time ON xp_events(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_xp_time ON xp_events(created_at);
    CREATE TABLE IF NOT EXISTS badges (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      earned_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, key)
    );
    CREATE TABLE IF NOT EXISTS languages (
      code TEXT PRIMARY KEY, name TEXT NOT NULL, native TEXT NOT NULL, flag TEXT NOT NULL,
      tts TEXT NOT NULL, dir TEXT NOT NULL DEFAULT 'ltr', color TEXT NOT NULL DEFAULT '#7c5cff',
      enabled INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS units (
      key TEXT PRIMARY KEY, title TEXT NOT NULL, emoji TEXT NOT NULL DEFAULT '📘',
      enabled INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS concepts (
      id TEXT PRIMARY KEY, unit_key TEXT NOT NULL REFERENCES units(key) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0, uz TEXT NOT NULL, t TEXT NOT NULL DEFAULT '{}', tr TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_concepts_unit ON concepts(unit_key, position);
    CREATE TABLE IF NOT EXISTS sentences (
      id INTEGER PRIMARY KEY AUTOINCREMENT, unit_key TEXT NOT NULL REFERENCES units(key) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0, uz TEXT NOT NULL, t TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_sentences_unit ON sentences(unit_key, position);
    CREATE TABLE IF NOT EXISTS game_scores (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game TEXT NOT NULL, lang TEXT NOT NULL, score INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_game_scores ON game_scores(game, created_at);
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY, admin_id INTEGER, action TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lang TEXT NOT NULL, skill TEXT NOT NULL, level TEXT NOT NULL, exam TEXT NOT NULL DEFAULT 'general',
      type TEXT NOT NULL, payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft', source TEXT NOT NULL DEFAULT 'manual',
      author_id INTEGER, reviewer_id INTEGER, review_note TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_items_main ON items(lang, level, skill, status);
    CREATE TABLE IF NOT EXISTS reviewer_langs (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, lang TEXT NOT NULL, PRIMARY KEY (user_id, lang)
    );
    CREATE TABLE IF NOT EXISTS ai_usage (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, day INTEGER NOT NULL, feature TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day, feature)
    );
    CREATE TABLE IF NOT EXISTS user_certificates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cert_id TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_name TEXT NOT NULL,
      lang TEXT NOT NULL,
      cefr_level TEXT NOT NULL,
      exam_title TEXT NOT NULL,
      band_score TEXT NOT NULL,
      accuracy INTEGER NOT NULL,
      issued_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cert_user ON user_certificates(user_id, lang);
    CREATE TABLE IF NOT EXISTS skill_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, lang TEXT NOT NULL, level TEXT NOT NULL, item_id INTEGER,
      prompt TEXT NOT NULL, input TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_skill_user ON skill_submissions(user_id, kind, created_at);
    CREATE TABLE IF NOT EXISTS mock_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lang TEXT NOT NULL, level TEXT NOT NULL, total INTEGER NOT NULL, correct INTEGER NOT NULL,
      sections TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mock_user ON mock_results(user_id, created_at);
    CREATE TABLE IF NOT EXISTS practice_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lang TEXT NOT NULL, skill TEXT NOT NULL, level TEXT NOT NULL, item_id INTEGER,
      correct INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_plog_user ON practice_log(user_id, lang, created_at);
    CREATE TABLE IF NOT EXISTS mistakes (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_id INTEGER NOT NULL, lang TEXT NOT NULL,
      wrong_count INTEGER NOT NULL DEFAULT 1, streak_ok INTEGER NOT NULL DEFAULT 0, last_wrong_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, item_id)
    );
    CREATE TABLE IF NOT EXISTS item_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL,
      UNIQUE (item_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_reports_item ON item_reports(item_id, status);
  `);
  ensureColumn(db, 'users', 'role', "TEXT NOT NULL DEFAULT 'user'");
  ensureColumn(db, 'users', 'banned', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'session_ver', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'totp_secret', 'TEXT');
  ensureColumn(db, 'users', 'totp_enabled', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'totp_backup_codes', 'TEXT');
  ensureColumn(db, 'units', 'level', "TEXT NOT NULL DEFAULT 'A1'");
  seedIfEmpty(db);
  syncSeed(db);
  return db;
}

function ensureColumn(db, table, col, def) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

const SEED_COLS = ['en', 'ru', 'de', 'fr', 'es', 'ar'];

function insertUnit(db, u, enabled, position) {
  db.prepare('INSERT INTO units (key,title,emoji,enabled,position,level) VALUES (?,?,?,?,?,?)').run(u.key, u.title, u.emoji, enabled ? 1 : 0, position, u.level || 'A1');
  const insC = db.prepare('INSERT INTO concepts (id,unit_key,position,uz,t,tr) VALUES (?,?,?,?,?,?)');
  const insS = db.prepare('INSERT INTO sentences (unit_key,position,uz,t) VALUES (?,?,?,?)');
  u.rows.forEach((r, i) => insC.run(`${u.key}.${i}`, u.key, i, r[0], JSON.stringify(Object.fromEntries(SEED_COLS.map((c, j) => [c, r[j + 1]]))), JSON.stringify({ ar: r[7] })));
  (u.sentences || []).forEach((s, i) => insS.run(u.key, i, s[0], JSON.stringify(Object.fromEntries(SEED_COLS.map((c, j) => [c, s[j + 1]])))));
}

function seedIfEmpty(db) {
  const { loadSeed } = require('./seed');
  const seed = loadSeed();
  db.exec('BEGIN');
  try {
    if (!db.prepare('SELECT COUNT(*) n FROM languages').get().n) {
      const ins = db.prepare('INSERT INTO languages (code,name,native,flag,tts,dir,color,enabled,position) VALUES (?,?,?,?,?,?,?,1,?)');
      Object.values(seed.LANGS).forEach((l, i) => ins.run(l.code, l.name, l.native, l.flag, l.tts, l.dir, l.color, i));
    }
    if (!db.prepare('SELECT COUNT(*) n FROM units').get().n) {
      // A1 units are live at once; A2/B1 drafts stay hidden until a reviewer enables them in the admin panel.
      seed.units.forEach((u, ui) => insertUnit(db, u, (u.level || 'A1') === 'A1', ui));
      db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('seed_units_applied',?)").run(JSON.stringify(seed.units.map((u) => u.key)));
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Existing databases receive units added to the seed later (disabled). Units an admin deleted are not resurrected.
function syncSeed(db) {
  const { loadSeed } = require('./seed');
  const seed = loadSeed();
  const row = db.prepare("SELECT value FROM settings WHERE key='seed_units_applied'").get();
  const applied = new Set(row ? JSON.parse(row.value) : seed.units.filter((u) => (u.level || 'A1') === 'A1').map((u) => u.key));
  const fresh = seed.units.filter((u) => !applied.has(u.key));
  if (row && !fresh.length) return;
  db.exec('BEGIN');
  try {
    let pos = db.prepare('SELECT COALESCE(MAX(position),-1)+1 n FROM units').get().n;
    for (const u of fresh) {
      if (!db.prepare('SELECT 1 FROM units WHERE key=?').get(u.key)) insertUnit(db, u, false, pos++);
      applied.add(u.key);
    }
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('seed_units_applied',?)").run(JSON.stringify([...applied]));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { open, dateKey, dayStartMs, DAY, TZ_HOURS };
