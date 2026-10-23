'use strict';
const { dateKey, dayStartMs, DAY } = require('./db');

const SKILL_UZ = { reading: "O'qish", listening: 'Eshitish', grammar: 'Grammatika', vocab: "Lug'at" };
const REASONS = ['wrong_answer', 'unclear', 'typo', 'other'];
const PRACTICE_SKILLS = ['reading', 'listening', 'grammar', 'vocab'];
const REPORT_THRESHOLD = () => Math.max(2, Number(process.env.REPORT_THRESHOLD) || 3); // distinct users that pull an approved item back to review
const preview = (row) => { const p = JSON.parse(row.payload); return String(p.question || p.statement || p.text || '').slice(0, 90); };

// Every answered bank question is logged (skill statistics) and wrong ones go to the learner's mistake notebook;
// two correct answers in a row take a question out of the notebook again.
function recordAnswer(db, userId, lang, row, correct, now = Date.now()) {
  db.prepare('INSERT INTO practice_log (user_id,lang,skill,level,item_id,correct,created_at) VALUES (?,?,?,?,?,?,?)').run(userId, lang, row.skill, row.level, row.id, correct ? 1 : 0, now);
  if (!correct) {
    db.prepare('INSERT INTO mistakes (user_id,item_id,lang,wrong_count,streak_ok,last_wrong_at) VALUES (?,?,?,1,0,?) ON CONFLICT(user_id,item_id) DO UPDATE SET wrong_count=wrong_count+1, streak_ok=0, last_wrong_at=excluded.last_wrong_at').run(userId, row.id, lang, now);
  } else {
    db.prepare('UPDATE mistakes SET streak_ok=streak_ok+1 WHERE user_id=? AND item_id=?').run(userId, row.id);
    db.prepare('DELETE FROM mistakes WHERE user_id=? AND item_id=? AND streak_ok>=2').run(userId, row.id);
  }
}

