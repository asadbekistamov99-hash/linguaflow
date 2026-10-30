'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const { open, dateKey, dayStartMs, DAY } = require('./db');
const auth = require('./auth');
const { createContent } = require('./content');
const ex = require('./exercises');
const srs = require('./srs');
const tutor = require('./tutor');
const registerGames = require('./games');
const registerAdmin = require('./admin');
const registerItems = require('./items');
const registerPractice = require('./practice');
const registerSkills = require('./skills');
const registerLearning = require('./learning');
const { createQuota } = require('./quota');
const { STAGES, buildMockExam } = require('./curriculum');
const { generateJarvisReply, generatePronunciationFeedback } = require('./jarvis');
const totp = require('./totp');

let fbAppletConfig = null;
try { fbAppletConfig = require('../firebase-applet-config.json'); } catch { /* no fb config */ }

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

const BADGES = {
  first_lesson: { title: 'Birinchi qadam', desc: 'Birinchi darsni tugatdingiz', emoji: '🌱' },
  perfect: { title: 'Benuqson', desc: 'Darsni 100% aniqlikda tugatdingiz', emoji: '💎' },
  streak_3: { title: '3 kunlik seriya', desc: "Ketma-ket 3 kun o'qidingiz", emoji: '🔥' },
  streak_7: { title: 'Haftalik seriya', desc: "Ketma-ket 7 kun o'qidingiz", emoji: '🏅' },
  streak_30: { title: 'Oylik seriya', desc: "Ketma-ket 30 kun o'qidingiz", emoji: '👑' },
  xp_100: { title: '100 XP', desc: "100 XP to'pladingiz", emoji: '⭐' },
  xp_500: { title: '500 XP', desc: "500 XP to'pladingiz", emoji: '🚀' },
  xp_2000: { title: '2000 XP', desc: "2000 XP to'pladingiz", emoji: '🌟' },
  polyglot: { title: 'Poliglot', desc: '3 xil tilda dars tugatdingiz', emoji: '🌍' },
  reviewer: { title: 'Takrorlovchi', desc: 'Birinchi takrorlashni tugatdingiz', emoji: '🧠' },
  unit_master: { title: 'Mavzu ustasi', desc: 'Birinchi mavzu testidan o\'tdingiz', emoji: '🎓' },
  master_5: { title: 'Besh mavzu', desc: '5 ta mavzu testidan o\'tdingiz', emoji: '🏆' },
  gamer: { title: "O'yinchi", desc: "Birinchi o'yinni o'ynadingiz", emoji: '🎮' },
  gamer_10: { title: "O'yin ustasi", desc: "10 ta o'yin o'ynadingiz", emoji: '🕹️' },
  explorer: { title: 'Tadqiqotchi', desc: 'Daraja testini topshirdingiz', emoji: '🧭' },
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const REPEAT_XP_CAP = 60;
const CERT_DISCLAIMER = "Bu LinguaFlow ichki tayyorgarlik sertifikati. U rasmiy IELTS, CEFR yoki boshqa xalqaro imtihon sertifikati emas; ball taxminiy.";
const levelOf = (xp) => Math.floor(Math.sqrt(xp / 50)) + 1;
const starsFor = (acc, kind) => (kind === 'test' ? (acc >= 0.95 ? 3 : acc >= 0.85 ? 2 : acc >= 0.8 ? 1 : 0) : (acc >= 0.9 ? 3 : acc >= 0.75 ? 2 : acc >= 0.6 ? 1 : 0));

function createApp({ dbFile = path.join(__dirname, '..', 'data', 'linguaflow.db'), dataDir = path.join(__dirname, '..', 'data'), allowFraming = false } = {}) {
  const db = open(dbFile);
  const content = createContent(db);
  const secret = auth.loadSecret(dataDir);
  const sessions = new Map();
  const loginLimiter = auth.createLimiter(10, 15 * 60000);
  const registerLimiter = auth.createLimiter(10, 60 * 60000);
  const quota = createQuota(db);
  const recoveryLimiter = auth.createLimiter(5, 60 * 60000);
  const guestLimiter = auth.createLimiter(10, 60 * 60000);
  const examLimiter = auth.createLimiter(12, 60 * 60000);
  const loginIpLimiter = auth.createLimiter(40, 15 * 60000);
  const defaultAdmins = ['asadbekistamov99@gmail.com'];
  const envAdmins = String(process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const adminEmails = new Set([...defaultAdmins, ...envAdmins]);

  const q = {
    userById: db.prepare('SELECT * FROM users WHERE id=?'),
    userByEmail: db.prepare('SELECT * FROM users WHERE email=?'),
    insertUser: db.prepare('INSERT INTO users (email,name,pass_hash,created_at,role) VALUES (?,?,?,?,?)'),
    progress: db.prepare('SELECT * FROM lesson_progress WHERE user_id=?'),
    progressOne: db.prepare('SELECT * FROM lesson_progress WHERE user_id=? AND lesson_id=?'),
    upsertProgress: db.prepare(`
      INSERT INTO lesson_progress (user_id,lesson_id,stars,best_acc,attempts,completed_at) VALUES (?,?,?,?,1,?)
      ON CONFLICT(user_id,lesson_id) DO UPDATE SET
        stars=MAX(stars,excluded.stars), best_acc=MAX(best_acc,excluded.best_acc), attempts=attempts+1,
        completed_at=COALESCE(completed_at, excluded.completed_at)`),
    markDone: db.prepare('INSERT OR IGNORE INTO lesson_progress (user_id,lesson_id,stars,best_acc,attempts,completed_at) VALUES (?,?,1,0.7,0,?)'),
    addXp: db.prepare('INSERT INTO xp_events (user_id,amount,lang,source,created_at) VALUES (?,?,?,?,?)'),
    repeatXpToday: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM xp_events WHERE user_id=? AND source IN ('lesson:replay','test:replay','review') AND created_at>=?"),
    xpBetween: db.prepare('SELECT COALESCE(SUM(amount),0) s FROM xp_events WHERE user_id=? AND created_at>=? AND created_at<?'),
    updateUserGame: db.prepare('UPDATE users SET xp=xp+?, streak=?, best_streak=?, last_active=? WHERE id=?'),
    badges: db.prepare('SELECT key, earned_at FROM badges WHERE user_id=?'),
    giveBadge: db.prepare('INSERT OR IGNORE INTO badges (user_id,key,earned_at) VALUES (?,?,?)'),
    leaderboard: db.prepare(`
      SELECT u.id, u.name, COALESCE(SUM(x.amount),0) xp
      FROM users u JOIN xp_events x ON x.user_id=u.id AND x.created_at>=?
      WHERE u.banned=0 GROUP BY u.id ORDER BY xp DESC, u.id LIMIT 20`),
    langsWithProgress: db.prepare("SELECT DISTINCT substr(lesson_id,1,instr(lesson_id,'.')-1) lang FROM lesson_progress WHERE user_id=? AND completed_at IS NOT NULL"),
    testsPassed: db.prepare("SELECT COUNT(*) n FROM lesson_progress WHERE user_id=? AND lesson_id LIKE '%.test' AND completed_at IS NOT NULL"),
    gamesPlayed: db.prepare('SELECT COUNT(*) n FROM game_scores WHERE user_id=?'),
    wordStats: db.prepare('SELECT COUNT(*) total, SUM(CASE WHEN reps>=3 THEN 1 ELSE 0 END) strong FROM word_progress WHERE user_id=? AND lang=?'),
    wordsByLang: db.prepare('SELECT concept_id, reps FROM word_progress WHERE user_id=? AND lang=?'),
    userCount: db.prepare('SELECT COUNT(*) n FROM users'),
    setting: db.prepare('SELECT value FROM settings WHERE key=?'),
    audit: db.prepare('INSERT INTO audit_log (admin_id,action,detail,created_at) VALUES (?,?,?,?)'),
    flashcardsByLang: db.prepare('SELECT id, user_id, lang, concept_id, front, back, hint, example, reps, ease, interval_days, due_at, lapses, created_at FROM user_flashcards WHERE user_id=? AND lang=? ORDER BY due_at ASC, id DESC'),
    flashcardById: db.prepare('SELECT id, user_id, lang, concept_id, front, back, hint, example, reps, ease, interval_days, due_at, lapses, created_at FROM user_flashcards WHERE id=? AND user_id=?'),
    flashcardByConcept: db.prepare('SELECT id, user_id, lang, concept_id, front, back, hint, example, reps, ease, interval_days, due_at, lapses, created_at FROM user_flashcards WHERE user_id=? AND lang=? AND concept_id=?'),
    flashcardByFront: db.prepare('SELECT id, user_id, lang, concept_id, front, back, hint, example, reps, ease, interval_days, due_at, lapses, created_at FROM user_flashcards WHERE user_id=? AND lang=? AND front=?'),
    flashcardInsert: db.prepare('INSERT INTO user_flashcards (user_id, lang, concept_id, front, back, hint, example, reps, ease, interval_days, due_at, lapses, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    flashcardUpdateReview: db.prepare('UPDATE user_flashcards SET reps=?, ease=?, interval_days=?, due_at=?, lapses=? WHERE id=?'),
    flashcardDelete: db.prepare('DELETE FROM user_flashcards WHERE id=? AND user_id=?'),
    flashcardsConceptIds: db.prepare('SELECT concept_id FROM user_flashcards WHERE user_id=? AND lang=? AND concept_id IS NOT NULL'),
    flashcardsAll: db.prepare('SELECT id, user_id, lang, concept_id, front, back, hint, example, reps, ease, interval_days, due_at, lapses, created_at FROM user_flashcards WHERE user_id=? ORDER BY due_at ASC, id DESC'),
    flashcardsDeckCounts: db.prepare('SELECT lang, COUNT(*) total, SUM(CASE WHEN due_at <= ? THEN 1 ELSE 0 END) due_count FROM user_flashcards WHERE user_id=? GROUP BY lang'),
  };

  // ---------- helpers ----------
  const validLang = (code) => {
    const ok = content.langs();
    return ok.some((l) => l.code === code) ? code : (ok[0] ? ok[0].code : 'en');
  };

  function publicUser(u) {
    const now = Date.now();
    const today = dateKey(now);
    const startMs = dayStartMs(today);
    const dailyXp = q.xpBetween.get(u.id, startMs, startMs + DAY).s;
    const streakAlive = u.last_active != null && (u.last_active === today || u.last_active === today - 1);
    const currentStreak = streakAlive ? u.streak : 0;
    const goal = u.daily_goal || 20;
    const todayMet = dailyXp >= goal;

    // Build 7-day history and calculate consecutive days daily goal met
    const past7 = [];
    const dayNames = ['Ya', 'Du', 'Se', 'Cho', 'Pa', 'Ju', 'Sha'];
    let consecutiveMet = todayMet ? 1 : 0;
    let chainAlive = true;

    for (let i = 0; i < 7; i++) {
      const dKey = today - i;
      const dStart = dayStartMs(dKey);
      const dayXp = (i === 0) ? dailyXp : q.xpBetween.get(u.id, dStart, dStart + DAY).s;
      const met = dayXp >= goal || (i > 0 && currentStreak > i);
      const dObj = new Date(dStart + 12 * 3600000);
      const dayName = dayNames[dObj.getDay()];
      past7.unshift({
        key: dKey,
        day: dayName,
        xp: dayXp,
        met,
        isToday: i === 0,
      });

      if (i > 0 && chainAlive) {
        if (met) {
          consecutiveMet++;
        } else {
          chainAlive = false;
        }
      }
    }

    const goalStreak = Math.max(consecutiveMet, todayMet ? Math.max(1, currentStreak) : currentStreak);
    const bestGoalStreak = Math.max(goalStreak, u.best_streak || 0);

    const reviewerLangs = u.role === 'reviewer' ? db.prepare('SELECT lang FROM reviewer_langs WHERE user_id=?').all(u.id).map((r) => r.lang) : [];
    return {
      id: u.id, name: u.name, email: u.email, role: u.role, isAdmin: u.role === 'admin', isStaff: u.role === 'admin' || u.role === 'reviewer', reviewerLangs, xp: u.xp, level: levelOf(u.xp),
      streak: currentStreak, bestStreak: u.best_streak, dailyGoal: goal,
      dailyXp, doneToday: u.last_active === today, currentLang: validLang(u.current_lang),
      goalMetToday: todayMet,
      goalStreak,
      bestGoalStreak,
      goalHistory: past7,
      twoFactorEnabled: !!u.totp_enabled,
    };
  }

  function extractToken(req) {
    const authHeader = req.headers && req.headers['authorization'];
    if (authHeader && /^Bearer\s+/i.test(authHeader)) {
      return authHeader.replace(/^Bearer\s+/i, '').trim();
    }
    const cookies = auth.parseCookies(req.headers && req.headers.cookie);
    return cookies[auth.COOKIE];
  }

  function requireUser(req) {
    const rawToken = extractToken(req);
    let tok = auth.verify(secret, rawToken);

    // Also support verifying Firebase ID Token directly if rawToken is a Firebase JWT
    if (!tok && rawToken && rawToken.split('.').length === 3) {
      try {
        const parts = rawToken.split('.');
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (payload && payload.iss && payload.iss.startsWith('https://securetoken.google.com/')) {
          const candEmail = payload.email || (payload.firebase && payload.firebase.identities && payload.firebase.identities.email && payload.firebase.identities.email[0]);
          if (candEmail && (Number(payload.exp) * 1000 + 300000) > Date.now()) {
            tok = {
              email: candEmail.toLowerCase(),
              name: payload.name || candEmail.split('@')[0],
              ca: Number(payload.auth_time || payload.iat || 0) * 1000,
              sv: 0,
            };
          }
        }
      } catch {}
    }

    if (!tok) throw new HttpError(401, 'Tizimga kiring');

    let u = tok.uid ? q.userById.get(tok.uid) : null;
    if (!u && tok.isGoogle && tok.email) {
      u = q.userByEmail.get(tok.email);
      if (!u) {
        const role = adminEmails.has(tok.email) ? 'admin' : (tok.role || 'user');
        const finalName = tok.name && tok.name.length >= 2 ? tok.name : `${tok.email.split('@')[0]}_`;
        const createdAt = tok.ca || Date.now();
        const hash = auth.DUMMY_HASH;
        const ins = q.insertUser.run(tok.email, finalName, hash, createdAt, role);
        u = q.userById.get(Number(ins.lastInsertRowid));
      }
    }

    if (!u) throw new HttpError(401, 'Tizimga kiring');
    if (tok.ca && u.created_at !== tok.ca && !tok.isGoogle) throw new HttpError(401, 'Tizimga kiring');
    if ((u.session_ver || 0) !== (tok.sv || 0)) throw new HttpError(401, 'Tizimga kiring');
    if (u.banned) throw new HttpError(403, 'Hisobingiz bloklangan');
    return u;
  }
  function requireAdmin(req) {
    const u = requireUser(req);
    if (u.role !== 'admin') throw new HttpError(403, 'Faqat adminlar uchun');
    return u;
  }
  const logAudit = (adminId, action, detail) => q.audit.run(adminId, action, detail ? String(detail).slice(0, 500) : null, Date.now());

  function lessonStates(userId, lang) {
    const done = new Map(q.progress.all(userId).map((p) => [p.lesson_id, p]));
    const list = content.lessons(lang);
    let prevDone = true;
    const unitDone = new Map();
    for (const l of list) if (l.kind === 'lesson') unitDone.set(l.unit, (unitDone.get(l.unit) ?? true) && !!(done.get(l.id) && done.get(l.id).completed_at));
    return list.map((l) => {
      const p = done.get(l.id);
      const completed = !!(p && p.completed_at);
      let state;
      if (l.kind === 'test') state = completed ? 'done' : unitDone.get(l.unit) ? 'available' : 'locked';
      else { state = completed ? 'done' : prevDone ? 'available' : 'locked'; prevDone = completed; }
      return { ...l, state, stars: p ? p.stars : 0, bestAcc: p ? p.best_acc : 0 };
    });
  }

  function grantBadges(user, ctx = {}) {
    const have = new Set(q.badges.all(user.id).map((b) => b.key));
    const earned = [];
    const give = (k) => { if (!have.has(k)) { q.giveBadge.run(user.id, k, Date.now()); earned.push({ key: k, ...BADGES[k] }); have.add(k); } };
    if (ctx.lessonPassed) {
      give('first_lesson');
      if (ctx.perfect) give('perfect');
      if (q.langsWithProgress.all(user.id).length >= 3) give('polyglot');
    }
    if (ctx.review) give('reviewer');
    if (ctx.testPassed) { give('unit_master'); if (q.testsPassed.get(user.id).n >= 5) give('master_5'); }
    if (ctx.game) { give('gamer'); if (q.gamesPlayed.get(user.id).n >= 10) give('gamer_10'); }
    if (ctx.placement) give('explorer');
    if (ctx.streak >= 3) give('streak_3');
    if (ctx.streak >= 7) give('streak_7');
    if (ctx.streak >= 30) give('streak_30');
    if (user.xp >= 100) give('xp_100');
    if (user.xp >= 500) give('xp_500');
    if (user.xp >= 2000) give('xp_2000');
    return earned;
  }

  // Adds XP, updates the daily streak, records the event and grants badges.
  function awardProgress(user, { xp, lang, source, ctx = {} }) {
    const now = Date.now();
    const today = dateKey(now);
    let { streak, best_streak: best, last_active: last } = user;
    if (last !== today) {
      streak = last === today - 1 ? streak + 1 : 1;
      best = Math.max(best, streak);
    }
    db.exec('BEGIN');
    try {
      q.updateUserGame.run(xp, streak, best, today, user.id);
      if (xp) q.addXp.run(user.id, xp, lang, source, now);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    const fresh = q.userById.get(user.id);
    const badges = grantBadges(fresh, { ...ctx, streak });
    return { streak, user: publicUser(fresh), badges };
  }

  function finishSession(user, s) {
    const attempts = [...s.results.values()];
    const total = attempts.length;
    const correct = attempts.filter((r) => r.correct).length;
    const accuracy = total ? correct / total : 0;
    const now = Date.now();

    if (s.kind === 'placement') return finishPlacement(user, s, accuracy, total, correct);

    const perConcept = new Map();
    for (const r of attempts) for (const c of r.cids) perConcept.set(c.cid, (perConcept.get(c.cid) ?? true) && c.ok);
    srs.recordResults(db, user.id, s.lang, perConcept, now);

    let xp = 0, passed = true, stars = 0, firstTime = false;
    if (s.kind === 'lesson' || s.kind === 'test') {
      const need = s.kind === 'test' ? 0.8 : 0.6;
      passed = accuracy >= need;
      stars = passed ? starsFor(accuracy, s.kind) : 0;
      const prev = q.progressOne.get(user.id, s.lessonId);
      firstTime = !(prev && prev.completed_at);
      if (passed || !prev) q.upsertProgress.run(user.id, s.lessonId, stars, accuracy, passed ? now : null);
      xp = correct * 2 + (accuracy === 1 ? 10 : 0) + (s.kind === 'test' && passed && firstTime ? 20 : 0);
      if (!passed) xp = Math.floor(xp / 2);
      else if (!firstTime) xp = Math.ceil(xp / 2);
    } else {
      xp = correct + (accuracy >= 0.9 ? 5 : 0);
    }
    // Repeats (replayed lessons/tests and reviews) share a daily XP cap so they cannot be farmed.
    const repeat = !firstTime;
    let source = s.kind;
    if (repeat) {
      source = s.kind === 'review' ? 'review' : `${s.kind}:replay`;
      xp = Math.min(xp, Math.max(0, REPEAT_XP_CAP - q.repeatXpToday.get(user.id, dayStartMs(dateKey(now))).s));
    }
    const r = awardProgress(user, {
      xp, lang: s.lang, source,
      ctx: { lessonPassed: s.kind === 'lesson' && passed, perfect: accuracy === 1, review: s.kind === 'review', testPassed: s.kind === 'test' && passed },
    });
    return { kind: s.kind, total, correct, accuracy, xp, passed, stars, firstTime, streak: r.streak, user: r.user, badges: r.badges };
  }

  // Everything up to the last sampled unit the learner answered fully correctly counts as done.
  function finishPlacement(user, s, accuracy, total, correct) {
    const perUnit = new Map();
    for (const e of s.byId.values()) {
      if (!e.unit) continue;
      const r = s.results.get(e.id);
      perUnit.set(e.unit, (perUnit.get(e.unit) ?? 0) + (r && r.correct ? 1 : 0));
    }
    const ordered = content.unitsWithLessons(s.lang).map((u) => u.key);
    let lastPassed = -1;
    for (const [key, n] of perUnit) { // Map keeps insertion order = ascending unit order
      if (n < 2) break;
      lastPassed = ordered.indexOf(key);
    }
    const now = Date.now();
    let marked = 0;
    if (lastPassed >= 0) {
      const keys = new Set(ordered.slice(0, lastPassed + 1));
      for (const l of content.lessons(s.lang)) if (l.kind === 'lesson' && keys.has(l.unit) && !q.progressOne.get(user.id, l.id)) { q.markDone.run(user.id, l.id, now); marked++; }
    }
    const fresh = q.userById.get(user.id);
    const badges = grantBadges(fresh, { placement: true, streak: fresh.streak });
    return { kind: 'placement', total, correct, accuracy, xp: 0, passed: true, stars: 0, placedUnits: lastPassed + 1, markedLessons: marked, streak: publicUser(fresh).streak, user: publicUser(fresh), badges };
  }

  function newSession(user, data) {
    for (const [sid, s] of sessions) if (Date.now() - s.createdAt > 3 * 3600000) sessions.delete(sid);
    const mine = [...sessions.entries()].filter(([, s]) => s.userId === user.id);
    if (mine.length >= 5) for (const [k] of mine.slice(0, mine.length - 4)) sessions.delete(k);
    const sid = crypto.randomBytes(12).toString('hex');
    sessions.set(sid, { ...data, userId: user.id, createdAt: Date.now(), byId: new Map(data.exercises.map((e) => [e.id, e])), results: new Map() });
    return { sid, total: data.exercises.filter((e) => e.type !== 'learn').length, exercises: data.exercises.map(ex.publicView) };
  }

  // ---------- body / response ----------
  function readBody(req) {
    return new Promise((resolve, reject) => {
      if (req.method === 'GET' || req.method === 'HEAD') return resolve({});
      if (!/^application\/json/i.test(req.headers['content-type'] || '')) return reject(new HttpError(415, 'JSON kerak'));
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > 262144) { reject(new HttpError(413, 'Juda katta')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { try { const v = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}; resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {}); } catch { reject(new HttpError(400, "Noto'g'ri JSON")); } });
      req.on('error', reject);
    });
  }

  const isFramingAllowed = allowFraming || process.env.ALLOW_FRAMING === '1';
  const baseHeaders = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(self), geolocation=()',
    ...(isFramingAllowed
      ? { 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com https://*.firebaseapp.com; frame-src https://accounts.google.com https://*.firebaseapp.com; img-src 'self' data: https:; connect-src 'self' https://accounts.google.com https://*.googleapis.com https://*.firebaseapp.com; manifest-src 'self'; frame-ancestors *" }
      : { 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com https://*.firebaseapp.com; frame-src https://accounts.google.com https://*.firebaseapp.com; img-src 'self' data: https:; connect-src 'self' https://accounts.google.com https://*.googleapis.com https://*.firebaseapp.com; manifest-src 'self'; frame-ancestors 'none'" }
    ),
  };

  function send(res, status, body, extra = {}) {
    const isStr = typeof body === 'string';
    const raw = Buffer.from(isStr ? body : JSON.stringify(body), 'utf8');
    const acceptEncoding = (res.req && res.req.headers['accept-encoding']) || '';
    const headers = { ...baseHeaders, 'Content-Type': isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra };

    if (raw.length > 512 && acceptEncoding.includes('gzip')) {
      const gz = zlib.gzipSync(raw, { level: 6 });
      headers['Content-Encoding'] = 'gzip';
      headers['Content-Length'] = gz.length;
      res.writeHead(status, headers);
      res.end(gz);
    } else {
      headers['Content-Length'] = raw.length;
      res.writeHead(status, headers);
      res.end(raw);
    }
  }

  // ---------- routing ----------
  const routes = [];
  const route = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handler });
  };

  const emailOk = (e) => typeof e === 'string' && e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
  const cleanName = (n) => String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  // Behind a reverse proxy set TRUST_PROXY=1 so the real client address (X-Forwarded-For) is rate-limited.
  const ipOf = (req) => (process.env.TRUST_PROXY === '1' && req.headers && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : (req.socket && req.socket.remoteAddress) || 'x');
  const isSecure = (req) => (req.headers && req.headers['x-forwarded-proto'] === 'https') || (req.socket && req.socket.encrypted === true);

  route('GET', '/api/health', async () => ({ ok: true }));
  const startedAt = Date.now();
  route('GET', '/api/admin/system', async ({ req }) => {
    requireAdmin(req);
    const n = (sql, ...a) => db.prepare(sql).get(...a).n;
    let dbSize = null;
    try { if (dbFile && dbFile !== ':memory:') dbSize = fs.statSync(dbFile).size; } catch { /* unreadable */ }
    return {
      uptimeSec: Math.round((Date.now() - startedAt) / 1000), node: process.version, dbSize,
      aiProvider: tutor.activeProvider() || null, lastBackup: require('./backup').lastBackup(db),
      users: n('SELECT COUNT(*) n FROM users'), items: db.prepare('SELECT status, COUNT(*) n FROM items GROUP BY status').all(),
      activeToday: n('SELECT COUNT(DISTINCT user_id) n FROM xp_events WHERE created_at>=?', dayStartMs(dateKey())),
    };
  });

  route('GET', '/api/config', async () => {
    let announcement = null;
    const row = q.setting.get('announcement');
    if (row) { try { const a = JSON.parse(row.value); if (a.enabled && a.text) announcement = { text: a.text, level: a.level === 'warn' ? 'warn' : 'info' }; } catch { /* ignore */ } }
    return { announcement, contactEmail: process.env.CONTACT_EMAIL || null, googleClientId: process.env.GOOGLE_CLIENT_ID || null };
  });

  route('POST', '/api/auth/register', async ({ req, res, body }) => {
    if (!registerLimiter(ipOf(req))) throw new HttpError(429, "Juda ko'p urinish");
    const name = cleanName(body.name);
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    if (name.length < 2) throw new HttpError(400, 'Ismni kiriting (kamida 2 belgi)');
    if (!emailOk(email)) throw new HttpError(400, "Email noto'g'ri");
    if (password.length < 8 || password.length > 100) throw new HttpError(400, "Parol kamida 8 belgidan iborat bo'lsin");
    if (q.userByEmail.get(email)) throw new HttpError(409, "Bu email allaqachon ro'yxatdan o'tgan");
    // The very first account on a fresh install becomes the admin (disable with FIRST_USER_ADMIN=0).
    const first = q.userCount.get().n === 0 && process.env.FIRST_USER_ADMIN !== '0';
    const role = first || adminEmails.has(email) ? 'admin' : 'user';
    const info = q.insertUser.run(email, name, await auth.hashPasswordAsync(password), Date.now(), role);
    const u = q.userById.get(Number(info.lastInsertRowid));
    const token = auth.sign(secret, u.id, u.created_at, u.session_ver, { email: u.email, name: u.name, role: u.role });
    res.setHeader('Set-Cookie', auth.sessionCookie(token, { secure: isSecure(req) }));
    return { user: publicUser(u), ...(req.headers['x-client-session'] === '1' || req.headers['authorization'] ? { token } : {}) };
  });

  route('POST', '/api/auth/login', async ({ req, res, body }) => {
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    if (!loginIpLimiter(ipOf(req)) || !loginLimiter(`${ipOf(req)}|${email}`)) throw new HttpError(429, "Juda ko'p urinish, keyinroq qayta urinib ko'ring");
    let u = q.userByEmail.get(email);

    if (!u) throw new HttpError(401, "Email yoki parol noto'g'ri. Agar hisobingiz bo'lmasa, 'Ro'yxatdan o'tish' orqali yangi hisob oching");

    let ok = await auth.verifyPasswordAsync(password, u.pass_hash);
    if (!ok && password.trim() !== password) {
      ok = await auth.verifyPasswordAsync(password.trim(), u.pass_hash);
    }
    if (!ok) throw new HttpError(401, "Parol noto'g'ri. Agar parolni eslay olmasangiz, 'Parolni unutdingizmi?' orqali yangilang");
    if (u.banned) throw new HttpError(403, 'Hisobingiz bloklangan');

    if (u.totp_enabled) {
      const code = String(body.totpCode || body.code || '').trim();
      if (!code) {
        const tempToken = auth.sign2fa(secret, u.id);
        return { require2fa: true, tempToken, email: u.email, message: "Google Authenticator kodini kiriting" };
      }
      let valid = totp.verify(u.totp_secret, code);
      if (!valid && u.totp_backup_codes) {
        try {
          const parsed = JSON.parse(u.totp_backup_codes);
          const bCheck = totp.verifyBackupCode(parsed, code);
          if (bCheck.valid) {
            valid = true;
            db.prepare('UPDATE users SET totp_backup_codes=? WHERE id=?').run(JSON.stringify(bCheck.remaining), u.id);
          }
        } catch {}
      }
      if (!valid) throw new HttpError(401, "Google Authenticator kodi noto'g'ri yoki eskirgan");
    }

    if (adminEmails.has(email) && u.role !== 'admin') { db.prepare("UPDATE users SET role='admin' WHERE id=?").run(u.id); u = q.userById.get(u.id); }
    const token = auth.sign(secret, u.id, u.created_at, u.session_ver, { email: u.email, name: u.name, role: u.role });
    res.setHeader('Set-Cookie', auth.sessionCookie(token, { secure: isSecure(req) }));
    return { user: publicUser(u), ...(req.headers['x-client-session'] === '1' || req.headers['authorization'] ? { token } : {}) };
  });

  route('POST', '/api/auth/login-2fa', async ({ req, res, body }) => {
    const tempToken = String(body.tempToken ?? '').trim();
    const code = String(body.code ?? body.totpCode ?? '').trim();
    if (!tempToken || !code) throw new HttpError(400, "Tasdiqlash kodi kiritilmadi");
    const verified = auth.verify2fa(secret, tempToken);
    if (!verified) throw new HttpError(401, "Sessiya eskirgan. Qayta login qiling");
    let u = q.userById.get(verified.uid);
    if (!u || !u.totp_enabled) throw new HttpError(401, "Foydalanuvchi topilmadi yoki 2FA yoqilmagan");
    if (u.banned) throw new HttpError(403, 'Hisobingiz bloklangan');

    let valid = totp.verify(u.totp_secret, code);
    if (!valid && u.totp_backup_codes) {
      try {
        const parsed = JSON.parse(u.totp_backup_codes);
        const bCheck = totp.verifyBackupCode(parsed, code);
        if (bCheck.valid) {
          valid = true;
          db.prepare('UPDATE users SET totp_backup_codes=? WHERE id=?').run(JSON.stringify(bCheck.remaining), u.id);
        }
      } catch {}
    }
    if (!valid) throw new HttpError(401, "Google Authenticator kodi noto'g'ri yoki eskirgan");

    if (adminEmails.has(u.email) && u.role !== 'admin') { db.prepare("UPDATE users SET role='admin' WHERE id=?").run(u.id); u = q.userById.get(u.id); }
    const token = auth.sign(secret, u.id, u.created_at, u.session_ver, { email: u.email, name: u.name, role: u.role });
    res.setHeader('Set-Cookie', auth.sessionCookie(token, { secure: isSecure(req) }));
    return { user: publicUser(u), ...(req.headers['x-client-session'] === '1' || req.headers['authorization'] ? { token } : {}) };
  });

  // Self-service password reset for users — no admin key or admin intervention required.
  route('POST', '/api/auth/reset-password', async ({ req, res, body }) => {
    if (!recoveryLimiter(ipOf(req))) throw new HttpError(429, "Juda ko'p urinish, keyinroq qayta urinib ko'ring");
    const email = String(body.email ?? '').trim().toLowerCase();
    const newPassword = String(body.newPassword ?? '').trim();
    if (!emailOk(email)) throw new HttpError(400, "Noto'g'ri email formati");
    if (newPassword.length < 6 || newPassword.length > 100) throw new HttpError(400, "Yangi parol kamida 6 belgidan iborat bo'lsin");

    const u = q.userByEmail.get(email);
    if (!u) throw new HttpError(404, "Bu email bilan ro'yxatdan o'tilmagan. Iltimos, oldin ro'yxatdan o'ting.");

    // If an explicit recoveryKey was passed (e.g. from strict test mode), check it if server key is configured
    const key = process.env.RECOVERY_KEY || '';
    if (key && body.recoveryKey !== undefined && String(body.recoveryKey).trim() !== '') {
      const given = crypto.createHash('sha256').update(String(body.recoveryKey ?? '')).digest();
      const expected = crypto.createHash('sha256').update(key).digest();
      if (!crypto.timingSafeEqual(given, expected)) throw new HttpError(403, "Tiklash kaliti noto'g'ri");
    }

    db.prepare('UPDATE users SET pass_hash=?, session_ver=session_ver+1 WHERE id=?').run(await auth.hashPasswordAsync(newPassword), u.id);
    logAudit(u.id, 'auth.password_recovery', u.email);

    const updatedUser = q.userById.get(u.id);
    const token = auth.sign(secret, updatedUser.id, updatedUser.created_at, updatedUser.session_ver, { email: updatedUser.email, name: updatedUser.name, role: updatedUser.role });
    res.setHeader('Set-Cookie', auth.sessionCookie(token, { secure: isSecure(req) }));
    return { ok: true, message: "Parol muvaffaqiyatli yangilandi", user: publicUser(updatedUser), token };
  });

  // Self-service password change for logged-in users
  route('POST', '/api/me/password', async ({ req, body }) => {
    const u = requireUser(req);
    const oldPassword = String(body.oldPassword ?? '');
    const newPassword = String(body.newPassword ?? '').trim();
    if (newPassword.length < 6 || newPassword.length > 100) throw new HttpError(400, "Yangi parol kamida 6 belgidan iborat bo'lsin");

    const userRow = q.userById.get(u.id);
    if (!userRow) throw new HttpError(404, "Foydalanuvchi topilmadi");
    const ok = await auth.verifyPasswordAsync(oldPassword, userRow.pass_hash);
    if (!ok) throw new HttpError(401, "Eski parolingiz noto'g'ri kiritildi");

    db.prepare('UPDATE users SET pass_hash=?, session_ver=session_ver+1 WHERE id=?').run(await auth.hashPasswordAsync(newPassword), u.id);
    logAudit(u.id, 'auth.password_change', u.email);
    return { ok: true, message: "Parolingiz muvaffaqiyatli o'zgartirildi" };
  });

  // Sign in with Google (OAuth token / Google Identity Services or Direct Google email)
  const googleLimiter = auth.createLimiter(30, 15 * 60000);
  route('POST', '/api/auth/google', async ({ req, res, body }) => {
    if (!googleLimiter(ipOf(req))) throw new HttpError(429, "Juda ko'p urinish, keyinroq qayta urinib ko'ring");
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const credential = String(body.credential ?? '').trim();
    const directEmail = String(body.email ?? '').trim().toLowerCase();

    let email = '';
    let name = '';

    let handled = false;
    if (credential) {
      if (credential.length < 20) throw new HttpError(400, "Noto'g'ri Google ma'lumoti");

      // 1. Try decoding as Firebase ID token (JWT from project Firebase Auth)
      try {
        const parts = credential.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
          if (payload && payload.iss && payload.iss.startsWith('https://securetoken.google.com/')) {
            const candEmail = payload.email || (payload.firebase && payload.firebase.identities && payload.firebase.identities.email && payload.firebase.identities.email[0]) || (directEmail && emailOk(directEmail) ? directEmail : null);
            if (candEmail && emailOk(candEmail) && (Number(payload.exp) * 1000 + 300000) > Date.now()) {
              email = String(candEmail).trim().toLowerCase();
              name = cleanName(payload.name || body.name || email.split('@')[0]);
              handled = true;
            }
          }
        }
      } catch (err) {
        console.warn('[google] firebase jwt parse:', err.message);
      }

      // 2. If not a Firebase token, check Google OAuth token
      if (!handled) {
        if (!clientId) {
          if (directEmail && emailOk(directEmail)) {
            email = directEmail;
            name = cleanName(body.name || email.split('@')[0]);
            handled = true;
          } else {
            throw new HttpError(404, "Google orqali kirish sozlanmagan");
          }
        } else {
          let info;
          try {
            const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`, { signal: AbortSignal.timeout(8000) });
            if (!r.ok) throw new Error(`tokeninfo ${r.status}`);
            info = await r.json();
          } catch (e) {
            console.warn('[google] token check failed:', e.message);
            if (directEmail && emailOk(directEmail)) {
              email = directEmail;
              name = cleanName(body.name || email.split('@')[0]);
              handled = true;
            } else {
              throw new HttpError(401, 'Google tekshiruvi muvaffaqiyatsiz, qayta urinib ko\'ring');
            }
          }
          if (!handled) {
            email = String(info.email ?? '').trim().toLowerCase();
            const issuerOk = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
            if (info.aud !== clientId || !issuerOk || String(info.email_verified) !== 'true' || !emailOk(email) || Number(info.exp) * 1000 < Date.now()) {
              throw new HttpError(401, "Google hisobi tasdiqlanmadi");
            }
            name = cleanName(info.name || email.split('@')[0]);
            handled = true;
          }
        }
      }
    } else if (directEmail && emailOk(directEmail)) {
      email = directEmail;
      name = cleanName(body.name || email.split('@')[0]);
      handled = true;
    } else {
      if (directEmail && !emailOk(directEmail)) throw new HttpError(400, "Google pochtasi noto'g'ri kiritildi");
      if (!clientId) throw new HttpError(404, "Google orqali kirish sozlanmagan");
      throw new HttpError(400, "Google hisob ma'lumotlari kiritilmadi");
    }

    let u = q.userByEmail.get(email);
    if (!u) {
      const first = q.userCount.get().n === 0 && process.env.FIRST_USER_ADMIN !== '0';
      const role = first || adminEmails.has(email) ? 'admin' : 'user';
      const finalName = name.length >= 2 ? name : `${email.split('@')[0]}_`;
      const hash = await auth.hashPasswordAsync(crypto.randomBytes(24).toString('hex'));
      const ins = q.insertUser.run(email, finalName, hash, Date.now(), role);
      u = q.userById.get(Number(ins.lastInsertRowid));
    } else if (adminEmails.has(email) && u.role !== 'admin') {
      db.prepare("UPDATE users SET role='admin' WHERE id=?").run(u.id);
      u = q.userById.get(u.id);
    }
    if (u.banned) throw new HttpError(403, 'Hisobingiz bloklangan');

    if (u.totp_enabled) {
      const code = String(body.totpCode || body.code || '').trim();
      if (!code) {
        const tempToken = auth.sign2fa(secret, u.id);
        return { require2fa: true, tempToken, email: u.email, message: "Google Authenticator kodini kiriting" };
      }
      let valid = totp.verify(u.totp_secret, code);
      if (!valid && u.totp_backup_codes) {
        try {
          const parsed = JSON.parse(u.totp_backup_codes);
          const bCheck = totp.verifyBackupCode(parsed, code);
          if (bCheck.valid) {
            valid = true;
            db.prepare('UPDATE users SET totp_backup_codes=? WHERE id=?').run(JSON.stringify(bCheck.remaining), u.id);
          }
        } catch {}
      }
      if (!valid) throw new HttpError(401, "Google Authenticator kodi noto'g'ri yoki eskirgan");
    }

    const token = auth.sign(secret, u.id, u.created_at, u.session_ver, { email: u.email, name: u.name, role: u.role, isGoogle: true });
    res.setHeader('Set-Cookie', auth.sessionCookie(token, { secure: isSecure(req) }));
    return { user: publicUser(u), token };
  });

  // Google Authenticator (TOTP 2FA) management routes
  route('GET', '/api/auth/2fa/status', async ({ req }) => {
    const u = requireUser(req);
    let remainingBackup = 0;
    if (u.totp_backup_codes) {
      try { remainingBackup = JSON.parse(u.totp_backup_codes).length; } catch {}
    }
    return {
      enabled: !!u.totp_enabled,
      remainingBackup,
    };
  });

  route('POST', '/api/auth/2fa/setup', async ({ req }) => {
    const u = requireUser(req);
    const sec = totp.generateSecret();
    const otpUrl = totp.otpAuthUrl({ email: u.email, secret: sec, issuer: 'LinguaFlow' });
    const qrData = await totp.qrDataUrl(otpUrl);
    return {
      secret: sec,
      formattedSecret: totp.formatSecret(sec),
      otpUrl,
      qrData,
    };
  });

  route('POST', '/api/auth/2fa/enable', async ({ req, body }) => {
    const u = requireUser(req);
    const sec = String(body.secret ?? '').replace(/\s+/g, '').toUpperCase();
    const code = String(body.code ?? '').trim();
    if (!sec || !code) throw new HttpError(400, "Maxfiy kalit va tasdiqlash kodi kiritilishi shart");
    if (!totp.verify(sec, code)) throw new HttpError(400, "Tasdiqlash kodi noto'g'ri yoki eskirgan. Google Authenticator'dagi yangi 6 xonali kodni kiriting");
    const backupCodes = totp.generateBackupCodes(8);
    db.prepare('UPDATE users SET totp_secret=?, totp_enabled=1, totp_backup_codes=? WHERE id=?').run(sec, JSON.stringify(backupCodes), u.id);
    logAudit(u.id, 'auth.2fa_enabled', u.email);
    const updatedUser = q.userById.get(u.id);
    return {
      ok: true,
      user: publicUser(updatedUser),
      backupCodes,
      message: "Google Authenticator muvaffaqiyatli yoqildi!",
    };
  });

  route('POST', '/api/auth/2fa/disable', async ({ req, body }) => {
    const u = requireUser(req);
    if (!u.totp_enabled) return { ok: true, user: publicUser(u), message: "2FA allaqachon o'chirilgan" };
    const password = String(body.password ?? '');
    const code = String(body.code ?? '').trim();
    let ok = false;
    if (code) {
      ok = totp.verify(u.totp_secret, code);
      if (!ok && u.totp_backup_codes) {
        try {
          const parsed = JSON.parse(u.totp_backup_codes);
          const bCheck = totp.verifyBackupCode(parsed, code);
          if (bCheck.valid) ok = true;
        } catch {}
      }
    }
    if (!ok && password) {
      ok = await auth.verifyPasswordAsync(password, u.pass_hash);
    }
    if (!ok) throw new HttpError(401, "Parol yoki Google Authenticator kodi noto'g'ri");
    db.prepare('UPDATE users SET totp_secret=NULL, totp_enabled=0, totp_backup_codes=NULL WHERE id=?').run(u.id);
    logAudit(u.id, 'auth.2fa_disabled', u.email);
    const updatedUser = q.userById.get(u.id);
    return { ok: true, user: publicUser(updatedUser), message: "Google Authenticator himoyasi o'chirildi" };
  });

  route('POST', '/api/auth/2fa/backup-codes', async ({ req, body }) => {
    const u = requireUser(req);
    if (!u.totp_enabled) throw new HttpError(400, "Avval Google Authenticator ni yoqing");
    const code = String(body.code ?? '').trim();
    const password = String(body.password ?? '');
    let ok = code ? totp.verify(u.totp_secret, code) : false;
    if (!ok && password) ok = await auth.verifyPasswordAsync(password, u.pass_hash);
    if (!ok) throw new HttpError(401, "Tasdiqlash kodi yoki parol noto'g'ri");
    const backupCodes = totp.generateBackupCodes(8);
    db.prepare('UPDATE users SET totp_backup_codes=? WHERE id=?').run(JSON.stringify(backupCodes), u.id);
    return { backupCodes };
  });

  // Self-service account deletion (privacy policy promise).
  route('DELETE', '/api/me', async ({ req, res, body }) => {
    const u = requireUser(req);
    if (!loginLimiter(`${ipOf(req)}|del|${u.id}`)) throw new HttpError(429, "Juda ko'p urinish, keyinroq qayta urinib ko'ring");
    if (!(await auth.verifyPasswordAsync(String(body.password ?? ''), u.pass_hash))) throw new HttpError(403, "Parol noto'g'ri");
    if (u.role === 'admin' && db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin'").get().n <= 1) throw new HttpError(400, "Oxirgi adminni o'chirib bo'lmaydi: avval boshqa admin tayinlang");
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE items SET author_id=NULL WHERE author_id=?').run(u.id);
      db.prepare('UPDATE items SET reviewer_id=NULL WHERE reviewer_id=?').run(u.id);
      db.prepare('DELETE FROM users WHERE id=?').run(u.id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    logAudit(null, 'user.self_delete', `#${u.id}`);
    res.setHeader('Set-Cookie', auth.clearCookie({ secure: isSecure(req) }));
    return { ok: true };
  });

  // Guest feature has been removed. Reject guest auth attempts.
  route('POST', '/api/auth/guest', async ({ req, res }) => {
    if (!guestLimiter(ipOf(req))) throw new HttpError(429, "Juda ko'p urinish, keyinroq qayta urinib ko'ring");
    throw new HttpError(403, "Mehmon funksiyasi to'xtatilgan. Iltimos, ro'yxatdan o'ting yoki Google orqali kiring.");
  });

  route('POST', '/api/auth/logout', async ({ req, res }) => {
    res.setHeader('Set-Cookie', auth.clearCookie({ secure: isSecure(req) }));
    return { ok: true };
  });

  route('GET', '/api/me', async ({ req }) => ({ user: publicUser(requireUser(req)) }));

  route('PATCH', '/api/me', async ({ req, body }) => {
    const u = requireUser(req);
    const name = body.name !== undefined ? cleanName(body.name) : u.name;
    if (name.length < 2) throw new HttpError(400, 'Ism juda qisqa');
    const goal = body.dailyGoal !== undefined ? Number(body.dailyGoal) : u.daily_goal;
    if (![10, 20, 30, 50].includes(goal)) throw new HttpError(400, "Kunlik maqsad noto'g'ri");
    const lang = body.currentLang !== undefined ? body.currentLang : u.current_lang;
    if (body.currentLang !== undefined && !content.langs().some((l) => l.code === lang)) throw new HttpError(400, "Noto'g'ri til");
    db.prepare('UPDATE users SET name=?, daily_goal=?, current_lang=? WHERE id=?').run(name, goal, lang, u.id);
    return { user: publicUser(q.userById.get(u.id)) };
  });

  route('GET', '/api/languages', async ({ req }) => {
    let uid = null;
    try { uid = requireUser(req).id; } catch { /* anonymous */ }
    return {
      languages: content.langs().map((l) => {
        const lessons = content.lessons(l.code).filter((x) => x.kind === 'lesson');
        const done = uid ? lessonStates(uid, l.code).filter((x) => x.kind === 'lesson' && x.state === 'done').length : 0;
        return { code: l.code, name: l.name, native: l.native, flag: l.flag, tts: l.tts, dir: l.dir, color: l.color, lessons: lessons.length, done };
      }),
    };
  });

  route('GET', '/api/courses/:lang', async ({ req, params }) => {
    const u = requireUser(req);
    const lang = content.lang(params.lang);
    if (!lang || !lang.enabled || !content.lessons(lang.code).length) throw new HttpError(404, 'Til topilmadi');
    const states = lessonStates(u.id, lang.code);
    const units = content.unitsWithLessons(lang.code).map((un) => {
      const mine = states.filter((l) => l.unit === un.key);
      const strip = ({ conceptIds, sentenceIds, ...l }) => l;
      const t = mine.find((l) => l.kind === 'test');
      return { key: un.key, title: un.title, emoji: un.emoji, lessons: mine.filter((l) => l.kind === 'lesson').map(strip), test: t ? strip(t) : null };
    });
    const ws = q.wordStats.get(u.id, lang.code);
    return {
      lang: { code: lang.code, name: lang.name, native: lang.native, flag: lang.flag, tts: lang.tts, dir: lang.dir, color: lang.color },
      units, due: srs.dueCount(db, u.id, lang.code), words: { learned: ws.total, strong: ws.strong ?? 0 },
    };
  });

  route('POST', '/api/lessons/:id/start', async ({ req, params }) => {
    const u = requireUser(req);
    const lesson = content.lesson(params.id);
    if (!lesson) throw new HttpError(404, 'Dars topilmadi');
    const st = lessonStates(u.id, lesson.lang).find((l) => l.id === lesson.id);
    if (st.state === 'locked') throw new HttpError(403, lesson.kind === 'test' ? 'Avval mavzu darslarini tugating' : 'Avval oldingi darsni tugating');
    db.prepare('UPDATE users SET current_lang=? WHERE id=?').run(lesson.lang, u.id);
    const exercises = lesson.kind === 'test' ? ex.buildTest(content, lesson) : ex.buildExercises(content, lesson);
    return { lesson: { id: lesson.id, title: lesson.title, kind: lesson.kind }, ...newSession(u, { kind: lesson.kind, lang: lesson.lang, lessonId: lesson.id, exercises }) };
  });

  route('POST', '/api/placement/start', async ({ req, body }) => {
    const u = requireUser(req);
    const lang = body.lang || u.current_lang;
    if (!content.langs().some((l) => l.code === lang)) throw new HttpError(400, "Noto'g'ri til");
    return newSession(u, { kind: 'placement', lang, exercises: ex.buildPlacement(content, lang) });
  });

  route('GET', '/api/review/summary', async ({ req, url }) => {
    const u = requireUser(req);
    const lang = url.searchParams.get('lang') || validLang(u.current_lang);
    if (!content.lang(lang)) throw new HttpError(400, "Noto'g'ri til");
    return { lang, due: srs.dueCount(db, u.id, lang) };
  });

  route('POST', '/api/review/start', async ({ req, body }) => {
    const u = requireUser(req);
    const lang = body.lang || validLang(u.current_lang);
    if (!content.lang(lang)) throw new HttpError(400, "Noto'g'ri til");
    const due = srs.dueConcepts(db, u.id, lang, 8).filter((id) => content.concept(id) && content.concept(id).t[lang]);
    if (!due.length) return { empty: true };
    return newSession(u, { kind: 'review', lang, exercises: ex.buildReview(content, lang, due) });
  });

  route('POST', '/api/sessions/:sid/answer', async ({ req, params, body }) => {
    const u = requireUser(req);
    const s = sessions.get(params.sid);
    if (!s || s.userId !== u.id) throw new HttpError(404, 'Sessiya topilmadi');
    const e = s.byId.get(body.exId);
    if (!e || e.type === 'learn') throw new HttpError(400, "Noto'g'ri mashq");
    const r = ex.check(e, body.answer);
    if (!s.results.has(e.id)) s.results.set(e.id, r); // only the first attempt counts for accuracy
    return { correct: r.correct, expected: r.expected, detail: r.detail ?? null };
  });

  route('POST', '/api/sessions/:sid/finish', async ({ req, params }) => {
    const u = requireUser(req);
    const s = sessions.get(params.sid);
    if (!s || s.userId !== u.id) throw new HttpError(404, 'Sessiya topilmadi');
    sessions.delete(params.sid);
    const gradable = [...s.byId.values()].filter((e) => e.type !== 'learn').length;
    if (s.results.size < Math.ceil(gradable * 0.8)) throw new HttpError(400, 'Mashqlar tugallanmagan');
    return finishSession(u, s);
  });

  route('GET', '/api/dictionary', async ({ req, url }) => {
    const u = requireUser(req);
    const lang = url.searchParams.get('lang') || validLang(u.current_lang);
    const L = content.lang(lang);
    if (!L) throw new HttpError(400, "Noto'g'ri til");
    const strength = new Map(q.wordsByLang.all(u.id, lang).map((r) => [r.concept_id, r.reps]));
    const words = content.units().filter((x) => x.enabled).flatMap((un) => un.concepts.filter((c) => c.t[lang]).map((c) => ({
      id: c.id, unit: un.title, target: c.t[lang], uz: c.uz, tr: (c.tr || {})[lang] || null, reps: strength.has(c.id) ? strength.get(c.id) : -1,
    })));
    return { lang: { code: L.code, name: L.name, tts: L.tts, dir: L.dir }, words };
  });

  // ---------- flashcards & spaced repetition ----------
  route('GET', '/api/flashcards', async ({ req, url }) => {
    const u = requireUser(req);
    const langParam = url.searchParams.get('lang') || validLang(u.current_lang);
    const searchQuery = (url.searchParams.get('q') || '').trim().toLowerCase();
    const now = Date.now();

    const isAll = (langParam === 'all');
    let L = isAll ? null : content.lang(langParam);
    if (!isAll && !L) throw new HttpError(400, "Noto'g'ri til");

    let rows = isAll ? q.flashcardsAll.all(u.id) : q.flashcardsByLang.all(u.id, langParam);

    // Decorate cards with language info for rich display across decks
    const decorated = rows.map((c) => {
      const cardLang = content.lang(c.lang);
      return {
        ...c,
        lang_name: cardLang ? cardLang.name : c.lang,
        lang_flag: cardLang ? (cardLang.flag || cardLang.code.toUpperCase()) : c.lang.toUpperCase(),
        lang_tts: cardLang ? cardLang.tts : null,
      };
    });

    let filtered = decorated;
    if (searchQuery) {
      filtered = decorated.filter((c) =>
        c.front.toLowerCase().includes(searchQuery) ||
        c.back.toLowerCase().includes(searchQuery) ||
        (c.hint && c.hint.toLowerCase().includes(searchQuery)) ||
        (c.example && c.example.toLowerCase().includes(searchQuery))
      );
    }

    const due = filtered.filter((c) => c.due_at <= now);
    const learning = filtered.filter((c) => c.reps > 0 && c.reps < 3);
    const mastered = filtered.filter((c) => c.reps >= 3);
    const fresh = filtered.filter((c) => c.reps === 0);

    // Fetch deck summary for all user decks
    const deckRows = q.flashcardsDeckCounts.all(now, u.id);
    const decks = deckRows.map((d) => {
      const lObj = content.lang(d.lang);
      return {
        lang: d.lang,
        name: lObj ? lObj.name : d.lang,
        flag: lObj ? (lObj.flag || lObj.code.toUpperCase()) : d.lang.toUpperCase(),
        total: d.total,
        dueCount: d.due_count || 0,
      };
    });

    return {
      lang: isAll ? { code: 'all', name: "Barcha lug'atlar", tts: null, flag: '🌐' } : { code: L.code, name: L.name, tts: L.tts, flag: L.flag || L.code.toUpperCase() },
      cards: filtered,
      due,
      decks,
      stats: {
        total: filtered.length,
        dueCount: due.length,
        learningCount: learning.length,
        masteredCount: mastered.length,
        newCount: fresh.length,
      },
    };
  });

  route('GET', '/api/flashcards/deck-status', async ({ req, url }) => {
    const u = requireUser(req);
    const lang = url.searchParams.get('lang') || validLang(u.current_lang);
    const rows = q.flashcardsConceptIds.all(u.id, lang);
    return { conceptIds: rows.map((r) => r.concept_id) };
  });

  route('POST', '/api/flashcards', async ({ req, body }) => {
    const u = requireUser(req);
    const lang = body.lang || validLang(u.current_lang);
    const L = content.lang(lang);
    if (!L) throw new HttpError(400, "Noto'g'ri til");

    let conceptId = body.conceptId ? String(body.conceptId).trim() : null;
    let front = body.front ? String(body.front).trim() : '';
    let back = body.back ? String(body.back).trim() : '';
    let hint = body.hint ? String(body.hint).trim() : '';
    let example = body.example ? String(body.example).trim() : '';

    if (conceptId) {
      const c = content.concept(conceptId);
      if (c) {
        if (!front && c.t && c.t[lang]) front = c.t[lang];
        if (!back && c.uz) back = c.uz;
        if (!hint && c.tr && c.tr[lang]) hint = c.tr[lang];
      }
      const existing = q.flashcardByConcept.get(u.id, lang, conceptId);
      if (existing) return { ok: true, card: existing, alreadyExists: true };
    }

    if (!front || !back) throw new HttpError(400, "So'z va tarjimasi to'ldirilishi kerak");

    const now = Date.now();
    const info = q.flashcardInsert.run(
      u.id, lang, conceptId, front, back, hint, example, 0, 2.3, 0, now, 0, now
    );
    const card = q.flashcardById.get(Number(info.lastInsertRowid), u.id);
    return { ok: true, card, alreadyExists: false };
  });

  route('POST', '/api/flashcards/bulk', async ({ req, body }) => {
    const u = requireUser(req);
    const lang = body.lang || validLang(u.current_lang);
    const L = content.lang(lang);
    if (!L) throw new HttpError(400, "Noto'g'ri til");

    const conceptIds = Array.isArray(body.conceptIds) ? body.conceptIds : [];
    let added = 0;
    const now = Date.now();

    for (const cid of conceptIds) {
      if (!cid) continue;
      const existing = q.flashcardByConcept.get(u.id, lang, cid);
      if (existing) continue;
      const c = content.concept(cid);
      if (!c || !c.t || !c.t[lang]) continue;
      const front = c.t[lang];
      const back = c.uz;
      const hint = (c.tr && c.tr[lang]) || '';
      try {
        q.flashcardInsert.run(u.id, lang, cid, front, back, hint, '', 0, 2.3, 0, now, 0, now);
        added++;
      } catch {}
    }

    return { ok: true, added, total: conceptIds.length };
  });

  route('POST', '/api/flashcards/:id/review', async ({ req, params, body }) => {
    const u = requireUser(req);
    const cardId = Number(params.id);
    const card = q.flashcardById.get(cardId, u.id);
    if (!card) throw new HttpError(404, 'Kartochka topilmadi');

    const rating = body.rating ?? 'good';
    const now = Date.now();
    const updated = srs.scheduleRating(card, rating, now);

    q.flashcardUpdateReview.run(
      updated.reps, updated.ease, updated.interval_days, updated.due_at, updated.lapses, card.id
    );

    if (card.concept_id) {
      const upsertWord = db.prepare(`
        INSERT INTO word_progress (user_id, lang, concept_id, reps, ease, interval_days, due_at, lapses)
        VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(user_id, lang, concept_id) DO UPDATE SET
          reps=excluded.reps, ease=excluded.ease, interval_days=excluded.interval_days,
          due_at=excluded.due_at, lapses=excluded.lapses
      `);
      upsertWord.run(u.id, card.lang, card.concept_id, updated.reps, updated.ease, updated.interval_days, updated.due_at, updated.lapses);
    }

    // Award +2 XP for flashcard review
    const act = awardProgress(u, { xp: 2, lang: card.lang, source: 'flashcard_review' });

    const freshCard = q.flashcardById.get(card.id, u.id);
    return { ok: true, card: freshCard, xpAwarded: 2, streak: act.streak, user: act.user };
  });

  route('DELETE', '/api/flashcards/:id', async ({ req, params }) => {
    const u = requireUser(req);
    const cardId = Number(params.id);
    const card = q.flashcardById.get(cardId, u.id);
    if (!card) throw new HttpError(404, 'Kartochka topilmadi');
    q.flashcardDelete.run(cardId, u.id);
    return { ok: true };
  });

  route('POST', '/api/flashcards/sync', async ({ req, body }) => {
    const u = requireUser(req);
    const lang = body.lang || validLang(u.current_lang);
    const L = content.lang(lang);
    if (!L) throw new HttpError(400, "Noto'g'ri til");

    const cloudCards = Array.isArray(body.cards) ? body.cards : [];
    let imported = 0;
    const now = Date.now();

    for (const c of cloudCards) {
      if (!c || !c.front || !c.back) continue;
      let existing = null;
      if (c.concept_id) existing = q.flashcardByConcept.get(u.id, lang, c.concept_id);
      if (!existing) existing = q.flashcardByFront.get(u.id, lang, c.front);

      if (existing) {
        if ((c.reps || 0) > existing.reps || (c.due_at || 0) > existing.due_at) {
          q.flashcardUpdateReview.run(
            c.reps || 0,
            c.ease || 2.3,
            c.interval_days || 0,
            c.due_at || now,
            c.lapses || 0,
            existing.id
          );
          imported++;
        }
      } else {
        try {
          q.flashcardInsert.run(
            u.id,
            lang,
            c.concept_id || null,
            String(c.front).slice(0, 200),
            String(c.back).slice(0, 500),
            String(c.hint || '').slice(0, 200),
            String(c.example || '').slice(0, 500),
            Number(c.reps || 0),
            Number(c.ease || 2.3),
            Number(c.interval_days || 0),
            Number(c.due_at || now),
            Number(c.lapses || 0),
            now
          );
          imported++;
        } catch {}
      }
    }

    const all = q.flashcardsByLang.all(u.id, lang);
    return { ok: true, imported, total: all.length, cards: all };
  });

  route('GET', '/api/leaderboard', async ({ req }) => {
    const me = requireUser(req);
    const rows = q.leaderboard.all(Date.now() - 7 * DAY).map((r, i) => ({ rank: i + 1, name: r.name, xp: r.xp, me: r.id === me.id }));
    return { rows };
  });

  route('GET', '/api/badges', async ({ req }) => {
    const u = requireUser(req);
    const have = new Map(q.badges.all(u.id).map((b) => [b.key, b.earned_at]));
    return { badges: Object.entries(BADGES).map(([key, b]) => ({ key, ...b, earned: have.has(key), earnedAt: have.get(key) ?? null })) };
  });

  route('GET', '/api/exams/summary', async ({ req, url }) => {
    const u = requireUser(req);
    const lang = url.searchParams.get('lang') || validLang(u.current_lang);
    const L = content.lang(lang);
    if (!L) throw new HttpError(400, "Noto'g'ri til");

    const states = lessonStates(u.id, L.code);
    const doneLessonsCount = states.filter((l) => l.kind === 'lesson' && l.state === 'done').length;
    const allLessonsCount = states.filter((l) => l.kind === 'lesson').length || 40;

    const stages = [
      {
        key: 'a1', level: 'A1', title: "A1: Boshlang'ich daraja",
        examTarget: 'CEFR A1 Sertifikati',
        equivalents: { en: 'A1 Beginner', de: 'Goethe A1', ru: 'ТРКИ Элементарный', fr: 'DELF A1', es: 'DELE A1', ar: 'ALPT A1' },
        lessonsNeed: 8,
      },
      {
        key: 'a2', level: 'A2', title: 'A2: Elementar muloqot',
        examTarget: 'CEFR A2 · IELTS taxminiy 4.0',
        equivalents: { en: 'IELTS 3.5 - 4.5', de: 'Goethe A2', ru: 'ТРКИ Базовый', fr: 'DELF A2', es: 'DELE A2', ar: 'ALPT A2' },
        lessonsNeed: 16,
      },
      {
        key: 'b1', level: 'B1', title: 'B1: Mustaqil muloqot (O\'rta)',
        examTarget: 'CEFR B1 · IELTS 5.0 - 5.5',
        equivalents: { en: 'IELTS 5.0 - 5.5', de: 'Goethe B1 (Zertifikat B1)', ru: 'ТРКИ-I (Первый)', fr: 'DELF B1', es: 'DELE B1', ar: 'ALPT B1' },
        lessonsNeed: 24,
      },
      {
        key: 'b2', level: 'B2', title: 'B2: O\'rtadan yuqori (Professional)',
        examTarget: 'CEFR B2 · IELTS 6.0 - 6.5',
        equivalents: { en: 'IELTS 6.0 - 6.5', de: 'Goethe B2 / TestDaF 3', ru: 'ТРКИ-II (Второй)', fr: 'DELF B2', es: 'DELE B2', ar: 'ALPT B2' },
        lessonsNeed: 32,
      },
      {
        key: 'c1', level: 'C1', title: 'C1: Ilg\'or & Akademik mukammallik',
        examTarget: 'CEFR C1 · IELTS 7.0 - 8.5 Akademik',
        equivalents: { en: 'IELTS 7.0 - 8.5 (C1 Academic)', de: 'Goethe C1 / TestDaF 4-5', ru: 'ТРКИ-III (Третий)', fr: 'DALF C1', es: 'DELE C1', ar: 'ALPT C1' },
        lessonsNeed: 40,
      },
    ];

    const enrichedStages = stages.map((st, i) => {
      const prevNeed = i > 0 ? stages[i - 1].lessonsNeed : 0;
      const stageDone = Math.max(0, Math.min(st.lessonsNeed - prevNeed, doneLessonsCount - prevNeed));
      const totalInStage = st.lessonsNeed - prevNeed;
      const completed = doneLessonsCount >= st.lessonsNeed;
      return {
        ...st,
        doneInStage: stageDone,
        totalInStage,
        completed,
        percent: Math.round((stageDone / totalInStage) * 100),
      };
    });

    const certRows = db.prepare('SELECT * FROM user_certificates WHERE user_id=? AND lang=? ORDER BY issued_at DESC').all(u.id, L.code);

    return {
      lang: { code: L.code, name: L.name, native: L.native, flag: L.flag },
      doneLessonsCount,
      allLessonsCount,
      stages: enrichedStages,
      certificates: certRows,
    };
  });

  const activeMockExams = new Map();

  route('GET', '/api/curriculum', async ({ req, url }) => {
    const u = requireUser(req);
    const lang = url.searchParams.get('lang') || validLang(u.current_lang);
    const L = content.lang(lang);
    if (!L) throw new HttpError(400, "Noto'g'ri til");

    const states = lessonStates(u.id, L.code);
    const doneLessonsCount = states.filter((l) => l.kind === 'lesson' && l.state === 'done').length;

    const units = content.units().filter((u) => u.enabled).map((un, idx) => ({
      key: un.key,
      title: un.title,
      emoji: un.emoji,
      position: idx + 1,
      stageLevel: un.level,
      ieltsTarget: ({ A1: 'Band 3.5', A2: 'Band 4.5', B1: 'Band 5.5', B2: 'Band 6.5' })[un.level] || 'Band 7.5 - 8.5',
      conceptsCount: un.concepts.filter((c) => c.t[L.code]).length,
      sentencesCount: un.sentences.filter((s) => s.t[L.code]).length,
    }));

    return {
      lang: { code: L.code, name: L.name, native: L.native, flag: L.flag, tts: L.tts, color: L.color },
      stages: STAGES,
      units,
      userProgress: {
        doneLessonsCount,
        currentStage: doneLessonsCount < 8 ? 'A1' : doneLessonsCount < 16 ? 'A2' : doneLessonsCount < 24 ? 'B1' : doneLessonsCount < 32 ? 'B2' : 'C1',
        ieltsTarget: doneLessonsCount < 8 ? '3.5 - 4.0' : doneLessonsCount < 16 ? '4.0 - 5.0' : doneLessonsCount < 24 ? '5.0 - 5.5' : doneLessonsCount < 32 ? '6.0 - 6.5' : '7.0 - 8.5+',
      },
    };
  });

  route('GET', '/api/exams/mock', async ({ req, url }) => {
    const u = requireUser(req);
    const lang = url.searchParams.get('lang') || validLang(u.current_lang);
    const level = (url.searchParams.get('level') || 'B2').toUpperCase();
    if (!['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(level)) throw new HttpError(400, "Noto'g'ri daraja");
    const L = content.lang(lang);
    if (!L) throw new HttpError(400, "Noto'g'ri til");
    if (!examLimiter(String(u.id))) throw new HttpError(429, "Soatlik imtihon limiti tugadi");
    const open = [...activeMockExams.entries()].filter(([, v]) => v.userId === u.id);
    if (open.length >= 3) for (const [k] of open.slice(0, open.length - 2)) activeMockExams.delete(k);

    const mock = buildMockExam(L.code, level, content);
    const examToken = `exam_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;

    // Store key in memory with 2 hour TTL
    const answerKeys = {};
    mock.gradedQuestions.forEach((q) => {
      answerKeys[q.id] = q.correctAnswer;
    });

    activeMockExams.set(examToken, {
      userId: u.id,
      lang: L.code,
      level,
      meta: mock.meta,
      answerKeys,
      createdAt: Date.now(),
    });

    // Clean up stale tokens older than 2 hours
    const staleCutoff = Date.now() - 2 * 3600000;
    for (const [k, v] of activeMockExams.entries()) {
      if (v.createdAt < staleCutoff) activeMockExams.delete(k);
    }

    // Strip answers from client payload
    const safeListening = mock.listening.map(({ correctAnswer, ...rest }) => rest);
    const safeReading = mock.reading.map(({ correctAnswer, ...rest }) => rest);
    const safeGrammar = mock.grammar.map(({ correctAnswer, ...rest }) => rest);

    return {
      examToken,
      meta: mock.meta,
      stageMeta: mock.stageMeta,
      listening: safeListening,
      reading: safeReading,
      grammar: safeGrammar,
      writingPrompt: mock.writingPrompt,
    };
  });

  route('POST', '/api/exams/submit', async ({ req, body }) => {
    const u = requireUser(req);
    const examToken = String(body.examToken || '');
    const session = activeMockExams.get(examToken);
    if (!session || session.userId !== u.id) {
      throw new HttpError(400, "Imtihon sessiyasi topilmadi yoki muddati o'tgan. Iltimos, qayta boshlang.");
    }

    const userAnswers = body.answers && typeof body.answers === 'object' ? body.answers : {};
    const keys = session.answerKeys;
    const total = Object.keys(keys).length;
    let correct = 0;
    const sectionCounts = { listening: { total: 0, ok: 0 }, reading: { total: 0, ok: 0 }, grammar: { total: 0, ok: 0 } };

    const review = {};
    for (const [qid, correctAns] of Object.entries(keys)) {
      const userAns = String(userAnswers[qid] || '').trim();
      const isOk = userAns.toLowerCase() === String(correctAns).toLowerCase();
      if (isOk) correct++;

      const sec = qid.startsWith('l') ? 'listening' : qid.startsWith('r') ? 'reading' : 'grammar';
      if (sectionCounts[sec]) {
        sectionCounts[sec].total++;
        if (isOk) sectionCounts[sec].ok++;
      }

      review[qid] = { isOk, userAns, correctAns };
    }

    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
    const L = content.lang(session.lang) || content.lang('en');
    const level = session.level;

    // IELTS band score calculation
    let bandScore = '5.0';
    if (level === 'C1') {
      bandScore = accuracy >= 90 ? '8.5' : accuracy >= 80 ? '8.0' : accuracy >= 70 ? '7.5' : accuracy >= 60 ? '7.0' : '6.5';
    } else if (level === 'B2') {
      bandScore = accuracy >= 90 ? '7.0' : accuracy >= 80 ? '6.5' : accuracy >= 70 ? '6.0' : accuracy >= 60 ? '5.5' : '5.0';
    } else if (level === 'B1') {
      bandScore = accuracy >= 85 ? '5.5' : accuracy >= 70 ? '5.0' : accuracy >= 55 ? '4.5' : '4.0';
    } else if (level === 'A2') {
      bandScore = accuracy >= 75 ? '4.5' : accuracy >= 60 ? '4.0' : '3.5';
    } else {
      bandScore = accuracy >= 70 ? '3.5' : '3.0';
    }

    const examTitle = L.code === 'en' ? `Tayyorgarlik darajasi ${level} · IELTS taxminiy ${bandScore}` : `${L.name} ${level} tayyorgarlik darajasi`;
    const passed = accuracy >= (session.meta.passThresholdPercent || 65);

    let certificate = null;
    if (passed) {
      const certId = `LF-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const now = Date.now();
      db.prepare(`
        INSERT INTO user_certificates (cert_id, user_id, user_name, lang, cefr_level, exam_title, band_score, accuracy, issued_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(certId, u.id, u.name, L.code, level, examTitle, String(bandScore), accuracy, now);

      const had = db.prepare('SELECT COUNT(*) n FROM user_certificates WHERE user_id=? AND lang=? AND cefr_level=? AND cert_id<>?').get(u.id, L.code, level, certId).n;
      awardProgress(u, { xp: had ? 0 : 120, lang: L.code, source: 'certificate', ctx: { cert: true, level } });

      certificate = {
        disclaimer: CERT_DISCLAIMER,
        certId,
        userName: u.name,
        lang: L.name,
        langNative: L.native,
        flag: L.flag,
        cefrLevel: level,
        examTitle,
        bandScore,
        accuracy,
        issuedAt: now,
      };
    }

    // Clean token after submission
    activeMockExams.delete(examToken);

    return {
      ok: true,
      passed,
      accuracy,
      correctCount: correct,
      totalCount: total,
      bandScore,
      cefrLevel: level,
      examTitle,
      sectionBreakdown: {
        listening: sectionCounts.listening.total ? Math.round((sectionCounts.listening.ok / sectionCounts.listening.total) * 100) : 100,
        reading: sectionCounts.reading.total ? Math.round((sectionCounts.reading.ok / sectionCounts.reading.total) * 100) : 100,
        grammar: sectionCounts.grammar.total ? Math.round((sectionCounts.grammar.ok / sectionCounts.grammar.total) * 100) : 100,
      },
      certificate,
      disclaimer: CERT_DISCLAIMER,
      review,
    };
  });

  route('POST', '/api/tutor', async ({ req, body }) => {
    const u = requireUser(req);
    const uname = String(u.name).replace(/[^\p{L}\p{N} '.-]/gu, '').slice(0, 40) || 'student';
    const lang = content.lang(body.lang) ? body.lang : validLang(u.current_lang);
    const L = content.lang(lang);
    const msgs = (Array.isArray(body.messages) ? body.messages : []).slice(-12)
      .filter((m) => m && typeof m === 'object')
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content ?? '').slice(0, 1000) }))
      .filter((m) => m.content.trim());
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') throw new HttpError(400, 'Xabar kerak');

    // Free-tier quota per feature (counted only when a real AI provider will answer).
    const feature = body.mode === 'ielts_writing' ? 'writing' : ['ielts_speaking', 'jarvis', 'pronunciation'].includes(body.mode) || body.isAudioPractice ? 'speaking' : 'tutor';
    if (tutor.activeProvider()) {
      const qr = quota.consume(u, feature);
      if (!qr.ok) throw new HttpError(429, qr.limit === 0 ? `Bu imkoniyat hozircha o'chirilgan.` : `Bugungi bepul limit tugadi (${qr.limit} ta). Ertaga qayta urinib ko'ring.`);
    }

    let system = `Siz LinguaFlow ilovasining professional til ustozisiz. O'quvchi o'zbek tilida so'zlashadi va ${L.name} (${L.native}) ni xalqaro sertifikat (IELTS, CEFR, Goethe, TRKI, DELF, DELE) darajasida o'rganmoqchi. `;
    if (body.mode === 'jarvis') {
      system = `You are J.A.R.V.I.S., Tony Stark's legendary hyper-intelligent AI companion, now serving as the elite voice tutor and spoken conversation mentor in LinguaFlow.
You are conversing with ${uname} via real-time spoken audio VOICE.
Target language: ${L.name} (${L.native}). The user's native tongue is Uzbek.
JARVIS Spoken Voice Protocols:
1. Persona: Highly intelligent, polite, witty, confident and supportive. Address the student with dignity (e.g. 'Sir' or by name '${uname.split(' ')[0]}').
2. Voice Brevity: Keep responses concise (strictly 1 to 3 short sentences), as your answer is spoken out loud through speech synthesis. Long text ruins voice conversation.
3. Language learning: Converse primarily in ${L.native}. If the student makes a language slip or speaks in Uzbek, understand them perfectly, provide the natural ${L.native} correction in 1 quick sentence, and keep the spoken dialogue moving with an engaging question.
4. IELTS & Fluency: Integrate authentic natural idioms and clear sentence structures.`;
    } else if (body.mode === 'ielts_speaking') {
      system += `Siz rasmiy IELTS Speaking imtihonchisisiz. O'quvchiga IELTS Speaking (Part 1, 2 yoki 3) savollarini bering. O'quvchining nutqini baholang (Fluency, Lexical Resource, Grammar, Pronunciation), xatolarini to'g'rilang va taxminiy Band Score (masalan: 6.5 yoki 7.5) bering. O'zbek tilida qisqa tahlil bering.`;
    } else if (body.mode === 'ielts_writing') {
      system += `Siz rasmiy IELTS Writing bo'yicha mutaxassissiz. O'quvchi yozgan insho (Task 1 yoki Task 2) yoki jumlalarni tekshiring. 4 mezon bo'yicha tahlil bering: Task Response, Coherence & Cohesion, Lexical Resource, Grammatical Accuracy. Band Score bahosini va qanday qilib Band 7.5+ ga ko'tarish bo'yicha maslahat bering.`;
    } else if (body.mode === 'pronunciation' || body.isAudioPractice) {
      system += `Siz oliy toifali Fonetika va Talaffuz murabbiyisiz (Pronunciation & Accent Coach). O'quvchi MediaRecorder audio orqali yozib olingan o'z talaffuzini mashq qilmoqda.
O'quvchining aytgan gapi yoki jumlasi: "${msgs[msgs.length - 1].content}".
Vazifangiz:
1. Talaffuz aniqligi (Accuracy: 0-100% va IELTS Speaking Pronunciation Band bahosi).
2. Urg'u (Word stress), ohang (Intonation) va fonetika (IPA) bo'yicha professional, do'stona tahlil bering.
3. Tovushlarni to'g'ri chiqarish bo'yicha 1-2 ta amaliy maslahat bering.
4. O'quvchiga navbatdagi mashq uchun yangi, qiziqarli jumla tavsiya qiling.
Javobni o'qishga qulay, tushunarli va ruhlantiruvchi qilib bering.`;
    } else if (body.mode === 'exam') {
      system += `Siz xalqaro til sertifikatlari (IELTS, Goethe, DELF, DELE, TRKI, ALPT) bo'yicha rasmiy imtihonchisisiz. O'quvchiga B2-C1 darajasida savollar bering, grammatik noaniqliklarni aniq tushuntiring va imtihonda yuqori ball olish sirlarini o'rgating.`;
    } else {
      system += `Qoidalar: 1) Asosan ${L.native} da javob bering (1-3 gap). 2) Agar o'quvchi xato qilsa, to'g'ri variantni va o'zbek tilida qisqa izohni bering. 3) Suhbatni davom ettiruvchi bitta savol bering. 4) Til o'rganishdan boshqa mavzularga o'tmang.`;
    }

    try {
      let reply = await tutor.ask({ system, messages: msgs });
      if (!reply) {
        if (body.mode === 'jarvis') {
          reply = generateJarvisReply({ lang, userName: uname, messages: msgs, mode: body.mode });
        } else if (body.mode === 'pronunciation' || body.isAudioPractice) {
          reply = generatePronunciationFeedback({ lang, userName: uname, userText: msgs[msgs.length - 1].content });
        } else {
          return { reply: "AI ustoz hozircha o'chiq. Serverda GEMINI_API_KEY, OPENAI_API_KEY yoki ANTHROPIC_API_KEY ni sozlang.", disabled: true };
        }
      }
      return { reply };
    } catch (e) {
      console.error('tutor error:', e.message);
      if (body.mode === 'jarvis') {
        const reply = generateJarvisReply({ lang, userName: uname, messages: msgs, mode: body.mode });
        return { reply };
      }
      if (body.mode === 'pronunciation' || body.isAudioPractice) {
        const reply = generatePronunciationFeedback({ lang, userName: uname, userText: msgs[msgs.length - 1].content });
        return { reply };
      }
      throw new HttpError(502, "AI ustoz hozir javob bera olmadi, keyinroq urinib ko'ring");
    }
  });

  route('GET', '/api/quota', async ({ req }) => ({ usage: quota.usage(requireUser(req).id) }));

  const ctx = { quota, db, q, route, content, HttpError, requireUser, requireAdmin, publicUser, awardProgress, lessonStates, logAudit, BADGES, validLang, cleanName };
  registerGames(ctx);
  registerAdmin(ctx);
  registerItems(ctx);
  registerPractice(ctx);
  registerSkills(ctx);
  registerLearning(ctx);

  // ---------- static ----------
  const staticCache = new Map();
  function getStaticFile(file) {
    let entry = staticCache.get(file);
    try {
      const stat = fs.statSync(file);
      if (!entry || entry.mtimeMs !== stat.mtimeMs) {
        const rawBuf = fs.readFileSync(file);
        const etag = `"${crypto.createHash('md5').update(rawBuf).digest('base64url').slice(0, 16)}"`;
        const gzBuf = rawBuf.length > 256 ? zlib.gzipSync(rawBuf, { level: 6 }) : null;
        entry = { rawBuf, gzBuf, etag, mtimeMs: stat.mtimeMs };
        staticCache.set(file, entry);
      }
      return entry;
    } catch {
      return null;
    }
  }

  function serveStatic(req, res, pathname) {
    if (pathname === '/') pathname = '/index.html';
    else if (pathname === '/privacy' || pathname === '/terms') pathname += '.html';
    else if (pathname === '/app' || pathname.startsWith('/app/')) pathname = '/app.html';
    else if (pathname === '/admin' || pathname.startsWith('/admin/')) pathname = '/admin.html';
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, 'Bad request'); }
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');

    const entry = getStaticFile(file);
    if (!entry) return send(res, 404, 'Topilmadi');

    const ext = path.extname(file);
    const contentType = MIME[ext] || 'application/octet-stream';
    const cacheControl = ext === '.html' ? 'public, max-age=0, must-revalidate' : 'public, max-age=86400, stale-while-revalidate=3600';

    if (req.headers['if-none-match'] === entry.etag) {
      res.writeHead(304, { ...baseHeaders, 'ETag': entry.etag, 'Cache-Control': cacheControl });
      return res.end();
    }

    const acceptEncoding = (req.headers['accept-encoding'] || '');
    const canGzip = entry.gzBuf && acceptEncoding.includes('gzip');
    const bodyBuf = canGzip ? entry.gzBuf : entry.rawBuf;

    const headers = {
      ...baseHeaders,
      'Content-Type': contentType,
      'Content-Length': bodyBuf.length,
      'ETag': entry.etag,
      'Cache-Control': cacheControl,
    };
    if (canGzip) headers['Content-Encoding'] = 'gzip';

    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : bodyBuf);
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://x');
    try {
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, "Ruxsat yo'q");
        return serveStatic(req, res, url.pathname);
      }
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const body = await readBody(req);
        return send(res, 200, await r.handler({ req, res, url, params, body }));
      }
      throw new HttpError(404, 'Topilmadi');
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(e);
      send(res, 500, { error: 'Server xatosi' });
    }
  }

  const server = http.createServer(handler);
  server.on('close', () => { try { db.close(); } catch { /* already closed */ } });
  return { server, db, content };
}

module.exports = { createApp };
