'use strict';
const crypto = require('node:crypto');
const { tokensOf } = require('./content');

const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const sample = (arr, n) => shuffle(arr).slice(0, n);

// Case, punctuation and accents are ignored when checking typed answers.
function normalize(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ًͯ-ٰٟ]/g, '')
    .toLowerCase()
    .replace(/[.,!?¡¿;:"'’`´«»()\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

let seq = 0;
const exId = () => `e${++seq}_${crypto.randomBytes(3).toString('hex')}`;

function builders(content, lang) {
  const L = content.lang(lang);
  const rtl = L.dir === 'rtl' ? 'rtl' : 'ltr';
  const target = (cid) => content.concept(cid).t[lang];
  const uz = (cid) => content.concept(cid).uz;
  const translit = (cid) => (content.concept(cid).tr || {})[lang] || null;

  // Wrong options come from the same unit first, then from anywhere else; text-deduplicated.
  function distractors(cid, count, pick) {
    const c = content.concept(cid);
    const has = (x) => x.t[lang];
    const same = content.unit(c.unit).concepts.filter((x) => x.id !== cid && has(x));
    const others = content.units().flatMap((u) => u.concepts).filter((x) => x.unit !== c.unit && has(x));
    const seen = new Set([pick(c)]);
    const out = [];
    for (const x of [...shuffle(same), ...shuffle(others)]) {
      const v = pick(x);
      if (seen.has(v)) continue;
      seen.add(v); out.push(v);
      if (out.length === count) break;
    }
    return out;
  }

  return {
    rtl, L,
    learn: (cids) => ({
      id: exId(), type: 'learn', lang, tts: L.tts, dir: rtl,
      items: cids.map((cid) => ({ cid, target: target(cid), uz: uz(cid), tr: translit(cid) })),
    }),
    mcqToUz: (cid) => ({
      id: exId(), type: 'mcq', cid, lang, dir: rtl, tts: L.tts, prompt: 'Bu nimani anglatadi?',
      word: target(cid), tr: translit(cid),
      options: shuffle([uz(cid), ...distractors(cid, 3, (c) => c.uz)]), answer: uz(cid),
    }),
    mcqToTarget: (cid) => ({
      id: exId(), type: 'mcq', cid, lang, dir: rtl, prompt: `Qaysi biri "${uz(cid)}" degani?`,
      options: shuffle([target(cid), ...distractors(cid, 3, (c) => c.t[lang])]), answer: target(cid),
    }),
    listen: (cid) => ({
      id: exId(), type: 'listen', cid, lang, tts: L.tts, speak: target(cid), prompt: "Eshiting va ma'nosini tanlang",
      options: shuffle([uz(cid), ...distractors(cid, 3, (c) => c.uz)]), answer: uz(cid),
    }),
    typing: (cid) => {
      const accept = [target(cid)];
      const tr = translit(cid);
      if (tr) accept.push(tr);
      return { id: exId(), type: 'type', cid, lang, dir: rtl, prompt: `Tarjima qiling: "${uz(cid)}"`, hint: tr ? 'Arab harflarida yoki lotin transliteratsiyasida yozing' : null, accept };
    },
    match: (cids) => {
      const pairs = cids.map((cid) => ({ cid, l: target(cid), r: uz(cid) }));
      return { id: exId(), type: 'match', lang, dir: rtl, tts: L.tts, prompt: 'Juftlarni toping', left: shuffle(pairs.map((p) => p.l)), right: shuffle(pairs.map((p) => p.r)), pairs };
    },
    order: (sid) => {
      const s = content.sentence(sid);
      const words = tokensOf(s.t[lang]);
      let tokens = shuffle(words);
      for (let i = 0; i < 6 && tokens.join(' ') === words.join(' '); i++) tokens = shuffle(words);
      return { id: exId(), type: 'order', sid, lang, dir: rtl, tts: L.tts, prompt: `Jumlani tuzing: "${s.uz}"`, tokens, answer: words };
    },
  };
}

function buildExercises(content, lesson, { withIntro = true } = {}) {
  const b = builders(content, lesson.lang);
  const cids = lesson.conceptIds;
  const ex = [];
  if (withIntro) ex.push(b.learn(cids));
  for (const cid of cids) ex.push(b.mcqToUz(cid));
  ex.push(b.match(cids));
  for (const cid of sample(cids, 3)) ex.push(b.listen(cid));
  for (const cid of shuffle(cids)) ex.push(b.mcqToTarget(cid));
  for (const cid of sample(cids, 4)) ex.push(b.typing(cid));
  for (const sid of sample(lesson.sentenceIds || [], 2)) ex.push(b.order(sid));
  return ex;
}

// Unit test: no intro, mixed types over the whole unit.
function buildTest(content, lesson) {
  const b = builders(content, lesson.lang);
  const cids = lesson.conceptIds;
  const mix = [
    ...sample(cids, 5).map(b.mcqToUz), ...sample(cids, 4).map(b.mcqToTarget), ...sample(cids, 2).map(b.listen),
    ...sample(cids, 4).map(b.typing), ...sample(lesson.sentenceIds || [], 2).map(b.order),
  ];
  return [...shuffle(mix), b.match(sample(cids, 5))];
}

// Placement: two questions from each of up to 10 evenly spaced units, in unit order.
function buildPlacement(content, lang) {
  const b = builders(content, lang);
  const units = content.unitsWithLessons(lang);
  const n = Math.min(10, units.length);
  const picked = n === units.length ? units : Array.from({ length: n }, (_, i) => units[Math.round((i * (units.length - 1)) / (n - 1))]);
  const ex = [];
  for (const u of picked) {
    const cs = sample(u.concepts.filter((c) => c.t[lang]).map((c) => c.id), 2);
    if (cs.length < 2) continue;
    ex.push({ ...b.mcqToUz(cs[0]), unit: u.key }, { ...b.mcqToTarget(cs[1]), unit: u.key });
  }
  return ex;
}

// Review: lighter mix, up to two exercises per due concept.
function buildReview(content, lang, cids) {
  const lesson = { lang, conceptIds: cids, sentenceIds: [] };
  const seen = new Map();
  const out = [];
  for (const e of buildExercises(content, lesson, { withIntro: false })) {
    if (e.type === 'match') continue;
    const n = seen.get(e.cid) || 0;
    if (n >= 2) continue;
    seen.set(e.cid, n + 1); out.push(e);
  }
  return shuffle(out);
}

const SECRET = ['answer', 'accept', 'pairs'];
function publicView(e) {
  const o = { ...e };
  for (const f of SECRET) delete o[f];
  if (e.type === 'type') o.length = e.accept[0].length;
  return o;
}

// Returns { correct, expected, cids: [{cid, ok}], detail? }
function check(e, answer) {
  switch (e.type) {
    case 'mcq':
    case 'listen': {
      const ok = String(answer) === e.answer;
      return { correct: ok, expected: e.answer, cids: [{ cid: e.cid, ok }] };
    }
    case 'type': {
      const given = normalize(answer);
      const ok = given.length > 0 && e.accept.some((a) => normalize(a) === given);
      return { correct: ok, expected: e.accept[0], cids: [{ cid: e.cid, ok }] };
    }
    case 'order': {
      const ok = Array.isArray(answer) && answer.length === e.answer.length && answer.every((t, i) => t === e.answer[i]);
      return { correct: ok, expected: e.answer.join(' '), cids: [] };
    }
    case 'match': {
      const map = answer && typeof answer === 'object' ? answer : {};
      const cids = e.pairs.map((p) => ({ cid: p.cid, ok: map[p.l] === p.r }));
      const detail = Object.fromEntries(e.pairs.map((p) => [p.l, map[p.l] === p.r]));
      return { correct: cids.every((c) => c.ok), expected: null, cids, detail };
    }
    default:
      return { correct: true, expected: null, cids: [] };
  }
}

module.exports = { buildExercises, buildTest, buildPlacement, buildReview, publicView, check, normalize, shuffle, sample };
