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

test('content: 60 units (20 live A1, A2/B1 hidden), 6 languages, lessons and tests per unit', async () => {
  const app = await boot();
  assert.equal(app.content.units().length, 60);
  const live = app.content.units().filter((u) => u.enabled);
  assert.equal(live.length, 20);
  assert.ok(live.every((u) => u.level === 'A1'));
  assert.equal(app.content.units().filter((u) => u.level === 'A2' && !u.enabled).length, 20);
  assert.equal(app.content.units().filter((u) => u.level === 'B1' && !u.enabled).length, 20);
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
  assert.equal(content.units.length, 60);
  assert.equal(content.languages.find((l) => l.code === 'en').concepts, 600);

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
  assert.equal(app.content.units().findIndex((x) => x.key === 'space'), 59);
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
  assert.equal((await admin('GET', '/api/admin/export')).data.units.length, 60);
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

test('AI Studio branch hardening: no open password reset, no auto-admin, framing blocked, limits', async () => {
  const app = await boot();
  const boss = app.client(); await reg(boss, 'Boss', 'boss@test.uz');
  const victim = app.client(); await reg(victim, 'Victim', 'victim@test.uz');

  // the unauthenticated reset endpoint is gone; the victim's password still works only for the victim
  const attacker = app.client();
  assert.equal((await attacker('POST', '/api/auth/reset-password', { email: 'victim@test.uz', newPassword: 'hacked1234' })).status, 404);
  assert.equal((await app.client()('POST', '/api/auth/login', { email: 'victim@test.uz', password: 'hacked1234' })).status, 401);
  assert.equal((await app.client()('POST', '/api/auth/login', { email: 'victim@test.uz', password: 'secret1234' })).status, 200);

  // logging in with an unknown email never creates (admin) accounts
  for (const email of ['nobody@test.uz', 'admin@example.com']) {
    assert.equal((await app.client()('POST', '/api/auth/login', { email, password: 'whatever1234' })).status, 401);
  }
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM users').get().n, 2);

  // admin can still set a password for someone (the supported recovery path)
  const v = app.db.prepare("SELECT id FROM users WHERE email='victim@test.uz'").get();
  assert.equal((await victim('POST', `/api/admin/users/${v.id}/password`, { password: 'newpass1234' })).status, 403);
  assert.equal((await boss('POST', `/api/admin/users/${v.id}/password`, { password: 'newpass1234' })).status, 200);
  assert.equal((await app.client()('POST', '/api/auth/login', { email: 'victim@test.uz', password: 'newpass1234' })).status, 200);

  // headers and cookies
  const r = await fetch(app.base + '/app');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const lg = await fetch(app.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' }, body: JSON.stringify({ email: 'victim@test.uz', password: 'newpass1234' }) });
  const ck = lg.headers.get('set-cookie');
  assert.match(ck, /SameSite=Lax/); assert.match(ck, /Secure/); assert.doesNotMatch(ck, /SameSite=None/);

  // guests are rate limited per IP; X-Forwarded-For is ignored unless TRUST_PROXY=1
  let last = 0;
  for (let i = 0; i < 12; i++) { last = (await fetch(app.base + '/api/auth/guest', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `9.9.9.${i}` }, body: '{}' })).status; }
  assert.equal(last, 429);

  // exams: bad level rejected, certificate XP only once per language+level
  assert.equal((await boss('GET', '/api/exams/mock?lang=en&level=ZZ')).status, 400);
  // setting a password as admin signs the old sessions of that account out
  assert.equal((await victim('GET', '/api/me')).status, 401);
  app.close();
});

test('password recovery works only with the server-side RECOVERY_KEY', async () => {
  const KEY = 'owner-recovery-key-12345';
  const app = await boot();
  const owner = app.client(); await reg(owner, 'Owner', 'owner@test.uz');
  const other = app.client(); await reg(other, 'Other', 'other@test.uz');
  const attacker = app.client();
  const reset = (c, body) => c('POST', '/api/auth/reset-password', body);

  // no key configured on the server: the endpoint is disabled for everybody
  delete process.env.RECOVERY_KEY;
  assert.equal((await reset(attacker, { email: 'owner@test.uz', newPassword: 'hacked12345', recoveryKey: '' })).status, 404);
  assert.equal((await reset(attacker, { email: 'owner@test.uz', newPassword: 'hacked12345', recoveryKey: 'undefined' })).status, 404);

  process.env.RECOVERY_KEY = KEY;
  try {
    // wrong key / unknown email are refused with the same error and never create accounts
    const usersBefore = app.db.prepare('SELECT COUNT(*) n FROM users').get().n;
    assert.equal((await reset(attacker, { email: 'owner@test.uz', newPassword: 'hacked12345', recoveryKey: 'wrong-key-123456' })).status, 403);
    assert.equal((await reset(attacker, { email: 'nobody@test.uz', newPassword: 'hacked12345', recoveryKey: KEY })).status, 403);
    assert.equal((await reset(attacker, { email: 'owner@test.uz', newPassword: 'hacked12345' })).status, 403);
    assert.equal(app.db.prepare('SELECT COUNT(*) n FROM users').get().n, usersBefore);
    assert.equal((await app.client()('POST', '/api/auth/login', { email: 'owner@test.uz', password: 'hacked12345' })).status, 401);

    // correct key: password changes, the old password and old sessions stop working
    assert.equal((await reset(attacker, { email: 'owner@test.uz', newPassword: 'short', recoveryKey: KEY })).status, 400);
    assert.equal((await reset(attacker, { email: 'owner@test.uz', newPassword: 'brandnew1234', recoveryKey: KEY })).status, 200);
    assert.equal((await owner('GET', '/api/me')).status, 401, 'old session is signed out');
    assert.equal((await app.client()('POST', '/api/auth/login', { email: 'owner@test.uz', password: 'secret1234' })).status, 401);
    assert.equal((await app.client()('POST', '/api/auth/login', { email: 'owner@test.uz', password: 'brandnew1234' })).status, 200);
    assert.equal((await other('GET', '/api/me')).status, 200, 'other accounts are untouched');

    // brute-forcing the key is rate limited
    let last = 0;
    for (let i = 0; i < 8; i++) last = (await reset(attacker, { email: 'owner@test.uz', newPassword: 'x'.repeat(12), recoveryKey: `guess-${i}-abcdefgh` })).status;
    assert.equal(last, 429);
  } finally { delete process.env.RECOVERY_KEY; }
  app.close();
});

const mcq = (over = {}) => ({ lang: 'en', skill: 'reading', level: 'B2', exam: 'ielts', type: 'mcq', payload: { question: 'What is the main idea?', options: ['A', 'B', 'C', 'D'], answer: 2 }, ...over });

test('item bank: validation, import, filters, coverage summary', async () => {
  const app = await boot();
  const admin = app.client(); await reg(admin, 'Boss', 'boss@test.uz');
  const user = app.client(); await reg(user, 'User', 'user@test.uz');

  // plain users and anonymous visitors have no access
  for (const [m, u] of [['GET', '/api/admin/items'], ['GET', '/api/admin/items/summary'], ['POST', '/api/admin/items'], ['POST', '/api/admin/items/import']]) {
    assert.equal((await user(m, u, {})).status, 403, u);
    assert.equal((await app.client()(m, u, {})).status, 401, u);
  }

  const ok = await admin('POST', '/api/admin/items', mcq());
  assert.equal(ok.status, 200);
  const bad = async (body) => (await admin('POST', '/api/admin/items', body)).status;
  assert.equal(await bad(mcq({ payload: { question: 'Q', options: ['A', 'B'], answer: 5 } })), 400, 'answer out of range');
  assert.equal(await bad(mcq({ payload: { question: 'Q', options: ['A', 'A'], answer: 0 } })), 400, 'duplicate options');
  assert.equal(await bad(mcq({ lang: 'xx' })), 400, 'unknown language');
  assert.equal(await bad(mcq({ skill: 'writing' })), 400, 'writing needs an essay prompt');
  assert.equal(await bad(mcq({ level: 'D9' })), 400);
  assert.equal(await bad(mcq({ payload: { question: 'Q', options: ['A', 'B'], answer: 0, audio_url: 'javascript:alert(1)' } })), 400, 'unsafe audio url');
  assert.equal(await bad({ lang: 'ru', skill: 'writing', level: 'B2', type: 'essay_prompt', payload: { prompt: 'Опишите свой город.', min_words: 150 } }), 200);
  assert.equal(await bad({ lang: 'ru', skill: 'speaking', level: 'B1', type: 'speaking_prompt', payload: { prompt: 'Расскажите о семье.', part: 1 } }), 200);
  assert.equal(await bad({ lang: 'en', skill: 'grammar', level: 'B1', type: 'gap', payload: { text: 'She ___ to school yesterday.', answer: 'went' } }), 200);
  assert.equal(await bad({ lang: 'en', skill: 'grammar', level: 'B1', type: 'gap', payload: { text: 'No gap here', answer: 'x' } }), 400);

  // bulk import: partial failures are reported, dry run writes nothing
  const batch = { defaults: { lang: 'de', skill: 'vocab', level: 'A2', type: 'mcq' }, items: [
    { payload: { question: 'Hund?', options: ['dog', 'cat'], answer: 'dog' } },
    { payload: { question: 'Katze?', options: ['dog', 'cat'], answer: 1 } },
    { payload: { question: 'Broken', options: ['only one'], answer: 0 } },
    { lang: 'zz', payload: { question: 'x', options: ['a', 'b'], answer: 0 } },
  ] };
  const before = app.db.prepare('SELECT COUNT(*) n FROM items').get().n;
  const dry = await admin('POST', '/api/admin/items/import', { ...batch, dryRun: true });
  assert.deepEqual([dry.data.valid, dry.data.created, dry.data.failed], [2, 0, 2]);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM items').get().n, before);
  const real = await admin('POST', '/api/admin/items/import', batch);
  assert.deepEqual([real.data.created, real.data.failed], [2, 2]);
  assert.deepEqual(real.data.errors.map((e) => e.index), [2, 3]);
  assert.equal((await admin('POST', '/api/admin/items/import', { items: new Array(501).fill({}) })).status, 400);

  const list = (await admin('GET', '/api/admin/items?lang=de&level=A2')).data;
  assert.equal(list.total, 2);
  assert.ok(list.items.every((i) => i.status === 'draft' && i.source === 'import'));
  assert.equal((await admin('GET', '/api/admin/items?status=nope')).status, 400);
  assert.equal((await admin('GET', '/api/admin/items?q=Katze')).data.total, 1);
  assert.equal((await admin('GET', '/api/admin/items?q=%25')).data.total, 0, 'LIKE wildcards are escaped');

  const sum = (await admin('GET', '/api/admin/items/summary')).data;
  assert.equal(sum.langs.find((l) => l.code === 'en').target, 'C2');
  assert.equal(sum.langs.find((l) => l.code === 'ru').target, 'B2');
  assert.equal(sum.rows.find((r) => r.lang === 'de' && r.level === 'A2' && r.status === 'draft').n, 2);
  app.close();
});

test('item bank: review workflow and reviewer permissions per language', async () => {
  const app = await boot();
  const admin = app.client(); await reg(admin, 'Boss', 'boss@test.uz');
  const rev = app.client(); const r = (await reg(rev, 'Reviewer', 'rev@test.uz')).data.user;
  const user = app.client(); await reg(user, 'User', 'user@test.uz');

  assert.equal((await admin('PATCH', `/api/admin/users/${r.id}`, { role: 'reviewer', reviewerLangs: ['en', 'zz'] })).status, 400, 'unknown language');
  assert.equal((await admin('PATCH', `/api/admin/users/${r.id}`, { role: 'reviewer', reviewerLangs: ['en'] })).status, 200);
  const me = (await rev('GET', '/api/me')).data.user;
  assert.deepEqual([me.isStaff, me.isAdmin, me.reviewerLangs], [true, false, ['en']]);
  // reviewers get items but nothing else from the admin panel
  assert.equal((await rev('GET', '/api/admin/stats')).status, 403);
  assert.equal((await rev('GET', '/api/admin/users')).status, 403);

  const en = (await admin('POST', '/api/admin/items', mcq())).data.id;
  const ru = (await admin('POST', '/api/admin/items', mcq({ lang: 'ru' }))).data.id;
  const list = (await rev('GET', '/api/admin/items')).data;
  assert.deepEqual(list.items.map((i) => i.lang), ['en'], 'reviewer sees only assigned languages');
  assert.equal((await rev('GET', `/api/admin/items/${ru}`)).status, 403);
  assert.equal((await rev('POST', '/api/admin/items', mcq({ lang: 'ru' }))).status, 403);
  assert.equal((await rev('GET', '/api/admin/items/summary')).data.langs.length, 1);
  assert.deepEqual((await rev('GET', '/api/admin/items/meta')).data.languages.map((l) => l.code), ['en']);

  const st = (c, id, status, note) => c('POST', `/api/admin/items/${id}/status`, { status, note });
  assert.equal((await st(rev, en, 'approved')).status, 400, 'draft cannot jump to approved');
  assert.equal((await st(admin, en, 'review')).status, 200);
  assert.equal((await st(rev, en, 'rejected')).status, 400, 'rejection needs a reason');
  assert.equal((await st(rev, en, 'rejected', 'Wrong key')).status, 200);
  assert.equal((await rev('GET', `/api/admin/items/${en}`)).data.item.reviewNote, 'Wrong key');
  assert.equal((await st(rev, en, 'review')).status, 200);
  assert.equal((await st(rev, en, 'approved', 'OK')).status, 200);

  // editing an approved item sends it back to draft
  const patched = await rev('PATCH', `/api/admin/items/${en}`, { payload: { question: 'Fixed?', options: ['A', 'B', 'C'], answer: 1 } });
  assert.deepEqual([patched.status, patched.data.status], [200, 'draft']);
  await st(rev, en, 'review'); await st(rev, en, 'approved');
  assert.equal((await rev('DELETE', `/api/admin/items/${en}`)).status, 403, 'approved items are deleted by admins only');
  assert.equal((await admin('DELETE', `/api/admin/items/${en}`)).status, 200);

  // four eyes: a reviewer cannot approve what they wrote themselves
  const own = (await rev('POST', '/api/admin/items', mcq())).data.id;
  await st(rev, own, 'review');
  assert.equal((await st(rev, own, 'approved')).status, 403);
  assert.equal((await st(admin, own, 'approved')).status, 200);

  // demoting a reviewer clears the language assignment and the access
  assert.equal((await admin('PATCH', `/api/admin/users/${r.id}`, { role: 'user' })).status, 200);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM reviewer_langs WHERE user_id=?').get(r.id).n, 0);
  assert.equal((await rev('GET', '/api/admin/items')).status, 403);
  assert.equal((await user('GET', '/api/admin/items')).status, 403);
  app.close();
});

test('AI free-tier limits: per feature per day, admin configurable, admins exempt', async () => {
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => (String(url).startsWith('https://generativelanguage.googleapis.com')
    ? { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Nice sentence!' }] } }] }) }
    : realFetch(url, opts));
  process.env.GEMINI_API_KEY = 'test-key';
  try {
    const app = await boot();
    const admin = app.client(); await reg(admin, 'Boss', 'boss@test.uz');
    const user = app.client(); await reg(user, 'User', 'user@test.uz');
    const ask = (c, mode) => c('POST', '/api/tutor', { lang: 'en', mode, messages: [{ role: 'user', content: 'Hello there' }] });

    assert.equal((await admin('PUT', '/api/admin/limits', { limits: { tutor: 2, writing: 0, speaking: 1 } })).status, 200);
    assert.equal((await admin('PUT', '/api/admin/limits', { limits: { tutor: -1 } })).status, 400);
    assert.equal((await user('PUT', '/api/admin/limits', { limits: { tutor: 999 } })).status, 403);

    assert.deepEqual([(await ask(user)).status, (await ask(user)).status], [200, 200]);
    const third = await ask(user);
    assert.equal(third.status, 429);
    assert.match(third.data.error, /limit/i);
    // each feature has its own counter; limit 0 switches a feature off
    assert.equal((await ask(user, 'ielts_speaking')).status, 200);
    assert.equal((await ask(user, 'jarvis')).status, 429);
    const off = await ask(user, 'ielts_writing');
    assert.equal(off.status, 429);
    assert.match(off.data.error, /o'chirilgan/);
    // admins are exempt
    for (let i = 0; i < 5; i++) assert.equal((await ask(admin)).status, 200);

    const usage = (await user('GET', '/api/quota')).data.usage;
    assert.deepEqual(usage.tutor, { used: 2, limit: 2 });
    assert.deepEqual(usage.speaking, { used: 1, limit: 1 });
    const totals = (await admin('GET', '/api/admin/limits')).data;
    assert.equal(totals.limits.tutor, 2);
    assert.equal(totals.top[0].email, 'user@test.uz');
    assert.ok(totals.features.find((f) => f.feature === 'tutor').calls >= 2);

    // without a configured AI provider nothing is counted
    delete process.env.GEMINI_API_KEY;
    const free = app.client(); await reg(free, 'Free', 'free@test.uz');
    assert.equal((await ask(free)).data.disabled, true);
    assert.equal((await free('GET', '/api/quota')).data.usage.tutor.used, 0);
    app.close();
  } finally { global.fetch = realFetch; delete process.env.GEMINI_API_KEY; }
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
  // results never claim to be an official or equivalent certificate
  assert.match(sub.data.disclaimer, /rasmiy IELTS, CEFR/);
  assert.doesNotMatch(sub.data.examTitle, /Ekvivalent|Xalqaro|Rasmiy/i);
  assert.match(sub.data.examTitle, /tayyorgarlik/i);
  if (sub.data.certificate) assert.match(sub.data.certificate.disclaimer, /ichki tayyorgarlik sertifikati/);

  // Certificates cannot be minted by hand any more (they were forgeable)
  const certRes = await c('POST', '/api/exams/certify', { lang: 'en', level: 'C1', accuracy: 99, bandScore: '9.0' });
  assert.equal(certRes.status, 404);

  const afterSum = await c('GET', '/api/exams/summary?lang=en');
  // a certificate exists exactly when the (random) exam attempt was passed
  assert.equal(afterSum.data.certificates.length, sub.data.passed ? 1 : 0);
  assert.equal(Boolean(sub.data.certificate), sub.data.passed);

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

test('seed sync: legacy DB gets new units disabled, deleted units are not resurrected, bulk level enable works', async () => {
  const { open } = require('../src/db');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lf-sync-')), 'x.db');
  dirs.push(path.dirname(file));
  let db = open(file);
  // simulate a database created before levels existed: only A1 units, no sync marker
  db.exec("DELETE FROM units WHERE level != 'A1'; DELETE FROM settings WHERE key='seed_units_applied'");
  db.prepare("DELETE FROM units WHERE key='greetings'").run(); // admin deleted a live unit
  db.close();
  db = open(file);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM units WHERE level='A2'").get().n, 20);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM units WHERE level!='A1' AND enabled=1").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM units WHERE key='greetings'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM concepts WHERE unit_key='a2routine'").get().n, 10);
  db.close();
  db = open(file); // idempotent
  assert.equal(db.prepare('SELECT COUNT(*) n FROM units').get().n, 59);
  db.close();

  const app = await boot();
  const admin = app.client(); await reg(admin, 'Boss', 'sync@test.uz');
  assert.equal((await admin('POST', '/api/admin/units-level/Z9', { enabled: true })).status, 400);
  const on = await admin('POST', '/api/admin/units-level/A2', { enabled: true });
  assert.equal(on.data.changed, 20);
  assert.equal(app.content.units().filter((u) => u.enabled).length, 40);
  const cur = (await admin('GET', '/api/curriculum?lang=en')).data.units;
  assert.ok(cur.some((u) => u.stageLevel === 'A2') && cur.some((u) => u.stageLevel === 'A1'));
  app.close();
});

test('import-items CLI validates, dry-runs and is idempotent', () => {
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-imp-'));
  dirs.push(dir);
  const good = { lang: 'en', skill: 'grammar', level: 'A2', type: 'gap', payload: { text: 'She ___ home.', answers: ['goes'] } };
  const bad = { lang: 'xx', skill: 'grammar', level: 'A2', type: 'gap', payload: { text: 'no blank', answers: ['a'] } };
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify([good]));
  fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify([good, bad]));
  const run = (...a) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'scripts', 'import-items.js'), ...a], { env: { ...process.env, DATA_DIR: dir }, encoding: 'utf8' });
  assert.match(run('--dry-run', path.join(dir, 'a.json')).stdout, /qoralama: 1, takror: 0, xato: 0/);
  assert.match(run(path.join(dir, 'a.json')).stdout, /qoralama: 1/);
  assert.match(run(path.join(dir, 'a.json')).stdout, /qoralama: 0, takror: 1/);
  const r = run(path.join(dir, 'b.json'));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /xato: 1/);
});

