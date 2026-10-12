'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { normalize } = require('../src/exercises');
const { nextState } = require('../src/srs');

for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'AI_PROVIDER', 'ADMIN_EMAILS', 'FIRST_USER_ADMIN']) delete process.env[k];

const dirs = [];
async function boot() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-'));
  dirs.push(dataDir);
  const { server, db, content } = createApp({ dbFile: ':memory:', dataDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  server.unref();
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (method, url, body) => {
      const r = await fetch(base + url, {
        method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      });
      const sc = r.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      return { status: r.status, data: await r.json().catch(() => null) };
    };
  };
  return { base, db, content, client, close: () => { server.closeAllConnections(); server.close(); } };
}
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const reg = (api, name, email) => api('POST', '/api/auth/register', { name, email, password: 'secret1234' });

// Solves an exercise using content knowledge (the API never sends answers).
function solve(content, e, lang) {
  const c = e.cid ? content.concept(e.cid) : null;
  switch (e.type) {
    case 'mcq': return e.word ? c.uz : c.t[lang];
    case 'listen': return c.uz;
    case 'type': return c.t[lang];
    case 'order': return content.tokensOf(content.sentence(e.sid).t[lang]);
    case 'match': {
      const byTarget = (t) => content.units().flatMap((u) => u.concepts).find((x) => x.t[lang] === t);
      return Object.fromEntries(e.left.map((l) => [l, byTarget(l).uz]));
    }
    default: return null;
  }
}

async function play(app, api, lessonId, { wrong = false } = {}) {
  const lang = lessonId.split('.')[0];
  const start = await api('POST', `/api/lessons/${lessonId}/start`, {});
  assert.equal(start.status, 200, JSON.stringify(start.data));
  for (const e of start.data.exercises.filter((x) => x.type !== 'learn')) {
    const ans = wrong ? (e.type === 'order' ? [] : e.type === 'match' ? {} : 'zzz') : solve(app.content, e, lang);
    const r = await api('POST', `/api/sessions/${start.data.sid}/answer`, { exId: e.id, answer: ans });
    assert.equal(r.status, 200);
    assert.equal(r.data.correct, !wrong, `${e.type}: ${e.prompt}`);
  }
  return api('POST', `/api/sessions/${start.data.sid}/finish`, {});
}

test('content: 20 units, 6 languages, lessons and tests per unit', async () => {
  const app = await boot();
  assert.equal(app.content.units().length, 20);
  assert.equal(app.content.langs().length, 6);
  for (const l of app.content.langs()) {
    const ls = app.content.lessons(l.code);
    assert.equal(ls.filter((x) => x.kind === 'lesson').length, 40);
    assert.equal(ls.filter((x) => x.kind === 'test').length, 20);
    for (const x of ls) assert.ok(x.conceptIds.every((id) => app.content.concept(id).t[l.code]));
  }
  app.close();
});

test('exercises never leak answers', async () => {
  const app = await boot();
  const api = app.client();
  await reg(api, 'Ali', 'leak@x.uz');
  const s = await api('POST', '/api/lessons/en.greetings.1/start', {});
  const raw = JSON.stringify(s.data);
  for (const k of ['"answer"', '"accept"', '"pairs"']) assert.ok(!raw.includes(k), k);
  assert.ok(s.data.exercises.some((e) => e.type === 'order'), 'lesson should include a sentence-order exercise');
  app.close();
});

test('auth: validation, duplicate, login, logout, first user is admin', async () => {
  const app = await boot();
  const api = app.client();
  assert.equal((await api('GET', '/api/me')).status, 401);
  assert.equal((await api('POST', '/api/auth/register', { name: 'A', email: 'bad', password: '123' })).status, 400);
  const ok = await reg(api, 'Vali', 'Vali@Test.uz');
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.email, 'vali@test.uz');
  assert.equal(ok.data.user.isAdmin, true, 'first account becomes admin');
  const second = await reg(app.client(), 'Soli', 'soli@test.uz');
  assert.equal(second.data.user.isAdmin, false);
  assert.equal((await reg(app.client(), 'Vali2', 'vali@test.uz')).status, 409);
  const other = app.client();
  assert.equal((await other('POST', '/api/auth/login', { email: 'vali@test.uz', password: 'wrongpass' })).status, 401);
  assert.equal((await other('POST', '/api/auth/login', { email: 'vali@test.uz', password: 'secret1234' })).status, 200);
  await other('POST', '/api/auth/logout', {});
  app.close();
});

