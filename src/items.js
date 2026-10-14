'use strict';

// Item bank: exam-style questions tagged by language, CEFR level, skill and exam, with a review workflow
// (draft -> review -> approved/rejected). Only staff (admins and assigned reviewers) can see or change it.
const SKILLS = ['vocab', 'grammar', 'reading', 'listening', 'writing', 'speaking'];
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const EXAMS = ['general', 'ielts', 'toefl', 'cambridge', 'goethe', 'testdaf', 'delf', 'dalf', 'dele', 'siele', 'torfl', 'other'];
const CLOSED_TYPES = ['mcq', 'gap', 'tf_ng', 'matching', 'short'];
const TYPES = [...CLOSED_TYPES, 'essay_prompt', 'speaking_prompt'];
const STATUSES = ['draft', 'review', 'approved', 'rejected'];
// Agreed plan: English up to C2, every other language up to B2.
const targetLevel = (lang) => (lang === 'en' ? 'C2' : 'B2');

class ItemError extends Error { constructor(m) { super(m); this.status = 400; } }
const fail = (m) => { throw new ItemError(m); };

function txt(v, max, name, required = true) {
  const s = String(v ?? '').replace(/\r\n/g, '\n').trim();
  if (required && !s) fail(`${name} kerak`);
  if (s.length > max) fail(`${name} juda uzun (${max} belgigacha)`);
  return s;
}
const strList = (v, min, max, itemMax, name) => {
  if (!Array.isArray(v) || v.length < min || v.length > max) fail(`${name}: ${min}-${max} ta element kerak`);
  return v.map((x, i) => txt(x, itemMax, `${name}[${i}]`));
};

function normalizePayload(type, p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) fail('payload obyekt bo\'lishi kerak');
  const out = {};
  switch (type) {
    case 'mcq': {
      out.question = txt(p.question, 1000, 'question');
      out.options = strList(p.options, 2, 6, 300, 'options');
      if (new Set(out.options.map((o) => o.toLowerCase())).size !== out.options.length) fail('options takrorlanmasin');
      const a = typeof p.answer === 'number' ? p.answer : out.options.findIndex((o) => o === String(p.answer ?? '').trim());
      if (!Number.isInteger(a) || a < 0 || a >= out.options.length) fail('answer: variantlardan biri (indeks yoki matn) bo\'lsin');
      out.answer = a;
      break;
    }
    case 'gap':
      out.text = txt(p.text, 2000, 'text');
      if (!out.text.includes('___')) fail("text ichida bo'sh joy '___' bo'lishi kerak");
      out.answers = strList(p.answers ?? (p.answer != null ? [p.answer] : undefined), 1, 5, 200, 'answers');
      break;
    case 'tf_ng':
      out.statement = txt(p.statement, 1000, 'statement');
      if (!['true', 'false', 'not_given'].includes(p.answer)) fail("answer: 'true', 'false' yoki 'not_given'");
      out.answer = p.answer;
      break;
    case 'matching': {
      if (!Array.isArray(p.pairs) || p.pairs.length < 2 || p.pairs.length > 8) fail('pairs: 2-8 ta juftlik kerak');
      out.pairs = p.pairs.map((x, i) => ({ l: txt(x && x.l, 200, `pairs[${i}].l`), r: txt(x && x.r, 200, `pairs[${i}].r`) }));
      break;
    }
    case 'short':
      out.question = txt(p.question, 1000, 'question');
      out.answers = strList(p.answers ?? (p.answer != null ? [p.answer] : undefined), 1, 5, 200, 'answers');
      break;
    case 'essay_prompt': {
      out.prompt = txt(p.prompt, 3000, 'prompt');
      const mw = p.min_words === undefined ? 150 : Number(p.min_words);
      if (!Number.isInteger(mw) || mw < 20 || mw > 1000) fail('min_words 20-1000 oralig\'ida bo\'lsin');
      out.min_words = mw;
      if (p.task !== undefined) { if (!['task1', 'task2'].includes(p.task)) fail("task: 'task1' yoki 'task2'"); out.task = p.task; }
      break;
    }
    case 'speaking_prompt': {
      out.prompt = txt(p.prompt, 2000, 'prompt');
      if (p.part !== undefined) { const n = Number(p.part); if (![1, 2, 3].includes(n)) fail('part: 1, 2 yoki 3'); out.part = n; }
      if (p.prep_seconds !== undefined) { const n = Number(p.prep_seconds); if (!Number.isInteger(n) || n < 0 || n > 300) fail('prep_seconds 0-300'); out.prep_seconds = n; }
      break;
    }
    default: fail("Noto'g'ri savol turi");
  }
  // optional context shared by all types
  if (p.passage) out.passage = txt(p.passage, 8000, 'passage');
  if (p.transcript) out.transcript = txt(p.transcript, 8000, 'transcript');
  if (p.explanation_uz) out.explanation_uz = txt(p.explanation_uz, 2000, 'explanation_uz');
  if (p.audio_url) {
    const u = txt(p.audio_url, 500, 'audio_url');
    if (!/^(https:\/\/[^\s]+|\/[A-Za-z0-9_\-./]+)$/.test(u)) fail("audio_url: https:// yoki / bilan boshlansin");
    out.audio_url = u;
  }
  return out;
}