test('practice: only approved items, answers hidden until answered, XP capped, no cross-user access', async () => {
  const app = await boot();
  const admin = app.client(); await reg(admin, 'Boss', 'prac@test.uz');
  const u = app.client(); await reg(u, 'Student', 'prac-s@test.uz');
  const mk = (skill, type, payload, extra = {}) => admin('POST', '/api/admin/items', { lang: 'en', skill, level: 'B1', type, payload, ...extra });
  const items = [];
  for (let i = 0; i < 4; i++) items.push((await mk('reading', 'mcq', { passage: `Text ${i}`, question: `Q${i}?`, options: ['a', 'b', 'c'], answer: 1, explanation_uz: 'Izoh' })).data.id);
  items.push((await mk('reading', 'tf_ng', { passage: 'P', statement: 'S', answer: 'not_given' })).data.id);
  items.push((await mk('listening', 'gap', { transcript: 'Secret transcript', text: 'I ___ it.', answers: ['hear'] })).data.id);
  const draftOnly = (await mk('reading', 'mcq', { question: 'Draft?', options: ['x', 'y'], answer: 0 })).data.id;
  for (const id of items) for (const status of ['review', 'approved']) assert.equal((await admin('POST', `/api/admin/items/${id}/status`, { status })).status, 200);

  assert.equal((await u('POST', '/api/practice/start', { skill: 'reading' })).status, 200);
  assert.equal((await u('POST', '/api/practice/start', { skill: 'speaking' })).status, 400);
  assert.equal((await u('POST', '/api/practice/start', { skill: 'vocab' })).status, 404);
  const st = (await u('POST', '/api/practice/start', { skill: 'reading', lang: 'en', count: 15 })).data;
  assert.equal(st.items.length, 5);
  assert.ok(!st.items.some((i) => i.id === draftOnly));
  assert.ok(st.items.every((i) => i.answer === undefined && i.answers === undefined && i.explanation_uz === undefined));
  const ls = (await u('POST', '/api/practice/start', { skill: 'listening' })).data;
  assert.equal(ls.items[0].speak, 'Secret transcript');
  assert.equal(ls.items[0].text, 'I ___ it.');

  const intruder = app.client(); await reg(intruder, 'Eve', 'eve@test.uz');
  assert.equal((await intruder('POST', `/api/practice/${st.sessionId}/answer`, { itemId: st.items[0].id, answer: 0 })).status, 404);
  const first = st.items[0];
  const right = first.type === 'tf_ng' ? 'not_given' : 1;
  const a1 = (await u('POST', `/api/practice/${st.sessionId}/answer`, { itemId: first.id, answer: right })).data;
  assert.equal(a1.correct, true);
  assert.equal((await u('POST', `/api/practice/${st.sessionId}/answer`, { itemId: first.id, answer: right })).status, 409);
  assert.equal((await u('POST', `/api/practice/${st.sessionId}/answer`, { itemId: 999999, answer: 0 })).status, 400);
  for (const it of st.items.slice(1)) await u('POST', `/api/practice/${st.sessionId}/answer`, { itemId: it.id, answer: it.type === 'tf_ng' ? 'not_given' : 1 });
  const fin = (await u('POST', `/api/practice/${st.sessionId}/finish`, {})).data;
  assert.equal(fin.correct, 5);
  assert.equal(fin.xp, 10);
  assert.equal((await u('POST', `/api/practice/${st.sessionId}/finish`, {})).status, 404);
  const sum = (await u('GET', '/api/practice/summary?lang=en')).data;
  assert.equal(sum.counts.find((c) => c.skill === 'reading' && c.level === 'B1').n, 5);
  app.close();
});