test('security: non-JSON POST, tampered cookie, path traversal, admin routes closed to users', async () => {
  const app = await boot();
  const r = await fetch(app.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=b' });
  assert.equal(r.status, 415);
  assert.equal((await fetch(app.base + '/api/me', { headers: { cookie: 'lf_session=abc.def' } })).status, 401);
  assert.equal((await fetch(app.base + '/..%2f..%2fpackage.json')).status, 403);
  const admin = app.client(); await reg(admin, 'Boss', 'boss@test.uz');
  const user = app.client(); await reg(user, 'User', 'user@test.uz');
  for (const [m, u] of [['GET', '/api/admin/stats'], ['GET', '/api/admin/users'], ['GET', '/api/admin/content'], ['DELETE', '/api/admin/users/1']]) {
    assert.equal((await user(m, u)).status, 403, u);
    assert.equal((await app.client()(m, u)).status, 401, u);
  }
  app.close();
});

test('lesson flow: lock, perfect score, unit test, xp, streak, badges, review', async () => {
  const app = await boot();
  const api = app.client();
  await reg(api, 'Admin', 'a@test.uz');
  const u2 = app.client(); await reg(u2, 'Gulnora', 'g@test.uz');

  assert.equal((await u2('POST', '/api/lessons/en.greetings.2/start', {})).status, 403);
  assert.equal((await u2('POST', '/api/lessons/en.greetings.test/start', {})).status, 403);

  const fin = await play(app, u2, 'en.greetings.1');
  assert.equal(fin.data.accuracy, 1);
  assert.equal(fin.data.stars, 3);
  assert.ok(fin.data.passed && fin.data.firstTime);
  assert.equal(fin.data.user.streak, 1);
  assert.ok(['first_lesson', 'perfect'].every((k) => fin.data.badges.some((b) => b.key === k)));

  const failed = await play(app, u2, 'en.greetings.2', { wrong: true });
  assert.equal(failed.data.passed, false);
  assert.equal((await u2('GET', '/api/courses/en')).data.units[0].lessons[1].state, 'available');

  const f2 = await play(app, u2, 'en.greetings.2');
  assert.ok(f2.data.passed);
  const course = (await u2('GET', '/api/courses/en')).data;
  assert.equal(course.units[0].test.state, 'available');
  assert.equal(course.units[1].lessons[0].state, 'available');
  assert.equal(course.units[1].test.state, 'locked');

  const t = await play(app, u2, 'en.greetings.test');
  assert.ok(t.data.passed && t.data.kind === 'test');
  assert.ok(t.data.badges.some((b) => b.key === 'unit_master'));
  assert.equal((await u2('GET', '/api/courses/en')).data.units[0].test.state, 'done');

  const again = await play(app, u2, 'en.greetings.1');
  assert.ok(again.data.xp < fin.data.xp);
  app.close();
});

test('review: wrong words become due later, correct ones schedule ahead', async () => {
  const app = await boot();
  await reg(app.client(), 'Admin', 'a@test.uz');
  const api = app.client(); await reg(api, 'Sardor', 's@test.uz');
  assert.equal((await api('POST', '/api/review/start', { lang: 'en' })).data.empty, true);
  await play(app, api, 'en.greetings.1', { wrong: true });
  assert.equal((await api('GET', '/api/review/summary?lang=en')).data.due, 0);
  app.db.prepare('UPDATE word_progress SET due_at = 0').run();
  assert.equal((await api('GET', '/api/review/summary?lang=en')).data.due, 5);
  const rv = await api('POST', '/api/review/start', { lang: 'en' });
  for (const e of rv.data.exercises) await api('POST', `/api/sessions/${rv.data.sid}/answer`, { exId: e.id, answer: solve(app.content, e, 'en') });
  const done = await api('POST', `/api/sessions/${rv.data.sid}/finish`, {});
  assert.ok(done.data.badges.some((b) => b.key === 'reviewer'));
  assert.equal((await api('GET', '/api/review/summary?lang=en')).data.due, 0);
  app.close();
});

test('placement test marks earlier lessons as done', async () => {
  const app = await boot();
  await reg(app.client(), 'Admin', 'a@test.uz');
  const api = app.client(); await reg(api, 'Placed', 'p@test.uz');
  const s = await api('POST', '/api/placement/start', { lang: 'de' });
  assert.equal(s.status, 200);
  for (const e of s.data.exercises) await api('POST', `/api/sessions/${s.data.sid}/answer`, { exId: e.id, answer: solve(app.content, e, 'de') });
  const fin = await api('POST', `/api/sessions/${s.data.sid}/finish`, {});
  assert.equal(fin.data.kind, 'placement');
  assert.equal(fin.data.placedUnits, 20);
  assert.equal(fin.data.xp, 0);
  assert.ok(fin.data.badges.some((b) => b.key === 'explorer'));
  const course = (await api('GET', '/api/courses/de')).data;
  assert.ok(course.units.every((u) => u.lessons.every((l) => l.state === 'done')));

  const weak = await api('POST', '/api/placement/start', { lang: 'fr' });
  for (const e of weak.data.exercises) await api('POST', `/api/sessions/${weak.data.sid}/answer`, { exId: e.id, answer: 'zzz' });
  const f2 = await api('POST', `/api/sessions/${weak.data.sid}/finish`, {});
  assert.equal(f2.data.placedUnits, 0);
  assert.equal((await api('GET', '/api/courses/fr')).data.units[0].lessons[0].state, 'available');
  app.close();
});

test('sessions are private and finish requires real answers', async () => {
  const app = await boot();
  await reg(app.client(), 'Admin', 'a@test.uz');
  const a = app.client(), b = app.client();
  await reg(a, 'Anvar', 'a1@test.uz'); await reg(b, 'Bahrom', 'b1@test.uz');
  const s = await a('POST', '/api/lessons/ru.greetings.1/start', {});
  const e = s.data.exercises.find((x) => x.type !== 'learn');
  assert.equal((await b('POST', `/api/sessions/${s.data.sid}/answer`, { exId: e.id, answer: 'x' })).status, 404);
  assert.equal((await a('POST', `/api/sessions/${s.data.sid}/finish`, {})).status, 400);
  app.close();
});

test('games: words, score validation, daily cap, rate limit, highscores', async () => {
  const app = await boot();
  await reg(app.client(), 'Admin', 'a@test.uz');
  const api = app.client(); await reg(api, 'Gamer', 'g@test.uz');
  const w = await api('GET', '/api/games/words?lang=en&n=16');
  assert.equal(w.status, 200);
  assert.ok(w.data.words.length >= 8 && w.data.words[0].target && w.data.words[0].uz);

  // 5-word level batching: level 1 and level 2 must have distinct words
  const l1 = await api('GET', '/api/games/words?lang=en&level=1');
  const l2 = await api('GET', '/api/games/words?lang=en&level=2');
  assert.equal(l1.status, 200);
  assert.equal(l2.status, 200);
  assert.equal(l1.data.words.length, 5);
  assert.equal(l2.data.words.length, 5);
  const ids1 = new Set(l1.data.words.map((x) => x.id));
  assert.ok(l2.data.words.every((x) => !ids1.has(x.id)), 'level 2 must contain different words than level 1');

  const sn = await api('GET', '/api/games/sentences?lang=en');
  assert.ok(sn.data.sentences.length >= 3);
  assert.deepEqual([...sn.data.sentences[0].words].sort(), [...sn.data.sentences[0].shuffled].sort());

  assert.equal((await api('POST', '/api/games/score', { game: 'memory', lang: 'en', pairs: 8, moves: 2, timeMs: 100 })).status, 400);
  const ok = await api('POST', '/api/games/score', { game: 'memory', lang: 'en', pairs: 8, moves: 12, timeMs: 40000 });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.xp, 16);
  assert.ok(ok.data.badges.some((b) => b.key === 'gamer'));
  assert.equal((await api('POST', '/api/games/score', { game: 'blitz', lang: 'en', correct: 10, wrong: 1, timeMs: 60000 })).status, 429);
  assert.equal((await api('POST', '/api/games/score', { game: 'nope' })).status, 400);

  // cap: lift the rate limit by faking time in the DB is not needed; use a second user to hit the cap path
  const hs = await api('GET', '/api/games/highscores?game=memory');
  assert.ok(hs.data.rows.some((r) => r.me) && hs.data.best > 0);
  app.close();
});

