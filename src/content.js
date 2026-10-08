'use strict';

const LESSON_SIZE = 5;
const MIN_TOKENS = 2;
const MAX_TOKENS = 9;

const tokensOf = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);
const parse = (s) => { try { return JSON.parse(s) || {}; } catch { return {}; } };

// In-memory view of the content tables. Call reload() after any admin edit.
function createContent(db) {
  let C;

  function reload() {
    const langs = db.prepare('SELECT * FROM languages ORDER BY position, code').all().map((l) => ({ ...l, enabled: !!l.enabled }));
    const units = db.prepare('SELECT * FROM units ORDER BY position, key').all().map((u) => ({ ...u, enabled: !!u.enabled, concepts: [], sentences: [] }));
    const unitByKey = new Map(units.map((u) => [u.key, u]));
    const concepts = new Map();
    for (const r of db.prepare('SELECT * FROM concepts ORDER BY unit_key, position, id').all()) {
      const u = unitByKey.get(r.unit_key);
      if (!u) continue;
      const c = { id: r.id, unit: r.unit_key, position: r.position, uz: r.uz, t: parse(r.t), tr: parse(r.tr) };
      u.concepts.push(c); concepts.set(c.id, c);
    }
    const sentences = new Map();
    for (const r of db.prepare('SELECT * FROM sentences ORDER BY unit_key, position, id').all()) {
      const u = unitByKey.get(r.unit_key);
      if (!u) continue;
      const s = { id: r.id, unit: r.unit_key, position: r.position, uz: r.uz, t: parse(r.t) };
      u.sentences.push(s); sentences.set(s.id, s);
    }
    C = { langs, units, unitByKey, concepts, sentences, lessonCache: new Map() };
  }
  reload();

  const langByCode = (code) => C.langs.find((l) => l.code === code);

  // Lessons of a unit for one language: chunks of 5 concepts that have a translation (a short tail is merged).
  function unitLessons(unit, lang) {
    const cs = unit.concepts.filter((c) => c.t[lang] && String(c.t[lang]).trim());
    if (!cs.length) return [];
    const chunks = [];
    for (let i = 0; i < cs.length; i += LESSON_SIZE) chunks.push(cs.slice(i, i + LESSON_SIZE));
    if (chunks.length > 1 && chunks[chunks.length - 1].length < 3) chunks[chunks.length - 2].push(...chunks.pop());
    const ss = unit.sentences.filter((s) => { const n = tokensOf(s.t[lang]).length; return n >= MIN_TOKENS && n <= MAX_TOKENS; });
    const perLesson = Math.ceil(ss.length / chunks.length) || 0;
    const lessons = chunks.map((ch, i) => ({
      id: `${lang}.${unit.key}.${i + 1}`, lang, unit: unit.key, index: i + 1, kind: 'lesson',
      title: `${unit.title} · ${i + 1}`, conceptIds: ch.map((c) => c.id),
      sentenceIds: ss.slice(i * perLesson, (i + 1) * perLesson).map((s) => s.id),
    }));
    lessons.push({
      id: `${lang}.${unit.key}.test`, lang, unit: unit.key, index: 0, kind: 'test', title: `${unit.title} · Test`,
      conceptIds: cs.map((c) => c.id), sentenceIds: ss.map((s) => s.id),
    });
    return lessons;
  }

  // Ordered list (lessons followed by the unit's test) over all enabled units.
  function lessons(lang) {
    if (!C.lessonCache.has(lang)) C.lessonCache.set(lang, C.units.filter((u) => u.enabled).flatMap((u) => unitLessons(u, lang)));
    return C.lessonCache.get(lang);
  }

  return {
    reload,
    lang: langByCode,
    langs: ({ all = false } = {}) => C.langs.filter((l) => (all || l.enabled) && (all || lessons(l.code).length > 0)),
    units: () => C.units,
    unit: (key) => C.unitByKey.get(key),
    concept: (id) => C.concepts.get(id),
    sentence: (id) => C.sentences.get(id),
    lessons,
    lesson: (id) => {
      const lang = String(id).split('.')[0];
      return lessons(lang).find((l) => l.id === id) || null;
    },
    unitsWithLessons: (lang) => C.units.filter((u) => u.enabled && unitLessons(u, lang).length),
    tokensOf,
  };
}

module.exports = { createContent, LESSON_SIZE, tokensOf };
