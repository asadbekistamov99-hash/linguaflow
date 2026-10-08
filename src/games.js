'use strict';
const { dateKey, dayStartMs, DAY } = require('./db');
const { shuffle, sample } = require('./exercises');

const DAILY_GAME_XP_CAP = 80;
const MIN_GAP_MS = 8000;

const int = (v, min, max) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

// Games are played in the browser, so the server only accepts plausible results and caps the XP they can give.
const GAMES = {
  memory: {
    title: 'Xotira',
    evaluate(b) {
      const moves = int(b.moves, 8, 80), timeMs = int(b.timeMs, 6000, 900000);
      if (b.pairs !== 8 || moves == null || timeMs == null) return null;
      return { score: Math.max(0, 1000 - (moves - 8) * 25 - Math.floor(timeMs / 1000) * 4), xp: 8 + (moves <= 12 ? 8 : moves <= 16 ? 4 : 0) };
    },
  },
  blitz: {
    title: 'Blitz',
    evaluate(b) {
      const correct = int(b.correct, 0, 45), wrong = int(b.wrong, 0, 60), timeMs = int(b.timeMs, 50000, 75000);
      if (correct == null || wrong == null || timeMs == null) return null;
      return { score: Math.max(0, correct * 10 - wrong * 5), xp: Math.min(25, Math.floor(correct * 0.7)) };
    },
  },
  scramble: {
    title: "So'z tuzish",
    evaluate(b) {
      const solved = int(b.solved, 0, 15), timeMs = int(b.timeMs, 1000, 300000);
      if (solved == null || timeMs == null || timeMs < solved * 2000) return null;
      return { score: solved * 100, xp: Math.min(20, solved * 2) };
    },
  },
  builder: {
    title: 'Jumla quruvchi',
    evaluate(b) {
      const solved = int(b.solved, 0, 10), timeMs = int(b.timeMs, 1000, 600000);
      if (solved == null || timeMs == null || timeMs < solved * 3000) return null;
      return { score: solved * 100, xp: Math.min(24, solved * 3) };
    },
  },
};

module.exports = function registerGames({ db, route, content, HttpError, requireUser, awardProgress, lessonStates, validLang }) {
  const lastPlay = new Map();
  const gameXpToday = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM xp_events WHERE user_id=? AND source LIKE 'game:%' AND created_at>=?");
  const addScore = db.prepare('INSERT INTO game_scores (user_id,game,lang,score,created_at) VALUES (?,?,?,?,?)');
  const bestScore = db.prepare('SELECT COALESCE(MAX(score),0) s FROM game_scores WHERE user_id=? AND game=?');
  const top = db.prepare(`
    SELECT u.id, u.name, MAX(g.score) score FROM game_scores g JOIN users u ON u.id=g.user_id
    WHERE g.game=? AND g.created_at>=? AND u.banned=0 GROUP BY u.id ORDER BY score DESC, u.id LIMIT 10`);

  // Words the learner has met (finished lessons); falls back to the current lesson, then the first unit.
  function pool(user, lang) {
    const states = lessonStates(user.id, lang).filter((l) => l.kind === 'lesson');
    const take = (list) => [...new Set(list.flatMap((l) => l.conceptIds))].map((id) => content.concept(id)).filter((c) => c && c.t[lang]);
    let words = take(states.filter((l) => l.state === 'done'));
    if (words.length < 12) words = take(states.filter((l) => l.state !== 'locked'));
    if (words.length < 8) words = take(states.slice(0, 2));
    const unlockedUnits = new Set(states.filter((l) => l.state !== 'locked').map((l) => l.unit));
    return { words, unlockedUnits };
  }

  function langFor(user, url) {
    const lang = url.searchParams.get('lang') || validLang(user.current_lang);
    const L = content.lang(lang);
    if (!L) throw new HttpError(400, "Noto'g'ri til");
    return L;
  }

  route('GET', '/api/games', async ({ req }) => {
    requireUser(req);
    return { games: Object.entries(GAMES).map(([key, g]) => ({ key, title: g.title })), dailyCap: DAILY_GAME_XP_CAP };
  });

  route('GET', '/api/games/words', async ({ req, url }) => {
    const u = requireUser(req);
    const L = langFor(u, url);
    const n = Math.min(60, Math.max(8, Number(url.searchParams.get('n')) || 24));
    const { words } = pool(u, L.code);
    return {
      lang: { code: L.code, tts: L.tts, dir: L.dir, name: L.name },
      words: sample(words, n).map((c) => ({ id: c.id, target: c.t[L.code], uz: c.uz, tr: (c.tr || {})[L.code] || null })),
    };
  });

  route('GET', '/api/games/sentences', async ({ req, url }) => {
    const u = requireUser(req);
    const L = langFor(u, url);
    const n = Math.min(20, Math.max(3, Number(url.searchParams.get('n')) || 10));
    const { unlockedUnits } = pool(u, L.code);
    const all = content.units().filter((x) => unlockedUnits.has(x.key)).flatMap((x) => x.sentences)
      .filter((s) => { const k = content.tokensOf(s.t[L.code]).length; return k >= 2 && k <= 9; });
    return {
      lang: { code: L.code, tts: L.tts, dir: L.dir, name: L.name },
      sentences: sample(all, n).map((s) => ({ id: s.id, uz: s.uz, words: content.tokensOf(s.t[L.code]), shuffled: shuffle(content.tokensOf(s.t[L.code])) })),
    };
  });

  route('GET', '/api/games/highscores', async ({ req, url }) => {
    const u = requireUser(req);
    const game = url.searchParams.get('game');
    if (!Object.hasOwn(GAMES, game)) throw new HttpError(400, "Noto'g'ri o'yin");
    const rows = top.all(game, Date.now() - 7 * DAY).map((r, i) => ({ rank: i + 1, name: r.name, score: r.score, me: r.id === u.id }));
    return { rows, best: bestScore.get(u.id, game).s };
  });

  route('POST', '/api/games/score', async ({ req, body }) => {
    const u = requireUser(req);
    const g = Object.hasOwn(GAMES, body.game) ? GAMES[body.game] : null;
    if (!g) throw new HttpError(400, "Noto'g'ri o'yin");
    const lang = content.lang(body.lang) ? body.lang : validLang(u.current_lang);
    const now = Date.now();
    if (now - (lastPlay.get(u.id) || 0) < MIN_GAP_MS) throw new HttpError(429, "Biroz sekinroq, o'yin natijasi juda tez yuborildi");
    const r = g.evaluate(body);
    if (!r) throw new HttpError(400, "Natija noto'g'ri");
    lastPlay.set(u.id, now);
    if (lastPlay.size > 5000) for (const [k, t] of lastPlay) if (now - t > 3600000) lastPlay.delete(k);

    const dayStart = dayStartMs(dateKey(now));
    const left = Math.max(0, DAILY_GAME_XP_CAP - gameXpToday.get(u.id, dayStart).s);
    const xp = Math.min(r.xp, left);
    if (r.score <= 0) return { score: 0, xp: 0, capped: false, best: bestScore.get(u.id, body.game).s, streak: 0, user: null, badges: [] };
    addScore.run(u.id, body.game, lang, r.score, now);
    const prog = awardProgress(u, { xp, lang, source: `game:${body.game}`, ctx: { game: true } });
    return { score: r.score, xp, capped: xp < r.xp, best: bestScore.get(u.id, body.game).s, streak: prog.streak, user: prog.user, badges: prog.badges };
  });
};