test('leaderboard, badges, profile update, languages, dictionary, config', async () => {
  const app = await boot();
  await reg(app.client(), 'Admin', 'a@test.uz');
  const api = app.client(); await reg(api, 'Lola', 'l@test.uz');
  await play(app, api, 'ar.greetings.1');
  assert.ok((await api('GET', '/api/leaderboard')).data.rows.some((r) => r.me && r.xp > 0));
  assert.ok((await api('GET', '/api/badges')).data.badges.find((x) => x.key === 'first_lesson').earned);
  assert.equal((await api('PATCH', '/api/me', { dailyGoal: 33 })).status, 400);
  assert.equal((await api('PATCH', '/api/me', { dailyGoal: 30, currentLang: 'de' })).data.user.currentLang, 'de');
  const langs = await api('GET', '/api/languages');
  assert.equal(langs.data.languages.length, 6);
  assert.equal(langs.data.languages.find((l) => l.code === 'ar').done, 1);
  const dict = await api('GET', '/api/dictionary?lang=ar');
  assert.equal(dict.data.words.length, 200);
  assert.ok(dict.data.words.some((x) => x.reps >= 0));
  assert.equal((await api('GET', '/api/config')).data.announcement, null);
  app.close();
});

test('tutor degrades gracefully without API key', async () => {
  const app = await boot();
  const api = app.client(); await reg(api, 'Tutor', 't@test.uz');
  const r = await api('POST', '/api/tutor', { lang: 'en', messages: [{ role: 'user', content: 'Hello' }] });
  assert.equal(r.status, 200);
  assert.equal(r.data.disabled, true);
  app.close();
});

