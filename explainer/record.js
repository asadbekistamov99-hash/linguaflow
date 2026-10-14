'use strict';
// DEMO VIDEO RECORDER. Drives the real app in a headless browser and records the screen with Uzbek captions.
// Usage: node explainer/record.js   (needs Playwright + ffmpeg; see explainer/README.md)
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const DATA = '/tmp/demo_db';
const PORT = 3222;
const BASE = `http://127.0.0.1:${PORT}`;
const DEBUG = process.argv.includes('--debug');
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- content lookup (for solving exercises on camera) ----
function loadLookup(lang) {
  const db = new DatabaseSync(path.join(DATA, 'linguaflow.db'), { readOnly: true });
  const concepts = db.prepare('SELECT uz,t FROM concepts').all().map((r) => ({ uz: r.uz, t: JSON.parse(r.t) }));
  const sentences = db.prepare('SELECT t FROM sentences').all().map((r) => JSON.parse(r.t)[lang]).filter(Boolean);
  db.close();
  const norm = (s) => String(s).trim().toLowerCase();
  return {
    uzOfTarget: (w) => (concepts.find((c) => norm(c.t[lang] || '') === norm(w)) || {}).uz,
    targetOfUz: (u) => (concepts.find((c) => norm(c.uz) === norm(u)) || {}).t?.[lang],
    uzInText: (txt) => concepts.filter((c) => c.t[lang] && txt.toLowerCase().includes(c.uz.toLowerCase())).sort((a, b) => b.uz.length - a.uz.length)[0],
    sentenceFor: (tokens) => { const key = [...tokens].sort().join('|'); return sentences.find((s) => [...s.split(/\s+/)].sort().join('|') === key); },
  };
}

const INIT = `(() => {
  // no real audio in the headless browser: pretend every voice exists and remember what would be spoken
  window.__spoken = [];
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    speak(u) { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 500); }, cancel() {},
    getVoices() { return ['en-US', 'ru-RU', 'de-DE', 'fr-FR', 'es-ES', 'ar-SA'].map((l) => ({ lang: l, name: 'demo' })); }, onvoiceschanged: null } });
  const css = '#__cap{opacity:0;position:fixed;left:50%;bottom:16px;transform:translateX(-50%);width:min(1120px,92%);z-index:2147483000;padding:12px 26px 14px;background:rgba(6,8,18,.9);border:1px solid rgba(255,255,255,.14);border-radius:18px;color:#fff;font:700 25px/1.3 Inter,system-ui,sans-serif;text-align:center;pointer-events:none;transition:opacity .4s;box-shadow:0 10px 40px rgba(0,0,0,.5)}'
    + '#__cap[data-pos=top]{bottom:auto;top:16px}'
+ '#__cap small{display:block;margin-top:6px;font:500 18px/1.4 Inter,system-ui,sans-serif;color:#c8cde0}'
    + '#__cap b{color:#7ee7ff}'
    + '#__card{opacity:0;position:fixed;inset:0;z-index:2147483100;display:grid;place-items:center;text-align:center;color:#fff;background:radial-gradient(circle at 30% 20%,#3b2a8f,#07080d 60%);font:700 64px/1.15 Inter,system-ui,sans-serif;transition:opacity .6s;pointer-events:none}'
    + '#__card small{display:block;margin-top:18px;font:500 26px/1.45 Inter,system-ui,sans-serif;color:#b9c0dc;max-width:900px}'
    + '#__cur{position:fixed;z-index:2147483200;width:26px;height:26px;margin:-4px 0 0 -4px;pointer-events:none;transition:transform .05s linear}'
    + '#__cur::before{content:"";position:absolute;inset:0;background:#fff;border:2px solid #111;clip-path:polygon(0 0,0 78%,24% 60%,40% 100%,54% 94%,38% 56%,72% 56%);filter:drop-shadow(0 2px 3px rgba(0,0,0,.5))}'
    + '.__rip{position:fixed;z-index:2147483150;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:3px solid #00d4ff;pointer-events:none;animation:__rip .6s ease-out forwards}'
    + '@keyframes __rip{to{transform:scale(4);opacity:0}}';
  function ensure() {
    if (!document.documentElement) return;
    if (!document.getElementById('__style')) { const s = document.createElement('style'); s.id = '__style'; s.textContent = css; document.documentElement.appendChild(s); }
    for (const id of ['__cap', '__card', '__cur']) if (!document.getElementById(id)) { const d = document.createElement('div'); d.id = id; document.documentElement.appendChild(d); }
    const saved = sessionStorage.getItem('__capstate');
    if (saved && !window.__restored) { window.__restored = true; const s = JSON.parse(saved); window.__cap(s.t, s.s, s.p); }
  }
  window.__cap = (t, s, pos) => { const c = document.getElementById('__cap'); if (!c) return; c.dataset.pos = pos || 'bottom'; c.style.opacity = t ? 1 : 0; c.innerHTML = t ? t + (s ? '<small>' + s + '</small>' : '') : ''; sessionStorage.setItem('__capstate', JSON.stringify({ t, s, p: pos })); };
  window.__card = (t, s) => { const c = document.getElementById('__card'); if (!c) return; c.style.opacity = t ? 1 : 0; c.innerHTML = t ? '<div>' + t + (s ? '<small>' + s + '</small>' : '') + '</div>' : ''; };
  document.addEventListener('mousemove', (e) => { const c = document.getElementById('__cur'); if (c) c.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; }, true);
  document.addEventListener('mousedown', (e) => { const r = document.createElement('div'); r.className = '__rip'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.documentElement.appendChild(r); setTimeout(() => r.remove(), 700); }, true);
  document.addEventListener('DOMContentLoaded', ensure); setInterval(ensure, 400); ensure();
})();`;