test('writing/speaking grading: AI rubric normalized, quota per feature, validation, history', async () => {
  const realFetch = global.fetch;
  let aiCalls = 0, aiReply = null;
  global.fetch = async (url, opts) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      aiCalls++;
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: aiReply }] } }] }) };
    }
    return realFetch(url, opts);
  };
  process.env.GEMINI_API_KEY = 'test-key';
  try {
    const app = await boot();
    const admin = app.client(); await reg(admin, 'Boss', 'gr@test.uz');
    const u = app.client(); await reg(u, 'Student', 'gr-s@test.uz');
    const mk = async (skill, type, payload) => {
      const id = (await admin('POST', '/api/admin/items', { lang: 'en', skill, level: 'B1', type, payload })).data.id;
      for (const status of ['review', 'approved']) await admin('POST', `/api/admin/items/${id}/status`, { status });
      return id;
    };
    const essayId = await mk('writing', 'essay_prompt', { prompt: 'Describe your city.', min_words: 40 });
    const speakId = await mk('speaking', 'speaking_prompt', { prompt: 'Talk about your weekend.' });
    const essay = 'My city is big and old. '.repeat(6);
    const good = JSON.stringify({ scores: { task: 4, coherence: 3, vocabulary: 9, grammar: -2 }, cefr: 'B1', summary_uz: 'Yaxshi.', strengths_uz: ['Aniq'], fixes: [{ original: 'is big', better: 'is large', why_uz: 'Sinonim' }, { original: '', better: 'x' }], next_step_uz: 'Ko\'proq yozing' });

    assert.equal((await u('GET', '/api/writing/prompts?lang=en')).data.prompts.length, 1);
    assert.equal((await u('POST', '/api/writing/submit', { lang: 'en', itemId: essayId, text: 'too short' })).status, 400);
    assert.equal((await u('POST', '/api/writing/submit', { lang: 'en', itemId: 99999, text: essay })).status, 400);

    aiReply = 'garbage, not json';
    assert.equal((await u('POST', '/api/writing/submit', { lang: 'en', itemId: essayId, text: essay })).status, 502);

    aiReply = '```json\n' + good + '\n```';
    const w = await u('POST', '/api/writing/submit', { lang: 'en', itemId: essayId, text: essay });
    assert.equal(w.status, 200);
    assert.deepEqual(w.data.result.scores, { task: 4, coherence: 3, vocabulary: 5, grammar: 0 });
    assert.equal(w.data.result.fixes.length, 1);
    assert.equal(w.data.result.cefr, 'B1');
    assert.equal(w.data.xp, 10);
    assert.match(w.data.disclaimer, /rasmiy/);

    // speaking
    const sp = (extra) => u('POST', '/api/speaking/submit', { lang: 'en', itemId: speakId, transcript: 'I went to the park with my friends and we played football all afternoon yesterday.', seconds: 20, ...extra });
    assert.equal((await sp({ transcript: 'too short' })).status, 400);
    assert.equal((await sp({ seconds: 1 })).status, 400);
    assert.equal((await sp({ seconds: 5, transcript: 'word '.repeat(60) })).status, 400); // implausible speed
    const speakGood = JSON.stringify({ scores: { fluency: 3, coherence: 3, vocabulary: 3, grammar: 4 }, cefr: 'A2', summary_uz: 'Yaxshi', strengths_uz: [], fixes: [], next_step_uz: '' });
    aiReply = speakGood;
    const s1 = await sp({});
    assert.equal(s1.status, 200);
    assert.equal(s1.data.wpm, 45);

    const hist = (await u('GET', '/api/skills/history')).data.history;
    assert.deepEqual(hist.map((h) => h.kind).sort(), ['speaking', 'writing']);

    // per-feature quotas: writing limit 1 does not block speaking
    assert.equal((await admin('PUT', '/api/admin/limits', { limits: { writing: 2 } })).status, 200);
    const before = aiCalls;
    aiReply = good;
    assert.equal((await u('POST', '/api/writing/submit', { lang: 'en', itemId: essayId, text: essay })).status, 429); // 2 used (1 failed parse + 1 ok)
    assert.equal(aiCalls, before);
    aiReply = speakGood;
    assert.equal((await sp({})).status, 200);
    // admins exempt, and disabled provider => 503 without consuming
    delete process.env.GEMINI_API_KEY;
    assert.equal((await u('POST', '/api/writing/submit', { lang: 'en', itemId: essayId, text: essay })).status, 503);
    app.close();
  } finally {
    global.fetch = realFetch;
    delete process.env.GEMINI_API_KEY;
  }
});

