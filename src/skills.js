'use strict';
const crypto = require('node:crypto');
const tutor = require('./tutor');
const grading = require('./grading');
const { present, judge, CLOSED } = require('./practice');
const { dateKey, dayStartMs } = require('./db');
const { shuffle } = require('./exercises');

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const DISCLAIMER = "Bu LinguaFlow ichki tayyorgarlik bahosi (taxminiy). U rasmiy IELTS, CEFR yoki boshqa xalqaro imtihon natijasi emas.";
const MOCK_SECTIONS = [['grammar', 12], ['vocab', 6], ['reading', 10], ['listening', 8]];
// Rough raw-score-to-band mapping inspired by public IELTS Listening/Reading tables; indicative only.
const bandFor = (pct) => [[97.5, 9], [92.5, 8.5], [87.5, 8], [82.5, 7.5], [75, 7], [67.5, 6.5], [57.5, 6], [47.5, 5.5], [37.5, 5], [30, 4.5]].find(([t]) => pct >= t)?.[1] ?? 4;
const wordCount = (s) => (String(s).trim().match(/\S+/g) || []).length;

// Writing and speaking feedback (AI rubric, free-tier quota) and timed mock exams from approved bank items.
module.exports = function registerSkills({ db, route, content, HttpError, requireUser, awardProgress, quota, validLang }) {
  const xpToday = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM xp_events WHERE user_id=? AND source=? AND created_at>=?');
  const mocks = new Map();

  const langOf = (user, raw) => {
    const L = content.lang(raw || validLang(user.current_lang));
    if (!L) throw new HttpError(400, "Noto'g'ri til");
    return L;
  };
  const levelOf = (raw, dflt) => {
    const lv = raw === undefined || raw === '' ? dflt : raw;
    if (!LEVELS.includes(lv)) throw new HttpError(400, "Noto'g'ri daraja");
    return lv;
  };
  const xpFor = (user, source, want, cap) => Math.max(0, Math.min(want, cap - xpToday.get(user.id, source, dayStartMs(dateKey())).s));

  function prompts(req, url, type) {
    const u = requireUser(req);
    const L = langOf(u, url.searchParams.get('lang'));
    const args = [L.code, type];
    let sql = "SELECT id, level, payload FROM items WHERE lang=? AND status='approved' AND type=?";
    if (url.searchParams.get('level')) { sql += ' AND level=?'; args.push(levelOf(url.searchParams.get('level'))); }
    const rows = db.prepare(sql + ' ORDER BY level, id').all(...args);
    return { lang: { code: L.code, tts: L.tts, dir: L.dir, name: L.name }, aiEnabled: !!tutor.activeProvider(), prompts: rows.map((r) => ({ id: r.id, level: r.level, ...JSON.parse(r.payload) })) };
  }

  function promptFor(body, L, type) {
    if (body.itemId !== undefined && body.itemId !== null) {
      const row = db.prepare("SELECT * FROM items WHERE id=? AND lang=? AND type=? AND status='approved'").get(Number(body.itemId), L.code, type);
      if (!row) throw new HttpError(400, 'Savol topilmadi');
      const p = JSON.parse(row.payload);
      return { itemId: row.id, level: row.level, prompt: p.prompt, minWords: p.min_words || 80 };
    }
    const prompt = String(body.prompt || '').trim();
    if (prompt.length < 5 || prompt.length > 300) throw new HttpError(400, 'Savol matni 5-300 belgi bo\'lsin');
    return { itemId: null, level: levelOf(body.level, 'B1'), prompt, minWords: 80 };
  }

  async function runAi(user, feature, fn) {
    if (!tutor.activeProvider()) throw new HttpError(503, "AI baholash hozircha o'chiq. Serverda GEMINI_API_KEY, OPENAI_API_KEY yoki ANTHROPIC_API_KEY ni sozlang.");
    const qr = quota.consume(user, feature);
    if (!qr.ok) throw new HttpError(429, qr.limit === 0 ? "Bu imkoniyat hozircha o'chirilgan." : `Bugungi bepul limit tugadi (${qr.limit} ta). Ertaga qayta urinib ko'ring.`);
    try { return await fn(); } catch (e) {
      if (e instanceof HttpError) throw e;
      console.error('grading error:', e.message);
      throw new HttpError(502, "AI baholash hozir ishlamadi, keyinroq urinib ko'ring");
    }
  }

  const save = (user, kind, L, meta, input, result) => Number(db.prepare('INSERT INTO skill_submissions (user_id,kind,lang,level,item_id,prompt,input,result,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(user.id, kind, L.code, meta.level, meta.itemId, meta.prompt, input, JSON.stringify(result), Date.now()).lastInsertRowid);

  // ---- writing ----
  route('GET', '/api/writing/prompts', async ({ req, url }) => prompts(req, url, 'essay_prompt'));

  route('POST', '/api/writing/submit', async ({ req, body }) => {
    const u = requireUser(req);
    const L = langOf(u, body.lang);
    const meta = promptFor(body, L, 'essay_prompt');
    const essay = String(body.text || '').trim();
    const words = wordCount(essay);
    if (essay.length > 4000) throw new HttpError(400, 'Matn juda uzun (4000 belgigacha)');
    if (words < 20) throw new HttpError(400, 'Kamida 20 ta so\'z yozing');
    const result = await runAi(u, 'writing', () => grading.gradeWriting({ langName: L.name, level: meta.level, prompt: meta.prompt, essay, minWords: meta.minWords }));
    const id = save(u, 'writing', L, meta, essay, result);
    const xp = xpFor(u, 'skill:writing', 10, 30);
    const prog = awardProgress(u, { xp, lang: L.code, source: 'skill:writing' });
    return { id, words, result, xp, user: prog.user, badges: prog.badges, disclaimer: DISCLAIMER };
  });

  // ---- speaking ----
  route('GET', '/api/speaking/prompts', async ({ req, url }) => prompts(req, url, 'speaking_prompt'));

  route('POST', '/api/speaking/submit', async ({ req, body }) => {
    const u = requireUser(req);
    const L = langOf(u, body.lang);
    const meta = promptFor(body, L, 'speaking_prompt');
    const transcript = String(body.transcript || '').trim();
    const words = wordCount(transcript);
    const seconds = Math.round(Number(body.seconds));
    if (transcript.length > 3000) throw new HttpError(400, 'Matn juda uzun');
    if (words < 15) throw new HttpError(400, "Kamida 15 ta so'z gapiring");
    if (!Number.isFinite(seconds) || seconds < 5 || seconds > 600) throw new HttpError(400, 'Davomiylik 5-600 soniya bo\'lsin');
    const wpm = Math.round((words / seconds) * 60);
    if (wpm > 260) throw new HttpError(400, 'Gapirish tezligi ishonchsiz: qayta urinib ko\'ring');
    const result = await runAi(u, 'speaking', () => grading.gradeSpeaking({ langName: L.name, level: meta.level, prompt: meta.prompt, transcript, seconds, wordsPerMinute: wpm }));
    const id = save(u, 'speaking', L, meta, transcript, { ...result, wpm });
    const xp = xpFor(u, 'skill:speaking', 10, 30);
    const prog = awardProgress(u, { xp, lang: L.code, source: 'skill:speaking' });
    return { id, words, wpm, result, xp, user: prog.user, badges: prog.badges, note: "Talaffuz bu yerda baholanmaydi: faqat matnga aylantirilgan nutq tahlil qilinadi.", disclaimer: DISCLAIMER };
  });

  route('GET', '/api/skills/history', async ({ req, url }) => {
    const u = requireUser(req);
    const kind = url.searchParams.get('kind');
    if (kind && !['writing', 'speaking'].includes(kind)) throw new HttpError(400, "Noto'g'ri tur");
    const rows = db.prepare(`SELECT id, kind, lang, level, prompt, result, created_at FROM skill_submissions WHERE user_id=? ${kind ? 'AND kind=?' : ''} ORDER BY id DESC LIMIT 30`).all(...(kind ? [u.id, kind] : [u.id]));
    return { history: rows.map((r) => ({ id: r.id, kind: r.kind, lang: r.lang, level: r.level, prompt: r.prompt, createdAt: r.created_at, result: JSON.parse(r.result) })) };
  });

  // ---- mock exam (closed-answer items; writing/speaking are practised separately) ----
  route('POST', '/api/mock/start', async ({ req, body }) => {
    const u = requireUser(req);
    const L = langOf(u, body.lang);
    const level = levelOf(body.level, 'B2');
    const picked = [];
    for (const [skill, n] of MOCK_SECTIONS) {
      const rows = db.prepare(`SELECT * FROM items WHERE lang=? AND level=? AND skill=? AND status='approved' AND type IN (${CLOSED.map(() => '?').join(',')})`).all(L.code, level, skill, ...CLOSED);
      picked.push(...shuffle(rows).slice(0, n));
    }
    if (picked.length < 8) throw new HttpError(404, `${level} darajasi uchun tasdiqlangan savollar hali yetarli emas`);
    for (const [k, v] of mocks) if (v.exp < Date.now()) mocks.delete(k);
    const mine = [...mocks.entries()].filter(([, v]) => v.userId === u.id);
    if (mine.length >= 2) for (const [k] of mine.slice(0, mine.length - 1)) mocks.delete(k);
    const durationMin = Math.ceil(picked.length * 1.5);
    const sid = crypto.randomBytes(12).toString('hex');
    mocks.set(sid, { userId: u.id, lang: L.code, level, rows: new Map(picked.map((r) => [r.id, r])), startedAt: Date.now(), durationMin, exp: Date.now() + (durationMin + 30) * 60000 });
    return { sessionId: sid, level, durationMin, lang: { code: L.code, tts: L.tts, dir: L.dir }, items: picked.map(present), disclaimer: DISCLAIMER };
  });

  route('POST', '/api/mock/:sid/submit', async ({ req, params, body }) => {
    const u = requireUser(req);
    const s = mocks.get(params.sid);
    if (!s || s.userId !== u.id || s.exp < Date.now()) throw new HttpError(404, 'Imtihon topilmadi');
    mocks.delete(params.sid);
    const answers = body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers) ? body.answers : {};
    const sections = {};
    const review = [];
    for (const row of s.rows.values()) {
      const given = answers[row.id];
      const j = given === undefined || given === null || given === '' ? { correct: false, shown: judge(row, '').shown, p: JSON.parse(row.payload) } : judge(row, given);
      const sec = (sections[row.skill] ||= { total: 0, correct: 0 });
      sec.total++; if (j.correct) sec.correct++;
      review.push({ id: row.id, correct: j.correct, answered: given !== undefined && given !== null && given !== '', answer: j.shown, explanation: j.p.explanation_uz || null });
    }
    const total = s.rows.size, correct = review.filter((r) => r.correct).length;
    const pct = Math.round((correct / total) * 100);
    const verdict = pct >= 70 ? 'ready' : pct >= 50 ? 'close' : 'practice';
    const message = { ready: `${s.level} darajasiga tayyor ko'rinasiz`, close: `${s.level} darajasiga yaqinsiz: zaif bo'limlarni takrorlang`, practice: `${s.level} uchun hali ko'proq mashq kerak` }[verdict];
    db.prepare('INSERT INTO mock_results (user_id,lang,level,total,correct,sections,created_at) VALUES (?,?,?,?,?,?,?)').run(u.id, s.lang, s.level, total, correct, JSON.stringify(sections), Date.now());
    const xp = xpFor(u, 'mock', Math.min(30, Math.round(pct * 0.3)), 60);
    const prog = awardProgress(u, { xp, lang: s.lang, source: 'mock' });
    const ielts = s.lang === 'en' && ['B2', 'C1', 'C2'].includes(s.level) ? { band: bandFor(pct), note: "IELTS Listening/Reading jadvaliga o'xshash taxminiy ball: rasmiy natija emas" } : null;
    return { total, correct, percent: pct, sections, ielts, verdict, message, review, xp, elapsedMin: Math.round((Date.now() - s.startedAt) / 60000), user: prog.user, badges: prog.badges, disclaimer: DISCLAIMER };
  });

  route('GET', '/api/mock/history', async ({ req }) => {
    const u = requireUser(req);
    const rows = db.prepare('SELECT id, lang, level, total, correct, sections, created_at FROM mock_results WHERE user_id=? ORDER BY id DESC LIMIT 20').all(u.id);
    return { history: rows.map((r) => ({ id: r.id, lang: r.lang, level: r.level, total: r.total, correct: r.correct, percent: Math.round((r.correct / r.total) * 100), sections: JSON.parse(r.sections), createdAt: r.created_at })) };
  });
};
