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
  `);
  ensureColumn(db, 'users', 'role', "TEXT NOT NULL DEFAULT 'user'");
  ensureColumn(db, 'users', 'banned', 'INTEGER NOT NULL DEFAULT 0');
  seedIfEmpty(db);
  return db;
}

function ensureColumn(db, table, col, def) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
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
      const cols = ['en', 'ru', 'de', 'fr', 'es', 'ar'];
      const insU = db.prepare('INSERT INTO units (key,title,emoji,enabled,position) VALUES (?,?,?,1,?)');
      const insC = db.prepare('INSERT INTO concepts (id,unit_key,position,uz,t,tr) VALUES (?,?,?,?,?,?)');
      const insS = db.prepare('INSERT INTO sentences (unit_key,position,uz,t) VALUES (?,?,?,?)');
      seed.units.forEach((u, ui) => {
        insU.run(u.key, u.title, u.emoji, ui);
        u.rows.forEach((r, i) => insC.run(`${u.key}.${i}`, u.key, i, r[0], JSON.stringify(Object.fromEntries(cols.map((c, j) => [c, r[j + 1]]))), JSON.stringify({ ar: r[7] })));
        (u.sentences || []).forEach((s, i) => insS.run(u.key, i, s[0], JSON.stringify(Object.fromEntries(cols.map((c, j) => [c, s[j + 1]])))));
      });
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { open, dateKey, dayStartMs, DAY, TZ_HOURS };