function normalizeItem(body, languages, defaults = {}) {
  const b = { ...defaults, ...(body && typeof body === 'object' ? body : {}) };
  if (!languages.has(b.lang)) fail("Noto'g'ri til");
  if (!SKILLS.includes(b.skill)) fail(`skill: ${SKILLS.join(', ')}`);
  if (!LEVELS.includes(b.level)) fail(`level: ${LEVELS.join(', ')}`);
  const exam = b.exam === undefined ? 'general' : b.exam;
  if (!EXAMS.includes(exam)) fail(`exam: ${EXAMS.join(', ')}`);
  if (!TYPES.includes(b.type)) fail(`type: ${TYPES.join(', ')}`);
  if (b.skill === 'writing' && b.type !== 'essay_prompt') fail("writing uchun type 'essay_prompt' bo'lsin");
  if (b.skill === 'speaking' && b.type !== 'speaking_prompt') fail("speaking uchun type 'speaking_prompt' bo'lsin");
  if (!['writing', 'speaking'].includes(b.skill) && !CLOSED_TYPES.includes(b.type)) fail(`${b.skill} uchun type: ${CLOSED_TYPES.join(', ')}`);
  return { lang: b.lang, skill: b.skill, level: b.level, exam, type: b.type, payload: normalizePayload(b.type, b.payload) };
}

const bundled = () => require('./bundled'); // lazy: bundled.js requires this module