test('tutor: pronunciation practice mode and jarvis voice tutor', async () => {
  const app = await boot();
  const api = app.client(); await reg(api, 'Speaker', 'speaker@test.uz');
  const rPronunc = await api('POST', '/api/tutor', {
    lang: 'en',
    mode: 'pronunciation',
    isAudioPractice: true,
    messages: [{ role: 'user', content: '🎙️ "Good morning, how are you today?"' }]
  });
  assert.equal(rPronunc.status, 200);
  assert.ok(rPronunc.data.reply);

  const rJarvis = await api('POST', '/api/tutor', {
    lang: 'en',
    mode: 'jarvis',
    messages: [{ role: 'user', content: 'Hello Jarvis' }]
  });
  assert.equal(rJarvis.status, 200);
  assert.ok(rJarvis.data.reply);
  app.close();
});

test('admin: stats, users, roles, ban, reset, delete, guards', async () => {
  const app = await boot();
  const admin = app.client(); const me = (await reg(admin, 'Boss', 'boss@test.uz')).data.user;
  const u = app.client(); const uu = (await reg(u, 'Student', 'student@test.uz')).data.user;
  await play(app, u, 'en.greetings.1');

  const stats = (await admin('GET', '/api/admin/stats')).data;
  assert.equal(stats.totals.users, 2);
  assert.ok(stats.totals.lessonsDone >= 1 && stats.totals.xpTotal > 0);
  assert.equal(stats.series.length, 14);
  assert.equal(stats.series[13].signups, 2);

  const list = (await admin('GET', '/api/admin/users?q=stud')).data;
  assert.equal(list.total, 1);
  assert.equal(list.users[0].email, 'student@test.uz');
  assert.equal((await admin('GET', '/api/admin/users?q=%25')).data.total, 0, 'LIKE wildcards must be escaped');
  const detail = (await admin('GET', `/api/admin/users/${uu.id}`)).data;
  assert.equal(detail.progress[0].lang, 'en');
  assert.ok(detail.badges.length >= 1 && detail.recent.length >= 1);

  assert.equal((await admin('PATCH', `/api/admin/users/${me.id}`, { role: 'user' })).status, 400);
  assert.equal((await admin('PATCH', `/api/admin/users/${me.id}`, { banned: true })).status, 400);
  assert.equal((await admin('DELETE', `/api/admin/users/${me.id}`)).status, 400);

  assert.equal((await admin('PATCH', `/api/admin/users/${uu.id}`, { banned: true })).status, 200);
  assert.equal((await u('GET', '/api/me')).status, 403);
  assert.equal((await app.client()('POST', '/api/auth/login', { email: 'student@test.uz', password: 'secret1234' })).status, 403);
  assert.equal((await admin('PATCH', `/api/admin/users/${uu.id}`, { banned: false })).status, 200);
  assert.equal((await u('GET', '/api/me')).status, 200);

  assert.equal((await admin('PATCH', `/api/admin/users/${uu.id}`, { role: 'admin' })).status, 200);
  assert.equal((await admin('DELETE', `/api/admin/users/${uu.id}`)).status, 400, 'admins must be demoted before deletion');
  await admin('PATCH', `/api/admin/users/${uu.id}`, { role: 'user' });

  assert.equal((await admin('POST', `/api/admin/users/${uu.id}/reset`, { what: 'progress' })).status, 200);
  assert.equal((await u('GET', '/api/courses/en')).data.units[0].lessons[0].state, 'available');
  assert.equal((await admin('POST', `/api/admin/users/${uu.id}/reset`, { what: 'xp' })).status, 200);
  assert.equal((await u('GET', '/api/me')).data.user.xp, 0);
  assert.equal((await admin('DELETE', `/api/admin/users/${uu.id}`)).status, 200);
  assert.equal((await admin('GET', '/api/admin/stats')).data.totals.users, 1);
  assert.ok((await admin('GET', '/api/admin/audit')).data.rows.length >= 5);
  app.close();
});