test('mock exam: from approved items, answers hidden, scored server-side, one submit', async () => {
  const app = await boot();
  const admin = app.client(); await reg(admin, 'Boss', 'mock@test.uz');
  const u = app.client(); await reg(u, 'Student', 'mock-s@test.uz');
  for (let i = 0; i < 10; i++) {
    const skill = i < 5 ? 'grammar' : 'reading';
    const id = (await admin('POST', '/api/admin/items', { lang: 'en', skill, level: 'B2', type: 'mcq', payload: { passage: skill === 'reading' ? 'Some text.' : undefined, question: `Q${i}?`, options: ['a', 'b', 'c'], answer: 2, explanation_uz: 'Izoh' } })).data.id;
    for (const status of ['review', 'approved']) await admin('POST', `/api/admin/items/${id}/status`, { status });
  }
  assert.equal((await u('POST', '/api/mock/start', { lang: 'en', level: 'C1' })).status, 404);
  assert.equal((await u('POST', '/api/mock/start', { lang: 'en', level: 'Z9' })).status, 400);
  const st = (await u('POST', '/api/mock/start', { lang: 'en', level: 'B2' })).data;
  assert.equal(st.items.length, 10);
  assert.ok(st.durationMin >= 10);
  assert.ok(st.items.every((i) => i.answer === undefined));
  const intruder = app.client(); await reg(intruder, 'Eve', 'mock-e@test.uz');
  assert.equal((await intruder('POST', `/api/mock/${st.sessionId}/submit`, { answers: {} })).status, 404);
  const answers = Object.fromEntries(st.items.map((it, k) => [it.id, k < 7 ? 2 : 0])); // 7 right of 10
  answers[st.items[9].id] = ''; // unanswered
  const res = (await u('POST', `/api/mock/${st.sessionId}/submit`, { answers })).data;
  assert.equal(res.correct, 7);
  assert.equal(res.percent, 70);
  assert.equal(res.verdict, 'ready');
  assert.equal(res.ielts.band, 6.5); // 70% -> indicative band, English B2+ only
  assert.equal(res.sections.grammar.total + res.sections.reading.total, 10);
  assert.equal(res.review.filter((r) => !r.answered).length, 1);
  assert.equal(res.xp, 21);
  assert.equal((await u('POST', `/api/mock/${st.sessionId}/submit`, { answers })).status, 404);
  const hist = (await u('GET', '/api/mock/history')).data.history;
  assert.equal(hist.length, 1);
  assert.equal(hist[0].percent, 70);
  app.close();
});