module.exports = function registerItems({ db, route, content, HttpError, requireUser, logAudit }) {
  const langSet = () => new Set(content.langs({ all: true }).map((l) => l.code));
  const val = (sql, ...p) => db.prepare(sql).get(...p);
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  function staffUser(req) {
    const u = requireUser(req);
    if (u.role !== 'admin' && u.role !== 'reviewer') throw new HttpError(403, 'Faqat adminlar va tekshiruvchilar uchun');
    return u;
  }
  const allowedLangs = (u) => (u.role === 'admin' ? null : db.prepare('SELECT lang FROM reviewer_langs WHERE user_id=?').all(u.id).map((r) => r.lang));
  const canLang = (u, lang) => u.role === 'admin' || allowedLangs(u).includes(lang);
  const guardLang = (u, lang) => { if (!canLang(u, lang)) throw new HttpError(403, `${lang.toUpperCase()} tili uchun ruxsatingiz yo'q`); };

  const staff = (fn) => async (c) => {
    const user = staffUser(c.req);
    try { return await fn({ ...c, user }); } catch (e) { if (e instanceof ItemError) throw new HttpError(400, e.message); throw e; }
  };

  const out = (r) => ({
    id: r.id, lang: r.lang, skill: r.skill, level: r.level, exam: r.exam, type: r.type, payload: JSON.parse(r.payload),
    status: r.status, source: r.source, authorId: r.author_id, author: r.author || null, reviewerId: r.reviewer_id, reviewNote: r.review_note,
    createdAt: r.created_at, updatedAt: r.updated_at,
  });
  const getItem = (id) => db.prepare('SELECT i.*, u.name author FROM items i LEFT JOIN users u ON u.id=i.author_id WHERE i.id=?').get(id);

  route('GET', '/api/admin/items/meta', staff(async ({ user }) => ({
    skills: SKILLS, levels: LEVELS, exams: EXAMS, types: TYPES, closedTypes: CLOSED_TYPES, statuses: STATUSES,
    languages: content.langs({ all: true }).filter((l) => canLang(user, l.code)).map((l) => ({ code: l.code, name: l.name, flag: l.flag })),
    targets: Object.fromEntries(content.langs({ all: true }).map((l) => [l.code, targetLevel(l.code)])),
    role: user.role,
  })));

  // coverage matrix: language x level x status
  route('GET', '/api/admin/items/summary', staff(async ({ user }) => {
    const allow = allowedLangs(user);
    const rows = db.prepare('SELECT lang, level, status, COUNT(*) n FROM items GROUP BY lang, level, status').all().filter((r) => !allow || allow.includes(r.lang));
    const langs = content.langs({ all: true }).filter((l) => canLang(user, l.code)).map((l) => ({ code: l.code, name: l.name, flag: l.flag, target: targetLevel(l.code) }));
    const bySkill = db.prepare("SELECT lang, skill, COUNT(*) n FROM items WHERE status='approved' GROUP BY lang, skill").all().filter((r) => !allow || allow.includes(r.lang));
    return { rows, langs, levels: LEVELS, bySkill };
  }));

  route('GET', '/api/admin/items', staff(async ({ user, url }) => {
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1), size = 25;
    const where = [], args = [];
    const allow = allowedLangs(user);
    if (allow) { if (!allow.length) return { items: [], total: 0, page: 1, pages: 1 }; where.push(`i.lang IN (${allow.map(() => '?').join(',')})`); args.push(...allow); }
    for (const [param, col, list] of [['lang', 'lang', null], ['level', 'level', LEVELS], ['skill', 'skill', SKILLS], ['status', 'status', STATUSES], ['exam', 'exam', EXAMS], ['type', 'type', TYPES]]) {
      const v = url.searchParams.get(param);
      if (!v) continue;
      if (list && !list.includes(v)) throw new HttpError(400, `Noto'g'ri ${param}`);
      where.push(`i.${col}=?`); args.push(v);
    }
    const qtext = String(url.searchParams.get('q') || '').trim();
    if (qtext) { where.push("i.payload LIKE ? ESCAPE '\\'"); args.push(`%${qtext.replace(/[%_\\]/g, (m) => `\\${m}`)}%`); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = val(`SELECT COUNT(*) n FROM items i ${w}`, ...args).n;
    const rows = db.prepare(`SELECT i.*, u.name author FROM items i LEFT JOIN users u ON u.id=i.author_id ${w} ORDER BY i.id DESC LIMIT ? OFFSET ?`).all(...args, size, (page - 1) * size);
    return { items: rows.map(out), total, page, pages: Math.max(1, Math.ceil(total / size)) };
  }));

  route('POST', '/api/admin/items/import', staff(async ({ user, body }) => {
    const list = Array.isArray(body.items) ? body.items : null;
    if (!list || !list.length) throw new HttpError(400, 'items: bo\'sh bo\'lmagan massiv kerak');
    if (list.length > 500) throw new HttpError(400, "Bir martada 500 tagacha savol import qilinadi");
    const langs = langSet();
    const defaults = body.defaults && typeof body.defaults === 'object' ? body.defaults : {};
    const ok = [], errors = [];
    list.forEach((raw, index) => {
      try { const it = normalizeItem(raw, langs, defaults); guardLang(user, it.lang); ok.push(it); } catch (e) { errors.push({ index, error: e.message }); }
    });
    if (!body.dryRun && ok.length) {
      const now = Date.now();
      const ins = db.prepare("INSERT INTO items (lang,skill,level,exam,type,payload,status,source,author_id,created_at,updated_at) VALUES (?,?,?,?,?,?,'draft','import',?,?,?)");
      tx(() => { for (const it of ok) ins.run(it.lang, it.skill, it.level, it.exam, it.type, JSON.stringify(it.payload), user.id, now, now); });
      logAudit(user.id, 'item.import', `${ok.length} ta qoralama, ${errors.length} ta xato`);
    }
    return { dryRun: !!body.dryRun, valid: ok.length, created: body.dryRun ? 0 : ok.length, failed: errors.length, errors: errors.slice(0, 50) };
  }));

  // Content drafts shipped with the app (content/items/*.json): admin-only, idempotent, always imported as drafts.
  const adminOnly = (fn) => staff(async (c) => { if (c.user.role !== 'admin') throw new HttpError(403, 'Faqat adminlar uchun'); return fn(c); });
  route('GET', '/api/admin/items/bundled', adminOnly(async () => {
    const b = bundled();
    const files = b.bundledFiles();
    return { available: files.length, preview: files.length ? b.importFiles(db, files, { dryRun: true }) : null };
  }));
  route('POST', '/api/admin/items/import-bundled', adminOnly(async ({ user, body }) => {
    const b = bundled();
    const files = b.bundledFiles();
    if (!files.length) throw new HttpError(404, "Tayyor kontent fayllari topilmadi (content/items)");
    const r = tx(() => b.importFiles(db, files, { dryRun: !!body.dryRun }));
    if (!body.dryRun) logAudit(user.id, 'item.import_bundled', `${r.created} ta qoralama, ${r.duplicates} ta takror, ${r.failed} ta xato`);
    return { dryRun: !!body.dryRun, ...r };
  }));

  route('POST', '/api/admin/items', staff(async ({ user, body }) => {
    const it = normalizeItem(body, langSet());
    guardLang(user, it.lang);
    const now = Date.now();
    const info = db.prepare("INSERT INTO items (lang,skill,level,exam,type,payload,status,source,author_id,created_at,updated_at) VALUES (?,?,?,?,?,?,'draft','manual',?,?,?)")
      .run(it.lang, it.skill, it.level, it.exam, it.type, JSON.stringify(it.payload), user.id, now, now);
    logAudit(user.id, 'item.create', `#${info.lastInsertRowid} ${it.lang} ${it.level} ${it.skill}`);
    return { ok: true, id: Number(info.lastInsertRowid) };
  }));

  route('GET', '/api/admin/items/:id', staff(async ({ user, params }) => {
    const r = getItem(Number(params.id));
    if (!r) throw new HttpError(404, 'Savol topilmadi');
    guardLang(user, r.lang);
    return { item: out(r) };
  }));

  route('PATCH', '/api/admin/items/:id', staff(async ({ user, params, body }) => {
    const r = getItem(Number(params.id));
    if (!r) throw new HttpError(404, 'Savol topilmadi');
    guardLang(user, r.lang);
    const merged = normalizeItem({ lang: r.lang, skill: r.skill, level: r.level, exam: r.exam, type: r.type, payload: JSON.parse(r.payload), ...body }, langSet());
    guardLang(user, merged.lang);
    // an approved question that gets edited has to be reviewed again
    const status = r.status === 'approved' ? 'draft' : r.status;
    db.prepare('UPDATE items SET lang=?,skill=?,level=?,exam=?,type=?,payload=?,status=?,updated_at=? WHERE id=?')
      .run(merged.lang, merged.skill, merged.level, merged.exam, merged.type, JSON.stringify(merged.payload), status, Date.now(), r.id);
    logAudit(user.id, 'item.update', `#${r.id}${status !== r.status ? ' (qayta tekshiruvga)' : ''}`);
    return { ok: true, status };
  }));

  // workflow: draft -> review -> approved | rejected; withdraw back to draft. Reviewers never approve their own items.
  route('POST', '/api/admin/items/:id/status', staff(async ({ user, params, body }) => {
    const r = getItem(Number(params.id));
    if (!r) throw new HttpError(404, 'Savol topilmadi');
    guardLang(user, r.lang);
    const to = body.status;
    if (!STATUSES.includes(to)) throw new HttpError(400, "Noto'g'ri holat");
    const allowed = { draft: ['review'], review: ['approved', 'rejected', 'draft'], approved: ['draft'], rejected: ['draft', 'review'] }[r.status];
    if (!allowed.includes(to)) throw new HttpError(400, `${r.status} dan ${to} ga o'tib bo'lmaydi`);
    const note = txt(body.note, 1000, 'Izoh', false);
    if (to === 'rejected' && !note) throw new HttpError(400, "Rad etish sababini izohda yozing");
    if ((to === 'approved' || to === 'rejected') && user.role === 'reviewer' && r.author_id === user.id) throw new HttpError(403, "O'z savolingizni o'zingiz tasdiqlay olmaysiz");
    db.prepare('UPDATE items SET status=?, reviewer_id=?, review_note=?, updated_at=? WHERE id=?')
      .run(to, to === 'draft' || to === 'review' ? null : user.id, note || null, Date.now(), r.id);
    logAudit(user.id, `item.${to}`, `#${r.id}${note ? ': ' + note.slice(0, 80) : ''}`);
    return { ok: true, status: to };
  }));

  route('DELETE', '/api/admin/items/:id', staff(async ({ user, params }) => {
    const r = getItem(Number(params.id));
    if (!r) throw new HttpError(404, 'Savol topilmadi');
    guardLang(user, r.lang);
    if (r.status === 'approved' && user.role !== 'admin') throw new HttpError(403, "Tasdiqlangan savolni faqat admin o'chiradi");
    db.prepare('DELETE FROM items WHERE id=?').run(r.id);
    logAudit(user.id, 'item.delete', `#${r.id}`);
    return { ok: true };
  }));
};

module.exports.constants = { SKILLS, LEVELS, EXAMS, TYPES, STATUSES, targetLevel };
module.exports.normalizeItem = normalizeItem;
