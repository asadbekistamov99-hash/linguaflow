'use strict';
const crypto = require('node:crypto');
const { dateKey, dayStartMs } = require('./db');
const { normalize, shuffle } = require('./exercises');

const CLOSED = ['mcq', 'gap', 'tf_ng', 'short'];
const SKILLS = ['vocab', 'grammar', 'reading', 'listening'];
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const DAILY_PRACTICE_XP_CAP = 60;
const TF_LABEL = { true: "To'g'ri", false: "Noto'g'ri", not_given: 'Aytilmagan' };

// Learner-facing practice over APPROVED bank items. Answers stay on the server until a question is answered.
module.exports = function registerPractice({ db, route, content, HttpError, requireUser, awardProgress, validLang }) {
  const sessions = new Map();
  const practiceXpToday = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM xp_events WHERE user_id=? AND source LIKE 'practice:%' AND created_at>=?");

  const langOf = (user, raw) => {
    const code = raw || validLang(user.current_lang);
    const L = content.lang(code);
    if (!L) throw new HttpError(400, "Noto'g'ri til");
    return L;
  };

  function present(row) {
    const p = JSON.parse(row.payload);
    const out = { id: row.id, type: row.type, level: row.level, skill: row.skill };
    if (row.skill === 'reading' && p.passage) out.passage = p.passage;
    if (row.skill === 'listening' && p.transcript) out.speak = p.transcript; // read aloud by the browser, not displayed
    if (row.type === 'mcq') { out.question = p.question; out.options = p.options; }
    else if (row.type === 'gap') out.text = p.text;
    else if (row.type === 'tf_ng') { out.statement = p.statement; out.options = ['true', 'false', 'not_given'].map((v) => ({ value: v, label: TF_LABEL[v] })); }
    else out.question = p.question;
    return out;
  }

  function judge(row, answer) {
    const p = JSON.parse(row.payload);
    if (row.type === 'mcq') {
      const idx = Number(answer);
      return { correct: Number.isInteger(idx) && idx === p.answer, shown: p.options[p.answer], p };
    }
    if (row.type === 'tf_ng') return { correct: answer === p.answer, shown: TF_LABEL[p.answer], p };
    const given = normalize(answer);
    return { correct: !!given && p.answers.some((a) => normalize(a) === given), shown: p.answers[0], p };
  }

  route('GET', '/api/practice/summary', async ({ req, url }) => {
    const u = requireUser(req);
    const L = langOf(u, url.searchParams.get('lang'));
    const rows = db.prepare(`SELECT skill, level, COUNT(*) n FROM items WHERE lang=? AND status='approved' AND type IN (${CLOSED.map(() => '?').join(',')}) AND skill IN (${SKILLS.map(() => '?').join(',')}) GROUP BY skill, level`).all(L.code, ...CLOSED, ...SKILLS);
    return { lang: L.code, skills: SKILLS, levels: LEVELS, counts: rows.map((r) => ({ skill: r.skill, level: r.level, n: r.n })) };
  });

  route('POST', '/api/practice/start', async ({ req, body }) => {
    const u = requireUser(req);
    const L = langOf(u, body.lang);
    if (!SKILLS.includes(body.skill)) throw new HttpError(400, "Noto'g'ri ko'nikma");
    if (body.level !== undefined && !LEVELS.includes(body.level)) throw new HttpError(400, "Noto'g'ri daraja");
    const count = Math.min(15, Math.max(3, Number(body.count) || 10));
    const args = [L.code, body.skill, ...CLOSED];
    let sql = `SELECT * FROM items WHERE lang=? AND status='approved' AND skill=? AND type IN (${CLOSED.map(() => '?').join(',')})`;
    if (body.level) { sql += ' AND level=?'; args.push(body.level); }
    const rows = shuffle(db.prepare(sql).all(...args)).slice(0, count);
    if (!rows.length) throw new HttpError(404, "Bu bo'lim uchun tasdiqlangan savollar hali yo'q");
    for (const [k, v] of sessions) if (v.exp < Date.now()) sessions.delete(k);
    const mine = [...sessions.entries()].filter(([, v]) => v.userId === u.id);
    if (mine.length >= 3) for (const [k] of mine.slice(0, mine.length - 2)) sessions.delete(k);
    const sid = crypto.randomBytes(12).toString('hex');
    sessions.set(sid, { userId: u.id, lang: L.code, skill: body.skill, rows: new Map(rows.map((r) => [r.id, r])), results: new Map(), exp: Date.now() + 2 * 3600000 });
    return { sessionId: sid, lang: { code: L.code, tts: L.tts, dir: L.dir }, skill: body.skill, items: rows.map(present) };
  });

  function sessionOf(req, sid) {
    const u = requireUser(req);
    const s = sessions.get(sid);
    if (!s || s.userId !== u.id || s.exp < Date.now()) throw new HttpError(404, 'Sessiya topilmadi');
    return { u, s };
  }

  route('POST', '/api/practice/:sid/answer', async ({ req, params, body }) => {
    const { s } = sessionOf(req, params.sid);
    const row = s.rows.get(Number(body.itemId));
    if (!row) throw new HttpError(400, 'Savol topilmadi');
    if (s.results.has(row.id)) throw new HttpError(409, 'Bu savolga javob berilgan');
    const j = judge(row, body.answer);
    s.results.set(row.id, j.correct);
    return { correct: j.correct, answer: j.shown, explanation: j.p.explanation_uz || null };
  });

  route('POST', '/api/practice/:sid/finish', async ({ req, params }) => {
    const { u, s } = sessionOf(req, params.sid);
    sessions.delete(params.sid);
    const total = s.rows.size, answered = s.results.size;
    const correct = [...s.results.values()].filter(Boolean).length;
    let xp = 0;
    if (answered >= Math.ceil(total / 2)) {
      const done = practiceXpToday.get(u.id, dayStartMs(dateKey())).s;
      xp = Math.max(0, Math.min(correct * 2, 20, DAILY_PRACTICE_XP_CAP - done));
    }
    const prog = awardProgress(u, { xp, lang: s.lang, source: `practice:${s.skill}` });
    return { total, answered, correct, accuracy: answered ? correct / answered : 0, xp, streak: prog.streak, user: prog.user, badges: prog.badges };
  });
};