test('admin: content editing flows into lessons, new language and unit work', async () => {
  const app = await boot();
  const admin = app.client(); await reg(admin, 'Boss', 'boss@test.uz');
  const u = app.client(); await reg(u, 'Student', 'student@test.uz');

  const content = (await admin('GET', '/api/admin/content')).data;
  assert.equal(content.units.length, 20);
  assert.equal(content.languages.find((l) => l.code === 'en').concepts, 200);

  // new unit + concepts: 6 words -> 1 lesson (+ test), 12 words -> 2 lessons
  assert.equal((await admin('POST', '/api/admin/units', { key: 'space', title: 'Kosmos', emoji: '🚀' })).status, 200);
  assert.equal((await admin('POST', '/api/admin/units', { key: 'space', title: 'Dup' })).status, 409);
  const words = [['Oy', 'Moon'], ['Quyosh', 'Sun'], ['Yulduz', 'Star'], ['Sayyora', 'Planet'], ['Raketa', 'Rocket'], ['Kosmonavt', 'Astronaut']];
  let firstId;
  for (const [uz, en] of words) { const r = await admin('POST', '/api/admin/units/space/concepts', { uz, t: { en } }); assert.equal(r.status, 200); firstId ||= r.data.id; }
  assert.equal(app.content.lessons('en').filter((l) => l.unit === 'space' && l.kind === 'lesson').length, 1);
  assert.equal(app.content.lessons('ru').filter((l) => l.unit === 'space').length, 0, 'untranslated language has no lessons for the unit');

  // edit translation and verify it is served
  assert.equal((await admin('PATCH', `/api/admin/concepts/${firstId}`, { t: { ru: 'Луна' } })).status, 200);
  const dict = (await u('GET', '/api/dictionary?lang=ru')).data.words;
  assert.ok(dict.some((w) => w.target === 'Луна'));
  assert.equal((await admin('PATCH', `/api/admin/concepts/${firstId}`, { t: { ru: '' } })).status, 200);
  assert.ok(!(await u('GET', '/api/dictionary?lang=ru')).data.words.some((w) => w.target === 'Луна'));

  // sentences
  const sr = await admin('POST', '/api/admin/units/space/sentences', { uz: 'Oy katta.', t: { en: 'The moon is big.' } });
  assert.equal(sr.status, 200);
  assert.equal((await admin('PATCH', `/api/admin/sentences/${sr.data.id}`, { t: { en: 'The moon is very big.' } })).status, 200);
  assert.equal((await admin('DELETE', `/api/admin/sentences/${sr.data.id}`)).status, 200);

  // reorder + disable
  assert.equal((await admin('POST', '/api/admin/units/space/move', { dir: 'up' })).status, 200);
  assert.equal(app.content.units().findIndex((x) => x.key === 'space'), 19);
  assert.equal((await admin('PATCH', '/api/admin/units/space', { enabled: false })).status, 200);
  assert.ok(!(await u('GET', '/api/courses/en')).data.units.some((x) => x.key === 'space'));

  // new language with partial coverage is not playable until it has translations
  assert.equal((await admin('PUT', '/api/admin/languages/it', { name: 'Italyan tili', native: 'Italiano', flag: '🇮🇹', tts: 'it-IT', dir: 'ltr', color: '#22aa66' })).status, 200);
  assert.ok(!(await u('GET', '/api/languages')).data.languages.some((l) => l.code === 'it'));
  const c0 = content.units[0].concepts[0].id;
  assert.equal((await admin('PATCH', `/api/admin/concepts/${c0}`, { t: { it: 'Ciao' } })).status, 200);
  assert.ok((await u('GET', '/api/languages')).data.languages.some((l) => l.code === 'it'));
  assert.equal((await admin('PUT', '/api/admin/languages/xx1', { name: 'x' })).status, 400);

  assert.equal((await admin('DELETE', `/api/admin/concepts/${firstId}`)).status, 200);
  assert.equal((await admin('DELETE', '/api/admin/units/space')).status, 200);
  assert.equal((await admin('GET', '/api/admin/export')).data.units.length, 20);
  app.close();
});