module.exports = function registerLearning({ db, route, content, HttpError, requireUser, lessonStates, validLang, logAudit }) {
  const langOf = (u, raw) => { const L = content.lang(raw || validLang(u.current_lang)); if (!L) throw new HttpError(400, "Noto'g'ri til"); return L; };
  const limiter = new Map(); // user -> [timestamps] (reports per day)

  // ---- learners flag a wrong or unclear question ----
  route('POST', '/api/items/:id/report', async ({ req, params, body }) => {
    const u = requireUser(req);
    const item = db.prepare('SELECT id, status FROM items WHERE id=?').get(Number(params.id));
    if (!item || item.status !== 'approved') throw new HttpError(404, 'Savol topilmadi');
    const reason = String(body.reason || '');
    if (!REASONS.includes(reason)) throw new HttpError(400, "Sababni tanlang");
    const note = String(body.note || '').replace(/\s+/g, ' ').trim().slice(0, 300) || null;
    const recent = db.prepare('SELECT COUNT(*) n FROM item_reports WHERE user_id=? AND created_at>=?').get(u.id, Date.now() - DAY).n;
    if (recent >= 20) throw new HttpError(429, "Bugun juda ko'p xabar yubordingiz, ertaga davom eting");
    db.prepare("INSERT INTO item_reports (item_id,user_id,reason,note,status,created_at) VALUES (?,?,?,?, 'open', ?) ON CONFLICT(item_id,user_id) DO UPDATE SET reason=excluded.reason, note=COALESCE(excluded.note, note), status='open', created_at=excluded.created_at").run(item.id, u.id, reason, note, Date.now());
    const open = db.prepare("SELECT COUNT(*) n FROM item_reports WHERE item_id=? AND status='open'").get(item.id).n;
    let hidden = false;
    if (open >= REPORT_THRESHOLD()) {
      // enough independent reports: hide it from learners until a reviewer looks at it again
      db.prepare("UPDATE items SET status='review', reviewer_id=NULL, review_note=?, updated_at=? WHERE id=? AND status='approved'").run(`Avto: ${open} ta o'quvchi xato haqida xabar berdi`, Date.now(), item.id);
      logAudit(null, 'item.auto_review', `#${item.id}: ${open} ta xabar`);
      hidden = true;
    }
    return { ok: true, hidden };
  });

  // ---- mistake notebook ----
  route('GET', '/api/mistakes', async ({ req, url }) => {
    const u = requireUser(req);
    const L = langOf(u, url.searchParams.get('lang'));
    const rows = db.prepare("SELECT i.*, m.wrong_count, m.last_wrong_at FROM mistakes m JOIN items i ON i.id=m.item_id WHERE m.user_id=? AND m.lang=? AND i.status='approved' ORDER BY m.last_wrong_at DESC LIMIT 100").all(u.id, L.code);
    const words = db.prepare('SELECT concept_id, lapses FROM word_progress WHERE user_id=? AND lang=? AND lapses>=1 ORDER BY lapses DESC, concept_id LIMIT 50').all(u.id, L.code)
      .map((w) => { const c = content.concept(w.concept_id); return c && c.t[L.code] ? { id: c.id, target: c.t[L.code], uz: c.uz, lapses: w.lapses } : null; }).filter(Boolean);
    return { lang: L.code, count: rows.length, items: rows.map((r) => ({ id: r.id, skill: r.skill, level: r.level, wrongCount: r.wrong_count, lastWrongAt: r.last_wrong_at, preview: preview(r) })), words };
  });

  // ---- accuracy per skill, last 30 days ----
  function skillStats(userId, lang, now = Date.now()) {
    const rows = db.prepare('SELECT skill, COUNT(*) n, SUM(correct) c FROM practice_log WHERE user_id=? AND lang=? AND created_at>=? GROUP BY skill').all(userId, lang, now - 30 * DAY);
    return rows.map((r) => ({ skill: r.skill, answered: r.n, correct: r.c, accuracy: Math.round((r.c / r.n) * 100) }));
  }
  route('GET', '/api/stats/skills', async ({ req, url }) => {
    const u = requireUser(req);
    const L = langOf(u, url.searchParams.get('lang'));
    return { lang: L.code, days: 30, skills: skillStats(u.id, L.code) };
  });

  // ---- today's plan ----
  route('GET', '/api/plan/today', async ({ req, url }) => {
    const u = requireUser(req);
    const L = langOf(u, url.searchParams.get('lang'));
    const now = Date.now(), since = dayStartMs(dateKey(now));
    const doneToday = (...sources) => db.prepare(`SELECT COUNT(*) n FROM xp_events WHERE user_id=? AND created_at>=? AND source IN (${sources.map(() => '?').join(',')})`).get(u.id, since, ...sources).n > 0;
    const due = db.prepare('SELECT COUNT(*) n FROM word_progress WHERE user_id=? AND lang=? AND due_at<=?').get(u.id, L.code, now).n;
    const next = lessonStates(u.id, L.code).find((l) => l.state === 'available');
    const mistakes = db.prepare("SELECT COUNT(*) n FROM mistakes m JOIN items i ON i.id=m.item_id WHERE m.user_id=? AND m.lang=? AND i.status='approved'").get(u.id, L.code).n;
    const available = Object.fromEntries(db.prepare("SELECT skill, COUNT(*) n FROM items WHERE lang=? AND status='approved' AND type IN ('mcq','gap','tf_ng','short') GROUP BY skill").all(L.code).map((r) => [r.skill, r.n]));
    const stats = skillStats(u.id, L.code, now);
    // weakest skill (needs 5+ answers); otherwise the one practised least recently among those with questions
    const weak = stats.filter((s) => s.answered >= 5 && available[s.skill]).sort((a, b) => a.accuracy - b.accuracy)[0];
    const lastAt = Object.fromEntries(db.prepare('SELECT skill, MAX(created_at) t FROM practice_log WHERE user_id=? AND lang=? GROUP BY skill').all(u.id, L.code).map((r) => [r.skill, r.t]));
    const skill = weak ? weak.skill : PRACTICE_SKILLS.filter((k) => available[k]).sort((a, b) => (lastAt[a] || 0) - (lastAt[b] || 0))[0] || null;
    const steps = [];
    if (due) steps.push({ kind: 'review', title: `${due} ta so'zni takrorlash`, href: '#/review', done: doneToday('review') });
    if (mistakes) steps.push({ kind: 'mistakes', title: `Xatolar daftari: ${mistakes} ta savol`, href: '#/mistakes', done: false });
    if (next) steps.push({ kind: 'lesson', title: `Dars: ${next.title}`, href: '#/learn', done: doneToday('lesson', 'lesson:replay', 'test', 'test:replay') });
    if (skill) steps.push({ kind: 'practice', skill, title: weak ? `Zaif tomon: ${SKILL_UZ[skill]} (${weak.accuracy}%). Mashq qiling` : `Mashq: ${SKILL_UZ[skill]}`, href: '#/practice', done: doneToday(`practice:${skill}`) });
    return { lang: L.code, steps, doneCount: steps.filter((s) => s.done).length, skills: stats, weakest: weak ? weak.skill : null };
  });
};

module.exports.recordAnswer = recordAnswer;
module.exports.REASONS = REASONS;
