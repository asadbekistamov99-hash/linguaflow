'use strict';
const { dateKey, dayStartMs, DAY, TZ_HOURS } = require('./db');
const auth = require('./auth');

const str = (v, max, name, { required = true } = {}) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (required && !s) throw Object.assign(new Error(`${name} kerak`), { status: 400 });
  if (s.length > max) throw Object.assign(new Error(`${name} juda uzun`), { status: 400 });
  return s;
};

module.exports = function registerAdmin({ db, q, route, content, HttpError, requireAdmin, logAudit, BADGES, publicUser }) {
  const bad = (m) => new HttpError(400, m);
  const adm = (fn) => async (c) => { const admin = requireAdmin(c.req); try { return await fn({ ...c, admin }); } catch (e) { if (e.status && !(e instanceof HttpError)) throw new HttpError(e.status, e.message); throw e; } };
  const val = (sql, ...p) => db.prepare(sql).get(...p);
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  // ---------- dashboard ----------
  route('GET', '/api/admin/stats', adm(async () => {
    const now = Date.now();
    const today = dateKey(now);
    const start = dayStartMs(today);
    const c = (sql, ...p) => val(sql, ...p).n;
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const from = dayStartMs(today - i), to = from + DAY;
      days.push({
        day: new Date(from + TZ_HOURS * 3600000).toISOString().slice(5, 10),
        signups: c('SELECT COUNT(*) n FROM users WHERE created_at>=? AND created_at<?', from, to),
        active: c('SELECT COUNT(DISTINCT user_id) n FROM xp_events WHERE created_at>=? AND created_at<?', from, to),
        xp: val('SELECT COALESCE(SUM(amount),0) n FROM xp_events WHERE created_at>=? AND created_at<?', from, to).n,
      });
    }
    const byLang = db.prepare("SELECT substr(lesson_id,1,instr(lesson_id,'.')-1) lang, COUNT(*) n FROM lesson_progress WHERE completed_at IS NOT NULL GROUP BY lang ORDER BY n DESC").all();
    const games = db.prepare('SELECT game, COUNT(*) n FROM game_scores WHERE created_at>=? GROUP BY game ORDER BY n DESC').all(now - 7 * DAY);
    return {
      totals: {
        users: c('SELECT COUNT(*) n FROM users'), admins: c("SELECT COUNT(*) n FROM users WHERE role='admin'"), banned: c('SELECT COUNT(*) n FROM users WHERE banned=1'),
        newToday: c('SELECT COUNT(*) n FROM users WHERE created_at>=?', start), new7d: c('SELECT COUNT(*) n FROM users WHERE created_at>=?', now - 7 * DAY),
        activeToday: c('SELECT COUNT(*) n FROM users WHERE last_active=?', today), active7d: c('SELECT COUNT(*) n FROM users WHERE last_active>=?', today - 6),
        lessonsDone: c('SELECT COUNT(*) n FROM lesson_progress WHERE completed_at IS NOT NULL'),
        xpTotal: val('SELECT COALESCE(SUM(xp),0) n FROM users').n, xp7d: val('SELECT COALESCE(SUM(amount),0) n FROM xp_events WHERE created_at>=?', now - 7 * DAY).n,
        games7d: games.reduce((a, g) => a + g.n, 0),
        units: content.units().length, concepts: content.units().reduce((a, u) => a + u.concepts.length, 0), sentences: content.units().reduce((a, u) => a + u.sentences.length, 0),
      },
      series: days, byLang, games,
    };
  }));

  // ---------- users ----------
  route('GET', '/api/admin/users', adm(async ({ url }) => {
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const size = 20;
    const like = `%${String(url.searchParams.get('q') || '').replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    const sort = { new: 'created_at DESC', xp: 'xp DESC', active: 'last_active DESC' }[url.searchParams.get('sort')] || 'created_at DESC';
    const where = "(name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')";
    const total = val(`SELECT COUNT(*) n FROM users WHERE ${where}`, like, like).n;
    const users = db.prepare(`SELECT id,name,email,role,banned,xp,streak,created_at,last_active FROM users WHERE ${where} ORDER BY ${sort}, id DESC LIMIT ? OFFSET ?`).all(like, like, size, (page - 1) * size);
    return { users: users.map((u) => ({ ...u, banned: !!u.banned })), total, page, pages: Math.max(1, Math.ceil(total / size)) };
  }));

  route('GET', '/api/admin/users/:id', adm(async ({ params }) => {
    const u = q.userById.get(Number(params.id));
    if (!u) throw new HttpError(404, 'Foydalanuvchi topilmadi');
    const progress = db.prepare("SELECT substr(lesson_id,1,instr(lesson_id,'.')-1) lang, SUM(CASE WHEN lesson_id LIKE '%.test' THEN 0 ELSE 1 END) lessons, SUM(CASE WHEN lesson_id LIKE '%.test' THEN 1 ELSE 0 END) tests FROM lesson_progress WHERE user_id=? AND completed_at IS NOT NULL GROUP BY lang").all(u.id);
    return {
      user: { ...publicUser(u), banned: !!u.banned, createdAt: u.created_at, lastActive: u.last_active },
      progress,
      badges: q.badges.all(u.id).map((b) => ({ ...BADGES[b.key], key: b.key, earnedAt: b.earned_at })),
      recent: db.prepare('SELECT amount, lang, source, created_at FROM xp_events WHERE user_id=? ORDER BY id DESC LIMIT 15').all(u.id),
      words: val('SELECT COUNT(*) n FROM word_progress WHERE user_id=?', u.id).n,
    };
  }));

  route('PATCH', '/api/admin/users/:id', adm(async ({ params, body, admin }) => {
    const u = q.userById.get(Number(params.id));
    if (!u) throw new HttpError(404, 'Foydalanuvchi topilmadi');
    const self = u.id === admin.id;
    const changes = [];
    let { role, banned, name } = u;
    if (body.name !== undefined) { name = str(body.name, 40, 'Ism'); if (name.length < 2) throw bad('Ism juda qisqa'); }
    if (body.role !== undefined) {
      if (!['user', 'admin'].includes(body.role)) throw bad("Noto'g'ri rol");
      if (body.role !== u.role) {
        if (self) throw bad("O'z rolingizni o'zgartira olmaysiz");
        role = body.role; changes.push(`role=${role}`);
      }
    }
    if (body.banned !== undefined) {
      const b = body.banned ? 1 : 0;
      if (b !== u.banned) {
        if (self) throw bad("O'zingizni bloklay olmaysiz");
        if (b && u.role === 'admin') throw bad('Avval adminlikni olib tashlang');
        banned = b; changes.push(b ? 'banned' : 'unbanned');
      }
    }
    db.prepare('UPDATE users SET name=?, role=?, banned=? WHERE id=?').run(name, role, banned, u.id);
    if (name !== u.name) changes.push('name');
    logAudit(admin.id, 'user.update', `#${u.id} ${u.email}: ${changes.join(', ') || 'no changes'}`);
    return { ok: true };
  }));

  route('POST', '/api/admin/users/:id/reset', adm(async ({ params, body, admin }) => {
    const u = q.userById.get(Number(params.id));
    if (!u) throw new HttpError(404, 'Foydalanuvchi topilmadi');
    if (!['progress', 'xp'].includes(body.what)) throw bad("Noto'g'ri amal");
    tx(() => {
      if (body.what === 'progress') { db.prepare('DELETE FROM lesson_progress WHERE user_id=?').run(u.id); db.prepare('DELETE FROM word_progress WHERE user_id=?').run(u.id); }
      else { db.prepare('DELETE FROM xp_events WHERE user_id=?').run(u.id); db.prepare('DELETE FROM game_scores WHERE user_id=?').run(u.id); db.prepare('UPDATE users SET xp=0, streak=0, best_streak=0, last_active=NULL WHERE id=?').run(u.id); db.prepare('DELETE FROM badges WHERE user_id=?').run(u.id); }
    });
    logAudit(admin.id, 'user.reset', `#${u.id} ${u.email}: ${body.what}`);
    return { ok: true };
  }));

  route('POST', '/api/admin/users/:id/password', adm(async ({ params, body, admin }) => {
    const u = q.userById.get(Number(params.id));
    if (!u) throw new HttpError(404, 'Foydalanuvchi topilmadi');
    const newPass = String(body.password ?? '');
    if (newPass.length < 8 || newPass.length > 100) throw bad("Parol kamida 8 belgidan iborat bo'lsin");
    const hash = await auth.hashPasswordAsync(newPass);
    db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(hash, u.id);
    logAudit(admin.id, 'user.password_reset', `#${u.id} ${u.email}`);
    return { ok: true };
  }));

  route('DELETE', '/api/admin/users/:id', adm(async ({ params, admin }) => {
    const u = q.userById.get(Number(params.id));
    if (!u) throw new HttpError(404, 'Foydalanuvchi topilmadi');
    if (u.id === admin.id) throw bad("O'zingizni o'chira olmaysiz");
    if (u.role === 'admin') throw bad('Avval adminlikni olib tashlang');
    db.prepare('DELETE FROM users WHERE id=?').run(u.id);
    logAudit(admin.id, 'user.delete', `#${u.id} ${u.email}`);
    return { ok: true };
  }));

  // ---------- content ----------
  const reload = () => content.reload();
  const parseObj = (v, name, langCodes) => {
    if (v == null) return {};
    if (typeof v !== 'object' || Array.isArray(v)) throw bad(`${name} noto'g'ri`);
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (!langCodes.has(k)) continue;
      const s = str(x, 120, `${name}.${k}`, { required: false });
      if (s) out[k] = s;
    }
    return out;
  };
  const langCodes = () => new Set(content.langs({ all: true }).map((l) => l.code));

  route('GET', '/api/admin/content', adm(async () => {
    const langs = content.langs({ all: true });
    const units = content.units();
    const totalC = units.reduce((a, u) => a + u.concepts.length, 0);
    const totalS = units.reduce((a, u) => a + u.sentences.length, 0);
    return {
      languages: langs.map((l) => ({
        ...l, concepts: units.reduce((a, u) => a + u.concepts.filter((c) => c.t[l.code]).length, 0), sentences: units.reduce((a, u) => a + u.sentences.filter((s) => s.t[l.code]).length, 0),
        playable: content.lessons(l.code).length > 0,
      })),
      units: units.map((u) => ({ key: u.key, title: u.title, emoji: u.emoji, enabled: u.enabled, concepts: u.concepts, sentences: u.sentences })),
      totals: { concepts: totalC, sentences: totalS },
    };
  }));

  route('GET', '/api/admin/export', adm(async () => ({
    exportedAt: new Date().toISOString(), languages: content.langs({ all: true }),
    units: content.units().map((u) => ({ key: u.key, title: u.title, emoji: u.emoji, enabled: u.enabled, concepts: u.concepts, sentences: u.sentences })),
  })));

  route('PUT', '/api/admin/languages/:code', adm(async ({ params, body, admin }) => {
    const code = params.code;
    if (!/^[a-z]{2,3}$/.test(code)) throw bad("Til kodi 2-3 ta kichik harf bo'lsin");
    const name = str(body.name, 40, 'Nomi'), native = str(body.native, 40, 'Mahalliy nomi'), flag = str(body.flag, 8, 'Bayroq');
    const tts = str(body.tts, 12, 'TTS kodi');
    if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(tts)) throw bad("TTS kodi noto'g'ri (masalan: en-GB)");
    const dir = body.dir === 'rtl' ? 'rtl' : 'ltr';
    const color = String(body.color || '#7c5cff');
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw bad("Rang noto'g'ri (#rrggbb)");
    const enabled = body.enabled === false ? 0 : 1;
    const exists = val('SELECT code FROM languages WHERE code=?', code);
    if (exists) db.prepare('UPDATE languages SET name=?,native=?,flag=?,tts=?,dir=?,color=?,enabled=? WHERE code=?').run(name, native, flag, tts, dir, color, enabled, code);
    else db.prepare('INSERT INTO languages (code,name,native,flag,tts,dir,color,enabled,position) VALUES (?,?,?,?,?,?,?,?,?)').run(code, name, native, flag, tts, dir, color, enabled, val('SELECT COALESCE(MAX(position),0)+1 n FROM languages').n);
    reload(); logAudit(admin.id, exists ? 'language.update' : 'language.create', code);
    return { ok: true };
  }));

  route('POST', '/api/admin/units', adm(async ({ body, admin }) => {
    const key = String(body.key || '').trim();
    if (!/^[a-z0-9]{2,20}$/.test(key)) throw bad("Kalit: 2-20 ta kichik lotin harf yoki raqam");
    if (content.unit(key)) throw new HttpError(409, 'Bunday mavzu kaliti bor');
    const title = str(body.title, 60, 'Sarlavha'), emoji = str(body.emoji || '📘', 8, 'Emoji');
    db.prepare('INSERT INTO units (key,title,emoji,enabled,position) VALUES (?,?,?,1,?)').run(key, title, emoji, val('SELECT COALESCE(MAX(position),0)+1 n FROM units').n);
    reload(); logAudit(admin.id, 'unit.create', key);
    return { ok: true };
  }));

  route('PATCH', '/api/admin/units/:key', adm(async ({ params, body, admin }) => {
    const u = content.unit(params.key);
    if (!u) throw new HttpError(404, 'Mavzu topilmadi');
    const title = body.title !== undefined ? str(body.title, 60, 'Sarlavha') : u.title;
    const emoji = body.emoji !== undefined ? str(body.emoji, 8, 'Emoji') : u.emoji;
    const enabled = body.enabled !== undefined ? (body.enabled ? 1 : 0) : (u.enabled ? 1 : 0);
    db.prepare('UPDATE units SET title=?, emoji=?, enabled=? WHERE key=?').run(title, emoji, enabled, u.key);
    reload(); logAudit(admin.id, 'unit.update', u.key);
    return { ok: true };
  }));

  route('POST', '/api/admin/units/:key/move', adm(async ({ params, body, admin }) => {
    const all = content.units();
    const i = all.findIndex((u) => u.key === params.key);
    if (i < 0) throw new HttpError(404, 'Mavzu topilmadi');
    const j = i + (body.dir === 'up' ? -1 : 1);
    if (j < 0 || j >= all.length) return { ok: true };
    tx(() => { // rewrite positions so equal values cannot break the swap
      const order = all.map((u) => u.key);
      [order[i], order[j]] = [order[j], order[i]];
      order.forEach((k, idx) => db.prepare('UPDATE units SET position=? WHERE key=?').run(idx, k));
    });
    reload(); logAudit(admin.id, 'unit.move', `${params.key} ${body.dir}`);
    return { ok: true };
  }));

  route('DELETE', '/api/admin/units/:key', adm(async ({ params, admin }) => {
    if (!content.unit(params.key)) throw new HttpError(404, 'Mavzu topilmadi');
    tx(() => {
      db.prepare('DELETE FROM units WHERE key=?').run(params.key);
      db.prepare('DELETE FROM word_progress WHERE concept_id LIKE ?').run(`${params.key}.%`);
      db.prepare('DELETE FROM lesson_progress WHERE lesson_id LIKE ?').run(`%.${params.key}.%`);
    });
    reload(); logAudit(admin.id, 'unit.delete', params.key);
    return { ok: true };
  }));

  route('POST', '/api/admin/units/:key/concepts', adm(async ({ params, body, admin }) => {
    const u = content.unit(params.key);
    if (!u) throw new HttpError(404, 'Mavzu topilmadi');
    const uz = str(body.uz, 120, "O'zbekcha");
    const codes = langCodes();
    const t = parseObj(body.t, 't', codes), tr = parseObj(body.tr, 'tr', codes);
    const nextN = Math.max(-1, ...u.concepts.map((c) => Number(c.id.split('.').pop()) || 0)) + 1;
    const id = `${u.key}.${nextN}`;
    db.prepare('INSERT INTO concepts (id,unit_key,position,uz,t,tr) VALUES (?,?,?,?,?,?)').run(id, u.key, val('SELECT COALESCE(MAX(position),-1)+1 n FROM concepts WHERE unit_key=?', u.key).n, uz, JSON.stringify(t), JSON.stringify(tr));
    reload(); logAudit(admin.id, 'concept.create', `${id} ${uz}`);
    return { ok: true, id };
  }));

  route('PATCH', '/api/admin/concepts/:id', adm(async ({ params, body, admin }) => {
    const c = content.concept(params.id);
    if (!c) throw new HttpError(404, "So'z topilmadi");
    const codes = langCodes();
    const uz = body.uz !== undefined ? str(body.uz, 120, "O'zbekcha") : c.uz;
    const merge = (base, patch, name) => {
      if (patch == null) return base;
      if (typeof patch !== 'object' || Array.isArray(patch)) throw bad(`${name} noto'g'ri`);
      const out = { ...base };
      for (const [k, x] of Object.entries(patch)) {
        if (!codes.has(k)) continue;
        const s = str(x, 120, `${name}.${k}`, { required: false });
        if (s) out[k] = s; else delete out[k];
      }
      return out;
    };
    db.prepare('UPDATE concepts SET uz=?, t=?, tr=? WHERE id=?').run(uz, JSON.stringify(merge(c.t, body.t, 't')), JSON.stringify(merge(c.tr, body.tr, 'tr')), c.id);
    reload(); logAudit(admin.id, 'concept.update', `${c.id} ${uz}`);
    return { ok: true };
  }));

  route('POST', '/api/admin/concepts/:id/move', adm(async ({ params, body, admin }) => {
    const c = content.concept(params.id);
    if (!c) throw new HttpError(404, "So'z topilmadi");
    const list = content.unit(c.unit).concepts;
    const i = list.findIndex((x) => x.id === c.id), j = i + (body.dir === 'up' ? -1 : 1);
    if (j < 0 || j >= list.length) return { ok: true };
    tx(() => {
      const order = list.map((x) => x.id);
      [order[i], order[j]] = [order[j], order[i]];
      order.forEach((id, idx) => db.prepare('UPDATE concepts SET position=? WHERE id=?').run(idx, id));
    });
    reload(); logAudit(admin.id, 'concept.move', `${c.id} ${body.dir}`);
    return { ok: true };
  }));

  route('DELETE', '/api/admin/concepts/:id', adm(async ({ params, admin }) => {
    const c = content.concept(params.id);
    if (!c) throw new HttpError(404, "So'z topilmadi");
    tx(() => { db.prepare('DELETE FROM concepts WHERE id=?').run(c.id); db.prepare('DELETE FROM word_progress WHERE concept_id=?').run(c.id); });
    reload(); logAudit(admin.id, 'concept.delete', `${c.id} ${c.uz}`);
    return { ok: true };
  }));

  route('POST', '/api/admin/units/:key/sentences', adm(async ({ params, body, admin }) => {
    const u = content.unit(params.key);
    if (!u) throw new HttpError(404, 'Mavzu topilmadi');
    const uz = str(body.uz, 200, "O'zbekcha");
    const t = parseObj(body.t, 't', langCodes());
    const info = db.prepare('INSERT INTO sentences (unit_key,position,uz,t) VALUES (?,?,?,?)').run(u.key, val('SELECT COALESCE(MAX(position),-1)+1 n FROM sentences WHERE unit_key=?', u.key).n, uz, JSON.stringify(t));
    reload(); logAudit(admin.id, 'sentence.create', `${u.key}: ${uz}`);
    return { ok: true, id: Number(info.lastInsertRowid) };
  }));

  route('PATCH', '/api/admin/sentences/:id', adm(async ({ params, body, admin }) => {
    const s = content.sentence(Number(params.id));
    if (!s) throw new HttpError(404, 'Jumla topilmadi');
    const codes = langCodes();
    const uz = body.uz !== undefined ? str(body.uz, 200, "O'zbekcha") : s.uz;
    const t = { ...s.t };
    for (const [k, x] of Object.entries(body.t || {})) {
      if (!codes.has(k)) continue;
      const v = str(x, 200, `t.${k}`, { required: false });
      if (v) t[k] = v; else delete t[k];
    }
    db.prepare('UPDATE sentences SET uz=?, t=? WHERE id=?').run(uz, JSON.stringify(t), s.id);
    reload(); logAudit(admin.id, 'sentence.update', `#${s.id}`);
    return { ok: true };
  }));

  route('DELETE', '/api/admin/sentences/:id', adm(async ({ params, admin }) => {
    const s = content.sentence(Number(params.id));
    if (!s) throw new HttpError(404, 'Jumla topilmadi');
    db.prepare('DELETE FROM sentences WHERE id=?').run(s.id);
    reload(); logAudit(admin.id, 'sentence.delete', `#${s.id}`);
    return { ok: true };
  }));

  // ---------- settings & audit ----------
  route('GET', '/api/admin/settings', adm(async () => {
    const row = q.setting.get('announcement');
    let a = { enabled: false, text: '', level: 'info' };
    if (row) { try { a = { ...a, ...JSON.parse(row.value) }; } catch { /* keep default */ } }
    return { announcement: a };
  }));

  route('PUT', '/api/admin/settings', adm(async ({ body, admin }) => {
    const a = body.announcement || {};
    const value = { enabled: !!a.enabled, text: str(a.text, 240, 'Matn', { required: false }), level: a.level === 'warn' ? 'warn' : 'info' };
    db.prepare("INSERT INTO settings (key,value) VALUES ('announcement',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(value));
    logAudit(admin.id, 'settings.announcement', value.enabled ? value.text : 'off');
    return { ok: true };
  }));

  route('GET', '/api/admin/audit', adm(async ({ url }) => {
    const limit = Math.min(200, Math.max(10, Number(url.searchParams.get('limit')) || 50));
    return { rows: db.prepare('SELECT a.id, a.action, a.detail, a.created_at, u.name admin FROM audit_log a LEFT JOIN users u ON u.id=a.admin_id ORDER BY a.id DESC LIMIT ?').all(limit) };
  }));
};
