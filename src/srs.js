'use strict';
const { DAY } = require('./db');

// SM-2 style scheduling per concept.
function nextState(prev, ok, now = Date.now()) {
  let { reps, ease, interval_days: interval, lapses } = prev;
  if (ok) {
    reps += 1;
    interval = reps === 1 ? 1 : reps === 2 ? 3 : Math.round(interval * ease);
    ease = Math.min(2.8, ease + 0.08);
  } else {
    reps = 0;
    lapses += 1;
    interval = 0;
    ease = Math.max(1.3, ease - 0.2);
  }
  const due_at = ok ? now + interval * DAY : now + 10 * 60000;
  return { reps, ease, interval_days: interval, lapses, due_at };
}

function scheduleRating(prev, rating, now = Date.now()) {
  let { reps = 0, ease = 2.3, interval_days: interval = 0, lapses = 0 } = prev || {};
  let r = String(rating).toLowerCase();
  let due_at;

  if (r === '0' || r === 'again' || r === 'fail' || r === 'false' || r === 'no') {
    reps = 0;
    lapses += 1;
    interval = 0;
    ease = Math.max(1.3, ease - 0.2);
    due_at = now + 10 * 60000; // 10 minutes
  } else if (r === '2' || r === 'hard') {
    reps += 1;
    interval = reps <= 1 ? 1 : Math.max(1, Math.round((interval || 1) * 1.2));
    ease = Math.max(1.3, ease - 0.15);
    due_at = now + interval * DAY;
  } else if (r === '5' || r === 'easy') {
    reps += 1;
    interval = reps === 1 ? 2 : reps === 2 ? 4 : Math.max(2, Math.round((interval || 1) * ease * 1.3));
    ease = Math.min(2.8, ease + 0.15);
    due_at = now + interval * DAY;
  } else {
    // Default: 'good' / '4' / 'pass' / 'true' / 'yes'
    reps += 1;
    interval = reps === 1 ? 1 : reps === 2 ? 3 : Math.max(1, Math.round((interval || 1) * ease));
    ease = Math.min(2.8, ease + 0.05);
    due_at = now + interval * DAY;
  }

  return { reps, ease, interval_days: interval, lapses, due_at };
}

function recordResults(db, userId, lang, results, now = Date.now()) {
  const get = db.prepare('SELECT reps, ease, interval_days, lapses, due_at FROM word_progress WHERE user_id=? AND lang=? AND concept_id=?');
  const upsert = db.prepare(`
    INSERT INTO word_progress (user_id, lang, concept_id, reps, ease, interval_days, due_at, lapses)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id, lang, concept_id) DO UPDATE SET
      reps=excluded.reps, ease=excluded.ease, interval_days=excluded.interval_days,
      due_at=excluded.due_at, lapses=excluded.lapses`);
  for (const [cid, ok] of results) {
    const prev = get.get(userId, lang, cid) || { reps: 0, ease: 2.3, interval_days: 0, lapses: 0 };
    if (ok && prev.due_at !== undefined && prev.due_at > now) continue; // not due yet: replaying must not inflate the schedule
    const s = nextState(prev, ok, now);
    upsert.run(userId, lang, cid, s.reps, s.ease, s.interval_days, s.due_at, s.lapses);
  }
}

function dueConcepts(db, userId, lang, limit = 10, now = Date.now()) {
  return db.prepare('SELECT concept_id FROM word_progress WHERE user_id=? AND lang=? AND due_at<=? ORDER BY due_at LIMIT ?')
    .all(userId, lang, now, limit).map((r) => r.concept_id);
}

function dueCount(db, userId, lang, now = Date.now()) {
  return db.prepare('SELECT COUNT(*) n FROM word_progress WHERE user_id=? AND lang=? AND due_at<=?').get(userId, lang, now).n;
}

module.exports = { nextState, scheduleRating, recordResults, dueConcepts, dueCount };