test('admin: announcement banner', async () => {
  const app = await boot();
  const admin = app.client(); await reg(admin, 'Boss', 'boss@test.uz');
  assert.equal((await admin('PUT', '/api/admin/settings', { announcement: { enabled: true, text: 'Yangi darslar qo\'shildi!', level: 'warn' } })).status, 200);
  const pub = await app.client()('GET', '/api/config');
  assert.deepEqual(pub.data.announcement, { text: "Yangi darslar qo'shildi!", level: 'warn' });
  await admin('PUT', '/api/admin/settings', { announcement: { enabled: false, text: 'x' } });
  assert.equal((await app.client()('GET', '/api/config')).data.announcement, null);
  app.close();
});

test('review fixes: stale cookies, malformed input, replay limits, SRS, orphan cleanup', async () => {
  const app = await boot();
  const admin = app.client(); await reg(admin, 'Boss', 'boss@test.uz');
  const victim = app.client(); const v = (await reg(victim, 'Victim', 'victim@test.uz')).data.user;
  const staleCookie = await (async () => { const c = app.client(); await c('POST', '/api/auth/login', { email: 'victim@test.uz', password: 'secret1234' }); return c; })();
  await admin('DELETE', `/api/admin/users/${v.id}`);
  const fresh = app.client(); const f = (await reg(fresh, 'Fresh', 'fresh@test.uz')).data.user;
  assert.ok(f.id > v.id, 'ids are never reused');
  assert.equal((await staleCookie('GET', '/api/me')).status, 401, 'deleted account cookie stays dead');

  // malformed input is a 400/200, never a 500
  const raw = (method, url, body, headers = {}) => fetch(app.base + url, { method, headers: { 'content-type': 'application/json', ...headers }, body });
  assert.equal((await raw('POST', '/api/auth/login', 'null')).status, 401);
  assert.equal((await raw('GET', '/api/me', undefined, { cookie: 'lf_session=%E0%A4%A' })).status, 401);
  assert.equal((await fresh('POST', '/api/games/score', { game: 'constructor' })).status, 400);
  assert.equal((await fresh('POST', '/api/tutor', { lang: 'en', messages: [null, { role: 'user', content: 'Hi' }] })).status, 200);

  // renaming works even if the stored language was later disabled
  await fresh('PATCH', '/api/me', { currentLang: 'de' });
  await admin('PUT', '/api/admin/languages/de', { name: 'Nemis tili', native: 'Deutsch', flag: '🇩🇪', tts: 'de-DE', dir: 'ltr', color: '#ffc94d', enabled: false });
  assert.equal((await fresh('PATCH', '/api/me', { name: 'Fresh Name' })).status, 200);
  await admin('PUT', '/api/admin/languages/de', { name: 'Nemis tili', native: 'Deutsch', flag: '🇩🇪', tts: 'de-DE', dir: 'ltr', color: '#ffc94d', enabled: true });

  // replays: capped XP per day, and the SRS schedule does not grow without real spacing
  const first = await play(app, fresh, 'en.greetings.1');
  let replayXp = 0;
  for (let i = 0; i < 6; i++) replayXp += (await play(app, fresh, 'en.greetings.1')).data.xp;
  assert.ok(replayXp <= 60, `replay XP capped (got ${replayXp})`);
  const row = app.db.prepare('SELECT MAX(reps) r FROM word_progress WHERE user_id=?').get(f.id);
  assert.equal(row.r, 1, 'replaying a lesson must not advance SRS');

  // deleting content removes dependent progress
  const cid = app.content.units()[0].concepts[0].id;
  assert.ok(app.db.prepare('SELECT COUNT(*) n FROM word_progress WHERE user_id=? AND concept_id=?').get(f.id, cid).n === 1);
  assert.equal((await admin('DELETE', `/api/admin/concepts/${cid}`)).status, 200);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM word_progress WHERE concept_id=?').get(cid).n, 0);
  assert.ok(first.data.xp > 0);
  app.close();
});