async function main() {
  // ---- demo server with canned AI ----
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--require', path.join(__dirname, 'ai-stub.js'), 'server.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, FIRST_USER_ADMIN: '0', GEMINI_API_KEY: 'demo', AI_PROVIDER: 'gemini', BACKUP_ENABLED: '0', RECOVERY_KEY: '' }, stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* starting */ } await sleep(200); }

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: OUT, size: { width: 1280, height: 720 } }, locale: 'uz-UZ' });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept('demo-parol-123'));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const t0 = Date.now();
  const timeline = [];
  let shots = 0;

  const cap = async (text, sub = '', hold = 0, pos = 'bottom') => {
    timeline.push({ at: Date.now() - t0, text: text.replace(/<[^>]+>/g, ''), sub: sub.replace(/<[^>]+>/g, '') });
    await page.evaluate(([t, s, p]) => window.__cap && window.__cap(t, s, p), [text, sub, pos]);
    if (hold) await sleep(hold);
  };
  const card = async (t, s, ms) => { await page.evaluate(([a, b]) => window.__card && window.__card(a, b), [t, s]); await sleep(ms); await page.evaluate(() => window.__card(null)); await sleep(700); };
  const shot = async (name) => { if (DEBUG) await page.screenshot({ path: path.join(OUT, `dbg-${String(++shots).padStart(2, '0')}-${name}.png`) }); };
  const move = async (loc) => {
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    const b = await loc.boundingBox();
    if (!b) throw new Error('no box');
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 22 });
  };
  const click = async (loc, wait = 450) => { await move(loc); await sleep(250); await loc.click({ timeout: 4000 }); await sleep(wait); };
  const typeInto = async (loc, text, delay = 45) => { await click(loc, 150); await loc.pressSequentially(text, { delay }); await sleep(300); };
  const scrollTo = async (sel, ms = 3200) => { await page.evaluate((s) => document.querySelector(s).scrollIntoView({ behavior: 'smooth', block: 'start' }), sel); await sleep(ms); };
  const scene = async (name, fn) => { try { await fn(); } catch (e) { console.log(`[scene ${name}] ${e.message.split('\n')[0]}`); await shot(`ERR-${name}`); } };

  const L = loadLookup('en');

  // ===== 0. title =====
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(1200);
  await card('LinguaFlow', "6 tilni bepul o'rganish platformasi<br>To'liq tanishuv: ro'yxatdan o'tishdan imtihongacha", 4200);

  // ===== 1. landing =====
  await scene('landing', async () => {
    await cap("Bosh sahifa", "Ingliz, rus, nemis, fransuz, ispan va arab tillari. Hozircha butunlay bepul, karta kerak emas.", 3800);
    await scrollTo('#tillar'); await cap("Tillar", "Ingliz tili C2 gacha, qolgan 5 til B2 gacha. Mashqlar imtihon uslubida (IELTS, Goethe, DELF, DELE, TORFL). Bu tayyorgarlik: rasmiy sertifikat emas.", 4800);
    await scrollTo('#imkoniyatlar'); await cap("Imkoniyatlar", "AI ustoz, gapirish mashqi, yozish tekshiruvi, aqlli takrorlash, imtihonga tayyorgarlik, XP va reyting.", 4800);
    await scrollTo('#yol'); await cap("Daraja yo'li A1 → C2", "Har bir bosqichda mavzu testlari va ichki tayyorgarlik sertifikati (rasmiy emas).", 4200);
    await scrollTo('#narxlar'); await cap("Narxlar", "Hozircha hammasi bepul. AI imkoniyatlari kunlik bepul limit bilan ishlaydi.", 4200);
    await scrollTo('#savollar'); await cap("Ko'p beriladigan savollar", "Sertifikat, AI aniqligi va ma'lumotlar xavfsizligi haqida ochiq javoblar.", 4200);
    await shot('landing');
  });

  // ===== 2. register =====
  await scene('register', async () => {
    await cap("1-qadam. Ro'yxatdan o'tish", "Ism, email va parol: bir daqiqa. Parol shifrlanadi, kirish xavfsiz cookie orqali.", 0);
    await page.goto(`${BASE}/app#/register`); await sleep(1400);
    const inputs = page.locator('form input');
    await typeInto(inputs.nth(0), 'Dilnoza'); await typeInto(inputs.nth(1), 'dilnoza@example.com'); await typeInto(inputs.nth(2), 'demo-parol-123');
    await shot('register');
    await click(page.locator('form button[type=submit]'), 1800);
    await cap("2-qadam. Tilni tanlang", "Istalgan vaqt boshqa tilga o'tish mumkin: har til uchun alohida progress.", 0);
    await shot('langpicker');
    await click(page.locator('.lang-card-btn', { hasText: 'Ingliz' }).first(), 1800);
  });

  // ===== 3. learn =====
  await scene('learn', async () => {
    await page.evaluate(() => { document.querySelectorAll('.lang-modal-bg').forEach((e) => e.remove()); });
    await page.goto(`${BASE}/app#/learn`); await sleep(1800);
    await cap("3-qadam. O'rganish yo'li", "Mavzular ketma-ket. Har 5 ta so'z — bitta dars, mavzu oxirida test (80% dan o'tish kerak).", 4200);
    await page.evaluate(() => window.scrollBy({ top: 520, behavior: 'smooth' })); await sleep(2200);
    await shot('learn');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); await sleep(1200);
  });

  // ===== 4. lesson =====
  await scene('lesson', async () => {
    await cap("4-qadam. Dars", "Yangi so'zlar → test → eshitib topish → yozish → juftlash → jumla tuzish. Javoblar serverda tekshiriladi.", 0, 'top');
    await click(page.locator('.node-btn').first(), 1600);
    await shot('lesson-start');
    for (let step = 0; step < 40; step++) {
      const foot = page.locator('.p-foot button.btn');
      if (!(await foot.count())) {
        const done = page.locator('button.btn-block', { hasText: 'Davom etish' });
        if (await done.count()) { await cap("Dars natijasi", "Yulduzlar, XP va kunlik seriya. Keyingi dars ochiladi.", 4200, 'top'); await shot('lesson-result'); await click(done, 1500); break; }
        await sleep(500); continue;
      }
      const info = await page.evaluate(() => {
        const b = document.querySelector('.p-body'); if (!b) return null;
        if (b.querySelector('.learn-card')) return { t: 'learn' };
        const h2 = (b.querySelector('h2') || {}).textContent || '';
        if (b.querySelector('.match')) return { t: 'match', left: [...b.querySelectorAll('.match .col:first-child .m-btn')].map((x) => x.textContent), right: [...b.querySelectorAll('.match .col:last-child .m-btn')].map((x) => x.textContent) };
        if (b.querySelector('.opts .opt')) { const bw = b.querySelector('.big-word'); return { t: 'opt', h2, word: bw ? bw.childNodes[0].textContent : null, opts: [...b.querySelectorAll('.opt')].map((x) => x.textContent.replace(/^\d+/, '')), spoken: (window.__spoken || []).slice(-1)[0] || null }; }
        if (b.querySelector('input.t-input')) return { t: 'type', h2 };
        if (b.querySelector('.o-pool')) return { t: 'order', tokens: [...b.querySelectorAll('.o-pool .o-tok')].map((x) => x.textContent) };
        return { t: '?' };
      });
      if (!info) { await sleep(400); continue; }
      const mainBtn = page.locator('.p-foot button.btn').first();
      if (info.t === 'learn') { await sleep(1800); await click(mainBtn, 700); continue; }
      if (info.t === 'opt') {
        let ans = null;
        if (info.word) ans = L.uzOfTarget(info.word);
        else if (info.spoken) ans = L.uzOfTarget(info.spoken);
        if (!ans) { const c = L.uzInText(info.h2); ans = c && c.t.en; }
        let idx = info.opts.findIndex((o) => o.trim().toLowerCase() === String(ans).trim().toLowerCase());
        if (idx < 0) idx = 0;
        await sleep(900); await click(page.locator('.p-body .opt').nth(idx), 500);
      } else if (info.t === 'type') {
        const c = L.uzInText(info.h2); const target = c ? c.t.en : 'hello';
        await typeInto(page.locator('input.t-input'), target, 70);
      } else if (info.t === 'match') {
        for (const l of info.left) {
          const uz = L.uzOfTarget(l); const ri = info.right.findIndex((r) => r.trim().toLowerCase() === String(uz).trim().toLowerCase());
          await click(page.locator('.match .col:first-child .m-btn', { hasText: l }).first(), 250);
          await click(page.locator('.match .col:last-child .m-btn').nth(ri < 0 ? 0 : ri), 250);
        }
      } else if (info.t === 'order') {
        const sentence = L.sentenceFor(info.tokens);
        const words = sentence ? sentence.split(/\s+/) : info.tokens;
        const used = new Set();
        for (const w of words) {
          const idx = info.tokens.findIndex((t, i) => t === w && !used.has(i)); used.add(idx);
          await click(page.locator('.o-pool .o-tok').nth(idx), 250);
        }
      }
      await click(mainBtn, 1100); // Tekshirish
      if (step === 4) await shot('lesson-feedback');
      await click(page.locator('.p-foot button.btn').first(), 600); // Davom etish
    }
  });

  // ===== 5. review + dictionary =====
  await scene('review', async () => {
    await page.goto(`${BASE}/app#/review`); await sleep(1500);
    await cap("5-qadam. Aqlli takrorlash", "O'rgangan so'zlar unutilishdan oldin qaytariladi (SM-2 jadvali). Faqat vaqti kelganlari so'raladi.", 4800);
    await shot('review');
    await page.goto(`${BASE}/app#/dictionary`); await sleep(1500);
    await cap("Lug'at", "O'rgangan so'zlaringiz: qidirish, tinglash va mustahkamlik ko'rsatkichi.", 4200);
    await shot('dictionary');
  });

  // ===== 6. games =====
  await scene('games', async () => {
    await page.goto(`${BASE}/app#/games`); await sleep(1800);
    await cap("6-qadam. O'yinlar", "Xotira, Blitz, So'z tuzish, Jumla quruvchi. Natijalar serverda tekshiriladi, kuniga 80 XP gacha; haftalik reyting bor.", 5200);
    await shot('games');
  });

  // ===== 7. practice =====
  await scene('practice', async () => {
    await page.goto(`${BASE}/app#/practice`); await sleep(1800);
    await cap("7-qadam. Imtihon mashqlari", "O'qish, eshitish, grammatika, lug'at: faqat tekshiruvchilar tasdiqlagan savollar. To'g'ri javob javob berilgandan keyin ko'rinadi.", 4800);
    await shot('practice');
    await click(page.locator('.btn-sm', { hasText: 'B1' }).first(), 500);
    await click(page.locator('.card', { hasText: "O'qish" }).locator('button', { hasText: 'Boshlash' }).first(), 1500);
    await cap("O'qish mashqi", "Matnni o'qing va savolga javob bering: darhol izoh chiqadi.", 0, 'top');
    for (let i = 0; i < 3; i++) {
      await sleep(1500);
      const opt = page.locator('.opts .opt').first(); if (!(await opt.count())) break;
      await click(opt, 1500); await page.evaluate(() => window.scrollBy({ top: 420, behavior: 'smooth' })); await sleep(2200); await shot(`practice-${i}`);
      const next = page.locator('button.btn-main', { hasText: /Keyingisi|Yakunlash/ }); if (await next.count()) await click(next.first(), 600);
    }
    await page.goto(`${BASE}/app#/practice`); await sleep(800);
  });

  // ===== 8. writing =====
  await scene('writing', async () => {
    await page.goto(`${BASE}/app#/writing`); await sleep(1800);
    await cap("8-qadam. Yozish (AI tekshiruvi)", "Mavzu tanlang yoki o'zingiznikini yozing. AI 4 mezon bo'yicha baholaydi. Quyidagi natija NAMUNA.", 0);
    await typeInto(page.locator('input[placeholder*="mavzu"]'), 'Describe your last weekend.', 40);
    const essay = "Last weekend was very nice for me. On Saturday I go to the market with my mother and we buy fresh fruits and vegetables. After that we cooked a big lunch for all family. On Sunday I meet my friends in the park. We played football and we talk about our plans for summer. In the evening I was tired but happy. I think weekends are important because we can rest and spend time with people we love. Next weekend I want to visit my grandparents.";
    await typeInto(page.locator('textarea'), essay, 12);
    await shot('writing-typed');
    await click(page.locator('button', { hasText: 'Baholash' }), 3500);
    await cap("AI natijasi (namuna)", "Har mezon 0–5, taxminiy daraja, xatolar va tuzatishlar o'zbekcha. Bu rasmiy baho emas.", 0);
    await page.evaluate(() => window.scrollBy({ top: 520, behavior: 'smooth' })); await sleep(5200);
    await shot('writing-result');
  });

  // ===== 9. speaking =====
  await scene('speaking', async () => {
    await page.goto(`${BASE}/app#/speaking`); await sleep(1800);
    await cap("9-qadam. Gapirish", "Mikrofonda javob bering: nutq brauzerda matnga aylantiriladi. Talaffuz baholanmaydi; matn ravonlik, lug'at va grammatika bo'yicha tekshiriladi.", 0);
    await typeInto(page.locator('textarea'), "Last weekend I went to the park with my friends. We played football and then we had lunch together. I liked it because the weather was sunny and everybody was happy.", 18);
    await shot('speaking-typed');
    await click(page.locator('button', { hasText: 'Baholash' }), 3500);
    await cap("AI natijasi (namuna)", "So'z/daqiqa tezligi ham hisoblanadi.", 0);
    await page.evaluate(() => window.scrollBy({ top: 420, behavior: 'smooth' })); await sleep(4800);
    await shot('speaking-result');
  });

  // ===== 10. mock =====
  await scene('mock', async () => {
    await page.goto(`${BASE}/app#/mock`); await sleep(1600);
    await cap("10-qadam. Mock imtihon", "Vaqtli imtihon: grammatika, lug'at, o'qish, eshitish. Server baholaydi.", 3600);
    await click(page.locator('button', { hasText: /^B2$/ }).first(), 400);
    await click(page.locator('button.btn-main', { hasText: 'Boshlash' }).first(), 1500);
    await shot('mock-start');
    const groups = await page.locator('.card .opts').count();
    for (let i = 0; i < Math.min(groups, 6); i++) await click(page.locator('.card .opts').nth(i).locator('.opt').nth(i % 3), 250);
    await cap("Natija", "Bo'limlar bo'yicha ball va ingliz tilida taxminiy IELTS-uslubidagi ball. Rasmiy natija emas.", 0, 'top');
    await click(page.locator('button', { hasText: 'Topshirish' }), 2500);
    await shot('mock-result'); await sleep(4200);
  });

  // ===== 11. profile =====
  await scene('profile', async () => {
    await page.goto(`${BASE}/app#/profile`); await sleep(1800);
    await cap("11-qadam. Profil", "XP, daraja, kunlik seriya, nishonlar va kunlik maqsad. Tungi/kunduzgi tema. Hisobni istalgan vaqt o'chirish mumkin.", 5200);
    await page.evaluate(() => window.scrollBy({ top: 500, behavior: 'smooth' })); await sleep(3000);
    await shot('profile');
  });

  // ===== outro =====
  await cap('', '');
  await card("Eslatma", "LinguaFlow hozir sinov bosqichida va butunlay bepul.<br>AI baholash taxminiy; ballar rasmiy IELTS/CEFR natijasi emas.<br>Kontentni ona tilida so'zlashuvchi tekshiruvchilar tasdiqlaydi.", 7000);
  await card("LinguaFlow", "Bepul boshlang", 3500);

  const video = page.video();
  await ctx.close();
  const webm = await video.path();
  await browser.close();
  server.kill();
  fs.copyFileSync(webm, path.join(OUT, 'linguaflow-explainer.webm'));
  fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify(timeline, null, 1));
  console.log('page errors:', errors.slice(0, 5));
  console.log('done:', webm);
}
main().catch((e) => { console.error(e); process.exit(1); });