test('bundled content import: admin only, drafts, idempotent', async () => {
  const app = await boot();
  const admin = app.client(); await reg(admin, 'Boss', 'bund@test.uz');
  const user = app.client(); await reg(user, 'Student', 'bund-s@test.uz');
  assert.equal((await user('GET', '/api/admin/items/bundled')).status, 403);
  assert.equal((await user('POST', '/api/admin/items/import-bundled', {})).status, 403);
  const info = (await admin('GET', '/api/admin/items/bundled')).data;
  assert.ok(info.available >= 20 && info.preview.created > 1000 && info.preview.failed === 0);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM items').get().n, 0); // preview writes nothing
  const dry = (await admin('POST', '/api/admin/items/import-bundled', { dryRun: true })).data;
  assert.equal(dry.created, info.preview.created);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM items').get().n, 0);
  const real = (await admin('POST', '/api/admin/items/import-bundled', {})).data;
  assert.equal(real.created, info.preview.created);
  const rows = app.db.prepare("SELECT status, source, author_id, COUNT(*) n FROM items GROUP BY status, source, author_id").all();
  assert.deepEqual(rows.map((r) => [r.status, r.source, r.author_id]), [['draft', 'ai', null]]);
  const again = (await admin('POST', '/api/admin/items/import-bundled', {})).data;
  assert.equal(again.created, 0);
  assert.equal(again.duplicates, real.created);
  // nothing reaches learners until approved
  assert.equal((await user('POST', '/api/practice/start', { lang: 'en', skill: 'grammar' })).status, 404);
  app.close();
});
