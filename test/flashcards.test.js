'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');

const dirs = [];
async function boot() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-fc-'));
  dirs.push(dataDir);
  const { server, db, content } = createApp({ dbFile: ':memory:', dataDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  server.unref();
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (method, url, body) => {
      const r = await fetch(base + url, {
        method,
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
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

test('vocabulary flashcards: add, list, deck-status, bulk, SM-2 review modes, delete', async () => {
  const app = await boot();
  const api = app.client();

  // 1. Auth required
  const unauth = await api('GET', '/api/flashcards?lang=en');
  assert.equal(unauth.status, 401);

  // 2. Register user
  const reg = await api('POST', '/api/auth/register', { name: 'Card Learner', email: 'card@example.com', password: 'password123' });
  assert.equal(reg.status, 200);

  // 3. Initially deck is empty
  const empty = await api('GET', '/api/flashcards?lang=en');
  assert.equal(empty.status, 200);
  assert.equal(empty.data.cards.length, 0);
  assert.equal(empty.data.stats.total, 0);

  // 4. Add card by concept ID
  const units = app.content.units();
  const firstConcept = units[0].concepts[0];
  assert.ok(firstConcept);

  const add1 = await api('POST', '/api/flashcards', {
    lang: 'en',
    conceptId: firstConcept.id,
  });
  assert.equal(add1.status, 200, JSON.stringify(add1.data));
  assert.equal(add1.data.ok, true);
  assert.equal(add1.data.alreadyExists, false);
  assert.equal(add1.data.card.front, firstConcept.t.en);
  assert.equal(add1.data.card.back, firstConcept.uz);

  // 5. Duplicate addition returns alreadyExists: true without error
  const dup = await api('POST', '/api/flashcards', {
    lang: 'en',
    conceptId: firstConcept.id,
  });
  assert.equal(dup.status, 200);
  assert.equal(dup.data.alreadyExists, true);

  // 6. Check deck status (lists conceptIds)
  const statusRes = await api('GET', '/api/flashcards/deck-status?lang=en');
  assert.equal(statusRes.status, 200);
  assert.ok(statusRes.data.conceptIds.includes(firstConcept.id));

  // 7. Add custom flashcard (no concept ID)
  const custom = await api('POST', '/api/flashcards', {
    lang: 'en',
    front: 'Serendipity',
    back: 'Tasodifiy yoqimli kashfiyot',
    hint: '/ˌser.ənˈdɪp.ə.ti/',
    example: 'Finding this book was pure serendipity.',
  });
  assert.equal(custom.status, 200);
  assert.equal(custom.data.card.front, 'Serendipity');
  const customId = custom.data.card.id;

  // 8. Bulk addition
  const moreConcepts = units[0].concepts.slice(1, 4).map((c) => c.id);
  const bulkRes = await api('POST', '/api/flashcards/bulk', {
    lang: 'en',
    conceptIds: [firstConcept.id, ...moreConcepts],
  });
  assert.equal(bulkRes.status, 200);
  assert.equal(bulkRes.data.added, moreConcepts.length);

  // 9. List deck
  const deck = await api('GET', '/api/flashcards?lang=en');
  assert.equal(deck.status, 200);
  assert.equal(deck.data.stats.total, 2 + moreConcepts.length);
  assert.equal(deck.data.stats.dueCount, 2 + moreConcepts.length); // newly created are immediately due

  // 10. Review card with rating 'again'
  const revAgain = await api('POST', `/api/flashcards/${customId}/review`, { rating: 'again' });
  assert.equal(revAgain.status, 200);
  assert.equal(revAgain.data.card.reps, 0);
  assert.equal(revAgain.data.card.interval_days, 0);
  assert.equal(revAgain.data.card.lapses, 1);
  assert.ok(revAgain.data.card.due_at > Date.now()); // due in ~10 minutes

  // 11. Review with rating 'good'
  const revGood = await api('POST', `/api/flashcards/${customId}/review`, { rating: 'good' });
  assert.equal(revGood.status, 200);
  assert.equal(revGood.data.card.reps, 1);
  assert.equal(revGood.data.card.interval_days, 1);
  assert.ok(revGood.data.xpAwarded > 0);

  // 12. Review with rating 'easy'
  const revEasy = await api('POST', `/api/flashcards/${customId}/review`, { rating: 'easy' });
  assert.equal(revEasy.status, 200);
  assert.equal(revEasy.data.card.reps, 2);
  assert.ok(revEasy.data.card.interval_days >= 3);

  // 14. Cloud Synchronization (cross-device import)
  const syncPayload = {
    lang: 'en',
    cards: [
      {
        front: 'Ubiquitous',
        back: 'Hamma joyda uchraydigan',
        hint: '/juːˈbɪk.wɪ.təs/',
        reps: 3,
        ease: 2.5,
        interval_days: 7,
        due_at: Date.now() + 7 * 86400000,
        lapses: 0
      }
    ]
  };
  const syncRes = await api('POST', '/api/flashcards/sync', syncPayload);
  assert.equal(syncRes.status, 200);
  assert.equal(syncRes.data.imported, 1);
  assert.ok(syncRes.data.cards.some((c) => c.front === 'Ubiquitous'));

  // 15. Search vocabulary flashcards
  // 15a. Search by front word
  const searchWord = await api('GET', '/api/flashcards?lang=en&q=serendipity');
  assert.equal(searchWord.status, 200);
  assert.equal(searchWord.data.cards.length, 1);
  assert.equal(searchWord.data.cards[0].front, 'Serendipity');

  // 15b. Search by translation back text
  const searchUz = await api('GET', '/api/flashcards?lang=en&q=uchraydigan');
  assert.equal(searchUz.status, 200);
  assert.equal(searchUz.data.cards.length, 1);
  assert.equal(searchUz.data.cards[0].front, 'Ubiquitous');

  // 15c. Search with no matches
  const searchEmpty = await api('GET', '/api/flashcards?lang=en&q=xyznotexisting999');
  assert.equal(searchEmpty.status, 200);
  assert.equal(searchEmpty.data.cards.length, 0);

  // 15d. Multi-deck search (?lang=all)
  const allDecks = await api('GET', '/api/flashcards?lang=all');
  assert.equal(allDecks.status, 200);
  assert.ok(allDecks.data.cards.length >= 2);
  assert.ok(allDecks.data.decks.length >= 1);
  assert.equal(allDecks.data.decks[0].lang, 'en');

  app.close();
});