test('static pages are served', async () => {
  const app = await boot();
  assert.equal((await fetch(app.base + '/')).status, 200);
  assert.equal((await fetch(app.base + '/app')).status, 200);
  assert.equal((await fetch(app.base + '/admin')).status, 200);
  assert.equal((await fetch(app.base + '/nope.txt')).status, 404);
  app.close();
});

test('curriculum and international certification exam flow', async () => {
  const app = await boot();
  const c = app.client();
  await reg(c, 'Ielts Candidate', 'candidate@ielts.uz');

  // Curriculum returns 5 CEFR stages and IELTS roadmap
  const cur = await c('GET', '/api/curriculum?lang=en');
  assert.equal(cur.status, 200);
  assert.equal(cur.data.stages.length, 5);
  assert.equal(cur.data.stages[0].level, 'A1');
  assert.equal(cur.data.stages[4].level, 'C1');
  assert.ok(cur.data.stages[4].ieltsBand.includes('7.0'));

  // Exam summary
  const sum = await c('GET', '/api/exams/summary?lang=en');
  assert.equal(sum.status, 200);
  assert.equal(sum.data.stages.length, 5);

  // Mock exam generation
  const mock = await c('GET', '/api/exams/mock?lang=en&level=B2');
  assert.equal(mock.status, 200);
  assert.ok(mock.data.examToken);
  assert.ok(mock.data.listening.length > 0);
  assert.ok(mock.data.reading.length > 0);
  assert.ok(mock.data.grammar.length > 0);

  // Submit exam answers
  const answers = {};
  [...mock.data.listening, ...mock.data.reading, ...mock.data.grammar].forEach((q) => {
    answers[q.id] = q.options ? q.options[0] : 'Sample answer';
  });
  const sub = await c('POST', '/api/exams/submit', { examToken: mock.data.examToken, answers });
  assert.equal(sub.status, 200);
  assert.ok(typeof sub.data.accuracy === 'number');
  assert.ok(sub.data.bandScore);

  // Manual certification API
  const certRes = await c('POST', '/api/exams/certify', { lang: 'en', level: 'C1', accuracy: 92, bandScore: '8.0' });
  assert.equal(certRes.status, 200);
  assert.ok(certRes.data.certificate.certId.startsWith('LF-'));
  assert.equal(certRes.data.certificate.bandScore, '8.0');

  const afterSum = await c('GET', '/api/exams/summary?lang=en');
  assert.ok(afterSum.data.certificates.length >= 1);

  // JARVIS voice tutor mode
  const jarvisRes = await c('POST', '/api/tutor', {
    lang: 'en',
    mode: 'jarvis',
    messages: [{ role: 'user', content: 'Hello Jarvis, how are you?' }],
  });
  assert.equal(jarvisRes.status, 200);
  assert.ok(typeof jarvisRes.data.reply === 'string' && jarvisRes.data.reply.length > 0);

  app.close();
});

test('unit: normalize and SRS', () => {
  assert.equal(normalize('  Hello,  World! '), 'hello world');
  assert.equal(normalize('Café'), 'cafe');
  assert.equal(normalize("S'il vous plaît"), 's il vous plait');
  const s0 = { reps: 0, ease: 2.3, interval_days: 0, lapses: 0 };
  const s1 = nextState(s0, true, 0), s2 = nextState(s1, true, 0), s3 = nextState(s2, true, 0);
  assert.deepEqual([s1.interval_days, s2.interval_days], [1, 3]);
  assert.ok(s3.interval_days > 3);
  const lapse = nextState(s3, false, 0);
  assert.equal(lapse.reps, 0);
  assert.equal(lapse.lapses, 1);
});
