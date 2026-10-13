'use strict';
const { dateKey } = require('./db');

// Free-tier AI limits per user per day. Admins can change them in the panel (settings key "ai_limits");
// 0 switches a feature off. Admin accounts are exempt so the owner can test freely.
const DEFAULT_LIMITS = { tutor: 40, writing: 10, speaking: 15 };

function createQuota(db) {
  const getSetting = db.prepare("SELECT value FROM settings WHERE key='ai_limits'");
  const sel = db.prepare('SELECT count FROM ai_usage WHERE user_id=? AND day=? AND feature=?');
  const up = db.prepare('INSERT INTO ai_usage (user_id,day,feature,count) VALUES (?,?,?,1) ON CONFLICT(user_id,day,feature) DO UPDATE SET count=count+1');

  function limits() {
    let saved = {};
    try { saved = JSON.parse((getSetting.get() || {}).value || '{}'); } catch { /* defaults */ }
    const out = { ...DEFAULT_LIMITS };
    for (const k of Object.keys(DEFAULT_LIMITS)) { const n = Number(saved[k]); if (Number.isInteger(n) && n >= 0 && n <= 100000) out[k] = n; }
    return out;
  }

  function setLimits(input) {
    const next = { ...limits() };
    for (const k of Object.keys(DEFAULT_LIMITS)) {
      if (input[k] === undefined) continue;
      const n = Number(input[k]);
      if (!Number.isInteger(n) || n < 0 || n > 100000) throw Object.assign(new Error(`${k} limiti 0 dan 100000 gacha butun son bo'lsin`), { status: 400 });
      next[k] = n;
    }
    db.prepare("INSERT INTO settings (key,value) VALUES ('ai_limits',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(next));
    return next;
  }

  function consume(user, feature, now = Date.now()) {
    const limit = limits()[feature];
    if (limit === undefined || user.role === 'admin') return { ok: true, used: 0, limit: null };
    const day = dateKey(now);
    const used = (sel.get(user.id, day, feature) || {}).count || 0;
    if (used >= limit) return { ok: false, used, limit };
    up.run(user.id, day, feature);
    return { ok: true, used: used + 1, limit };
  }

  function usage(userId, now = Date.now()) {
    const day = dateKey(now), lim = limits();
    return Object.fromEntries(Object.keys(lim).map((f) => [f, { used: (sel.get(userId, day, f) || {}).count || 0, limit: lim[f] }]));
  }

  function totals(now = Date.now()) {
    const day = dateKey(now);
    return {
      limits: limits(),
      features: db.prepare('SELECT feature, COUNT(*) users, SUM(count) calls FROM ai_usage WHERE day=? GROUP BY feature ORDER BY calls DESC').all(day),
      top: db.prepare('SELECT u.id, u.name, u.email, SUM(a.count) calls FROM ai_usage a JOIN users u ON u.id=a.user_id WHERE a.day=? GROUP BY u.id ORDER BY calls DESC LIMIT 10').all(day),
    };
  }

  return { limits, setLimits, consume, usage, totals, FEATURES: Object.keys(DEFAULT_LIMITS) };
}

module.exports = { createQuota, DEFAULT_LIMITS };
