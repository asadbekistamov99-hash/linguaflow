'use strict';
(() => {
  // ---------- tiny DOM helpers (all text goes through textContent: XSS-safe) ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
    return el;
  }
  const $ = (s, r = document) => r.querySelector(s);
  const root = $('#root');
  const mount = (...nodes) => { root.replaceChildren(...nodes.flat(Infinity)); };
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  async function api(method, url, body) {
    const r = await fetch(url, { method, headers: method !== 'GET' ? { 'content-type': 'application/json' } : {}, body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined, credentials: 'same-origin' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.error || 'Xatolik'); e.status = r.status; throw e; }
    return data;
  }

  // ---------- storage, theme, sound, speech ----------
  const LS = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };
  let muted = LS.get('lf_mute') === '1';
  function applyTheme(mode) {
    const dark = mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark || mode === undefined ? 'dark' : 'light';
    const m = $('meta[name=theme-color]'); if (m) m.content = dark ? '#07080d' : '#f4f5fb';
  }
  const themeMode = () => LS.get('lf_theme') || 'dark';
  applyTheme(themeMode());

  let actx;
  function beep(freqs, dur = 0.12) {
    if (muted) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      let t = actx.currentTime;
      for (const f of freqs) {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = 'sine'; o.frequency.value = f; g.gain.value = 0.07;
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur); t += dur * 0.9;
      }
    } catch { /* audio unavailable */ }
  }
  const sfx = { ok: () => beep([660, 880]), bad: () => beep([220, 180], 0.18), done: () => beep([523, 659, 784, 1046], 0.14), tick: () => beep([880], 0.05) };

  function speak(text, lang) {
    if (!('speechSynthesis' in window)) { toast("Brauzeringiz ovozli o'qishni qo'llamaydi"); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang; u.rate = 0.85;
    const v = speechSynthesis.getVoices().find((x) => x.lang === lang) || speechSynthesis.getVoices().find((x) => x.lang.startsWith(lang.slice(0, 2)));
    if (v) u.voice = v;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }

  // ---------- state ----------
  const S = { user: null, langs: [], course: null, config: null };
  const langMeta = (code) => S.langs.find((l) => l.code === code);
  const stars = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

  async function refreshUser() { S.user = (await api('GET', '/api/me')).user; }
  async function loadLangs() { S.langs = (await api('GET', '/api/languages')).languages; }
  async function loadCourse() {
    S.course = await api('GET', `/api/courses/${S.user.currentLang}`);
    document.documentElement.style.setProperty('--lang', S.course.lang.color);
  }

  // ---------- router ----------
  const routes = {
    '/learn': renderLearn, '/review': renderReview, '/games': renderGames, '/dictionary': renderDictionary,
    '/tutor': renderTutor, '/leaderboard': renderLeaderboard, '/profile': renderProfile,
  };
  const NAV = [
    ['/learn', '🏠', "O'rganish"], ['/review', '🧠', 'Takrorlash'], ['/games', '🎮', "O'yinlar"], ['/dictionary', '📚', "Lug'at"],
    ['/tutor', '🤖', 'AI ustoz'], ['/leaderboard', '🏆', 'Reyting'], ['/profile', '👤', 'Profil'],
  ];
  const TABS = ['/learn', '/review', '/games', '/leaderboard', '/profile'];

  function parseHash() {
    const [path, query = ''] = (location.hash.slice(1) || '/learn').split('?');
    return { path, params: new URLSearchParams(query) };
  }

  async function route() {
    const { path, params } = parseHash();
    if (!S.user) {
      if (path === '/register') return renderAuth('register', params.get('email') || '');
      return renderAuth('login');
    }
    if (path === '/login' || path === '/register') { location.hash = '#/learn'; return; }
    try { await (routes[path] || renderLearn)(path); } catch (e) {
      if (e.status === 401 || e.status === 403) { S.user = null; toast(e.message); return renderAuth('login'); }
      toast(e.message);
    }
  }
  addEventListener('hashchange', route);

  // ---------- auth ----------
  function renderAuth(mode, presetEmail = '') {
    const isReg = mode === 'register';
    const err = h('div', { class: 'form-err', role: 'alert' });
    const name = h('input', { type: 'text', autocomplete: 'name', required: true, maxlength: 40, placeholder: 'Ismingiz' });
    const email = h('input', { type: 'email', autocomplete: 'email', required: true, placeholder: 'email@example.com', value: presetEmail });
    const pass = h('input', { type: 'password', autocomplete: isReg ? 'new-password' : 'current-password', required: true, minlength: 8, placeholder: isReg ? 'Kamida 8 belgi' : 'Parol' });
    const btn = h('button', { class: 'btn btn-main btn-block', type: 'submit' }, isReg ? "Ro'yxatdan o'tish" : 'Kirish');
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); err.textContent = ''; btn.disabled = true;
        try {
          const body = { email: email.value, password: pass.value, ...(isReg ? { name: name.value } : {}) };
          S.user = (await api('POST', isReg ? '/api/auth/register' : '/api/auth/login', body)).user;
          await loadLangs();
          location.hash = '#/learn'; route();
        } catch (ex) { err.textContent = ex.message; } finally { btn.disabled = false; }
      },
    },
      isReg ? h('label', { class: 'field' }, h('span', {}, 'Ism'), name) : null,
      h('label', { class: 'field' }, h('span', {}, 'Email'), email),
      h('label', { class: 'field' }, h('span', {}, 'Parol'), pass),
      err, btn);
    mount(h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' },
      h('a', { href: '/', class: 'logo' }, h('span', { class: 'logo-mark' }, 'L'), 'LinguaFlow'),
      h('h1', {}, isReg ? 'Hisob yarating' : 'Xush kelibsiz!'),
      h('p', { class: 'sub' }, isReg ? "Bepul boshlang va 6 ta tilni o'rganing." : 'Davom etish uchun hisobingizga kiring.'),
      form,
      h('div', { class: 'auth-switch' }, isReg ? 'Hisobingiz bormi? ' : "Hisobingiz yo'qmi? ", h('a', { href: isReg ? '#/login' : '#/register' }, isReg ? 'Kirish' : "Ro'yxatdan o'tish")))));
    (isReg ? name : email).focus();
  }

  // ---------- shell ----------
  async function shell(active, content, { wide = false } = {}) {
    const due = S.course ? S.course.due : 0;
    const items = [...NAV, ...(S.user.isAdmin ? [['/admin', '🛠️', 'Admin panel']] : [])];
    const link = (p, cls, kids) => (p === '/admin' ? h('a', { href: '/admin', class: cls }, kids) : h('a', { href: '#' + p, class: cls + (active === p ? ' on' : '') }, kids));
    const side = h('aside', { class: 'side' },
      h('a', { href: '#/learn', class: 'logo' }, h('span', { class: 'logo-mark' }, 'L'), 'LinguaFlow'),
      items.map(([p, ic, label]) => link(p, 'nav-item', [h('span', { class: 'ic' }, ic), label, p === '/review' && due ? h('span', { class: 'count' }, due) : null])));
    const lm = langMeta(S.user.currentLang);
    const top = h('header', { class: 'topbar' },
      h('div', { class: 'logo-sm' }, h('span', { class: 'logo-mark' }, 'L')),
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
        h('button', { class: 'chip lang', title: "Tilni o'zgartirish", onclick: openLangPicker }, h('span', { class: 'fl' }, lm ? lm.flag : '🌍'), lm ? lm.name : 'Til'),
        h('span', { class: 'chip fire', title: 'Ketma-ket kunlar' }, '🔥 ', S.user.streak),
        h('span', { class: 'chip xp', title: 'Jami XP' }, '⭐ ', S.user.xp)));
    const tabs = h('nav', { class: 'tabbar' }, TABS.map((p) => { const [, ic, label] = NAV.find((n) => n[0] === p); return link(p, 'tab', [h('span', { class: 'ic' }, ic), label, p === '/review' && due ? h('span', { class: 'count' }, due) : null]); }));
    const note = S.config && S.config.announcement ? h('div', { class: 'announce ' + S.config.announcement.level }, '📢 ', S.config.announcement.text) : null;
    mount(h('div', { class: 'shell' }, side, h('div', { class: 'main' }, top, h('main', { class: 'page' + (wide ? ' wide' : '') }, note, content)), tabs));
    window.scrollTo(0, 0);
  }

  function openLangPicker() {
    const close = () => bg.remove();
    const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) close(); } },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
        h('h2', {}, "Qaysi tilni o'rganasiz?"),
        h('div', { class: 'lang-pick' }, S.langs.map((l) => h('button', {
          class: 'lang-opt' + (l.code === S.user.currentLang ? ' on' : ''), style: { '--c': l.color },
          onclick: async () => { try { S.user = (await api('PATCH', '/api/me', { currentLang: l.code })).user; close(); await loadCourse(); route(); } catch (e) { toast(e.message); } },
        }, h('span', { class: 'fl' }, l.flag), h('span', {}, h('b', {}, l.name), h('small', {}, `${l.native} · ${l.done}/${l.lessons} dars`)))))));
    document.body.append(bg);
  }

  // ---------- learn ----------
  function ring(pct, label, sub) {
    const r = 36, c = 2 * Math.PI * r;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', 84); svg.setAttribute('height', 84); svg.setAttribute('viewBox', '0 0 84 84');
    svg.innerHTML = `<circle cx="42" cy="42" r="${r}" fill="none" stroke="var(--ring-bg)" stroke-width="8"/><circle cx="42" cy="42" r="${r}" fill="none" stroke="url(#g)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.min(pct, 1))}"/><defs><linearGradient id="g"><stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#00d4ff"/></linearGradient></defs>`;
    return h('div', { class: 'ring' }, svg, h('div', { class: 'num' }, h('span', {}, label, h('small', {}, sub))));
  }

  async function renderLearn() {
    await Promise.all([refreshUser(), loadLangs(), api('GET', '/api/config').then((c) => { S.config = c; }).catch(() => {})]);
    await loadCourse();
    const u = S.user, c = S.course;
    const all = c.units.flatMap((x) => x.lessons);
    const next = all.find((l) => l.state === 'available');
    const doneN = all.filter((l) => l.state === 'done').length;

    const goalMsg = u.dailyXp >= u.dailyGoal ? 'Kunlik maqsad bajarildi! 🎉' : `Bugun yana ${u.dailyGoal - u.dailyXp} XP to'plang`;
    const hero = h('div', { class: 'hero-row' },
      h('div', {}, h('h2', {}, `Salom, ${u.name.split(' ')[0]}! 👋`), h('p', {}, goalMsg), h('p', {}, `${c.lang.name}: ${doneN}/${all.length} dars · ${c.words.learned} so'z o'rganilgan`)),
      ring(u.dailyXp / u.dailyGoal, `${Math.min(u.dailyXp, 999)}`, `/ ${u.dailyGoal} XP`));
    const quick = h('div', { class: 'quick' },
      h('button', { class: 'q-btn', onclick: startPlacement }, h('span', {}, '🧭'), 'Daraja testi'),
      h('a', { class: 'q-btn', href: '#/games' }, h('span', {}, '🎮'), "O'yinlar"),
      h('a', { class: 'q-btn', href: '#/dictionary' }, h('span', {}, '📚'), "Lug'at"),
      h('a', { class: 'q-btn', href: '#/tutor' }, h('span', {}, '🤖'), 'AI ustoz'));
    const placeBanner = doneN === 0 ? h('div', { class: 'banner place' }, h('span', { class: 'em' }, '🧭'),
      h('div', { class: 'tx' }, h('b', {}, "Bilasizmi? Daraja testidan o'ting"), h('small', {}, "Biladigan mavzularni o'tkazib yuborasiz")),
      h('button', { class: 'btn btn-ghost', onclick: startPlacement }, 'Boshlash')) : null;
    const banner = c.due ? h('div', { class: 'banner' }, h('span', { class: 'em' }, '🧠'),
      h('div', { class: 'tx' }, h('b', {}, `${c.due} ta so'z takrorlashni kutyapti`), h('small', {}, 'Unutishdan oldin qisqa takrorlang')),
      h('a', { class: 'btn btn-main', href: '#/review' }, 'Takrorlash')) : null;

    const node = (l, label, symbol) => h('div', { class: `node ${l.state}${l.kind === 'test' ? ' test' : ''}` },
      next && next.id === l.id ? h('span', { class: 'start-tip' }, 'BOSHLASH') : null,
      h('button', {
        class: 'node-btn', 'aria-label': `${label} — ${l.state}`,
        onclick: () => (l.state === 'locked' ? toast(l.kind === 'test' ? 'Avval mavzu darslarini tugating 🔒' : 'Avval oldingi darsni tugating 🔒') : startLesson(l.id)),
      }, l.state === 'locked' ? '🔒' : symbol),
      h('div', { class: 'st' }, l.state === 'done' ? stars(l.stars) : ''), h('div', { class: 'label' }, label));
    const units = c.units.map((un) => h('section', { class: 'unit' },
      h('div', { class: 'unit-head' }, h('span', { class: 'em' }, un.emoji), h('div', {}, h('h3', {}, un.title), h('small', {}, `${un.lessons.filter((l) => l.state === 'done').length}/${un.lessons.length} dars`))),
      h('div', { class: 'nodes' }, un.lessons.map((l) => node(l, l.title, l.state === 'done' ? '✓' : l.index)), un.test ? node(un.test, 'Mavzu testi', un.test.state === 'done' ? '👑' : '🏁') : null)));
    await shell('/learn', [hero, quick, placeBanner, banner, units]);
  }

  // ---------- practice player ----------
  const playerUi = { el: null };
  function closePlayer() { if (playerUi.el) { playerUi.el.remove(); playerUi.el = null; document.body.style.overflow = ''; if ('speechSynthesis' in window) speechSynthesis.cancel(); } }
  function mountPlayer(...kids) {
    closePlayer();
    playerUi.el = h('div', { class: 'player' }, ...kids);
    document.body.append(playerUi.el); document.body.style.overflow = 'hidden';
    return playerUi.el;
  }
  const mountPlayerLoading = () => mountPlayer(h('div', { class: 'spinner' }));

  async function startLesson(id) {
    mountPlayerLoading();
    try { const s = await api('POST', `/api/lessons/${encodeURIComponent(id)}/start`, {}); runPlayer(s, { kind: s.lesson.kind, title: s.lesson.title }); } catch (e) { closePlayer(); toast(e.message); }
  }
  async function startPlacement() {
    mountPlayerLoading();
    try { const s = await api('POST', '/api/placement/start', { lang: S.user.currentLang }); runPlayer(s, { kind: 'placement', title: 'Daraja testi' }); } catch (e) { closePlayer(); toast(e.message); }
  }
  async function startReview() {
    mountPlayerLoading();
    try {
      const s = await api('POST', '/api/review/start', { lang: S.user.currentLang });
      if (s.empty) { closePlayer(); toast("Takrorlash uchun so'z yo'q"); return route(); }
      runPlayer(s, { kind: 'review', title: 'Takrorlash' });
    } catch (e) { closePlayer(); toast(e.message); }
  }

  async function renderReview() {
    await refreshUser(); await loadCourse();
    const c = S.course;
    const content = c.due
      ? h('div', { class: 'empty' }, h('span', { class: 'em' }, '🧠'), h('h1', {}, `${c.due} ta so'z tayyor`), h('p', { class: 'lead' }, "Aqlli takrorlash so'zlarni aynan unutishdan oldin qaytaradi."),
        h('button', { class: 'btn btn-main', onclick: startReview }, 'Takrorlashni boshlash'))
      : h('div', { class: 'empty' }, h('span', { class: 'em' }, '✨'), h('h1', {}, "Hozircha takrorlash yo'q"), h('p', { class: 'lead' }, "Yangi darslarni tugatsangiz, so'zlar shu yerda paydo bo'ladi."),
        h('a', { class: 'btn btn-main', href: '#/learn' }, "Darsga o'tish"));
    await shell('/review', [h('h1', {}, 'Takrorlash'), h('p', { class: 'lead' }, `${S.course.lang.name} so'zlari`), content]);
  }

  // Word-order board shared by the lesson exercise and the sentence-builder game.
  function tokenBoard(tokens, dir, onChange, { speakLang } = {}) {
    const answer = []; // indices into tokens
    const line = h('div', { class: 'o-line', dir });
    const pool = h('div', { class: 'o-pool', dir });
    let locked = false;
    const render = () => {
      line.replaceChildren(...answer.map((i) => h('button', { class: 'o-tok', onclick: () => { if (locked) return; answer.splice(answer.indexOf(i), 1); render(); } }, tokens[i])));
      pool.replaceChildren(...tokens.map((t, i) => h('button', {
        class: 'o-tok' + (answer.includes(i) ? ' ghost' : ''), disabled: answer.includes(i),
        onclick: () => { if (locked) return; answer.push(i); if (speakLang) speak(t, speakLang); render(); },
      }, t)));
      onChange(answer.length === tokens.length ? answer.map((i) => tokens[i]) : null);
    };
    render();
    return {
      el: h('div', { class: 'o-board' }, line, pool),
      lock(cls) { locked = true; if (cls) line.classList.add(cls); pool.querySelectorAll('button').forEach((b) => { b.disabled = true; }); },
      reset() { answer.length = 0; locked = false; line.classList.remove('ok', 'bad'); render(); },
      shake() { line.classList.add('bad'); setTimeout(() => line.classList.remove('bad'), 500); },
    };
  }

  function runPlayer(session, meta) {
    const { sid } = session;
    const queue = session.exercises.slice();
    const totalGradable = session.total;
    const solvedIds = new Set();
    let finished = false;
    let current = null, checkFn = null, readyAnswer = null, advance = null;

    const barFill = h('i');
    const body = h('div', { class: 'p-body' });
    const fbBox = h('div', { class: 'fb' });
    const mainBtn = h('button', { class: 'btn btn-main', disabled: true }, 'Tekshirish');
    const foot = h('div', { class: 'p-foot' }, h('div', { class: 'p-foot-in' }, fbBox, mainBtn));
    const exit = () => { if (finished || confirm("Chiqsangiz, bu mashq natijasi saqlanmaydi. Chiqasizmi?")) { removeEventListener('keydown', keyHandler); closePlayer(); route(); } };
    const el = mountPlayer(
      h('div', { class: 'p-top' }, h('button', { class: 'p-close', 'aria-label': 'Yopish', onclick: exit }, '✕'), h('div', { class: 'bar' }, barFill), meta.kind === 'test' ? h('span', { class: 'chip' }, '🏁 Test') : meta.kind === 'placement' ? h('span', { class: 'chip' }, '🧭 Daraja') : null),
      body, foot);

    const setProgress = () => { barFill.style.width = `${Math.round((solvedIds.size / totalGradable) * 100)}%`; };
    const setReady = (answer) => { readyAnswer = answer; mainBtn.disabled = answer == null; };
    const resetFoot = () => { foot.className = 'p-foot'; fbBox.replaceChildren(); mainBtn.className = 'btn btn-main'; mainBtn.textContent = 'Tekshirish'; mainBtn.disabled = true; readyAnswer = null; };

    function showFeedback(ok, expected) {
      foot.className = 'p-foot ' + (ok ? 'ok' : 'bad');
      fbBox.replaceChildren(ok ? h('b', {}, ['Ajoyib!', "To'g'ri!", 'Barakalla!', "Zo'r!"][Math.floor(Math.random() * 4)])
        : h('span', {}, h('b', {}, 'Xato'), expected ? h('small', {}, `To'g'ri javob: ${expected}`) : h('small', {}, "To'g'ri juftliklarni ko'ring")));
      mainBtn.className = 'btn ' + (ok ? 'btn-ok' : 'btn-bad');
      mainBtn.textContent = 'Davom etish'; mainBtn.disabled = false;
      (ok ? sfx.ok : sfx.bad)();
    }

    mainBtn.addEventListener('click', async () => {
      if (advance) { const f = advance; advance = null; return f(); }
      if (readyAnswer == null || !current) return;
      mainBtn.disabled = true;
      const e = current;
      try {
        const r = await api('POST', `/api/sessions/${sid}/answer`, { exId: e.id, answer: readyAnswer });
        if (checkFn) checkFn(r);
        if (r.correct) solvedIds.add(e.id); else queue.push(e);
        showFeedback(r.correct, r.expected);
        setProgress();
        advance = next;
      } catch (ex) { toast(ex.message); mainBtn.disabled = false; }
    });

    function keyHandler(ev) {
      if (!playerUi.el || playerUi.el !== el) { removeEventListener('keydown', keyHandler); return; }
      if (ev.key === 'Enter' && !mainBtn.disabled) { ev.preventDefault(); mainBtn.click(); }
      else if (/^[1-4]$/.test(ev.key) && current && (current.type === 'mcq' || current.type === 'listen') && !advance && document.activeElement.tagName !== 'INPUT') {
        const b = body.querySelectorAll('.opt')[Number(ev.key) - 1]; if (b) b.click();
      }
    }
    addEventListener('keydown', keyHandler);

    async function finish() {
      finished = true; removeEventListener('keydown', keyHandler);
      body.replaceChildren(h('div', { class: 'spinner' })); foot.className = 'p-foot'; foot.replaceChildren();
      try {
        const res = await api('POST', `/api/sessions/${sid}/finish`, {});
        S.user = res.user;
        renderResult(res, meta);
      } catch (ex) { toast(ex.message); closePlayer(); route(); }
    }

    function next() {
      resetFoot(); checkFn = null; advance = null;
      if (!queue.length) return finish();
      current = queue.shift();
      body.replaceChildren(h('div', { class: 'p-inner' }, renderExercise(current)));
      body.scrollTop = 0;
    }

    function renderExercise(e) {
      const dirAttr = e.dir === 'rtl' ? 'rtl' : 'ltr';
      if (e.type === 'learn') {
        mainBtn.className = 'btn btn-main'; mainBtn.textContent = 'Davom etish'; mainBtn.disabled = false;
        advance = next; checkFn = null;
        setTimeout(() => speak(e.items[0].target, e.tts), 350);
        return [h('h2', {}, "Yangi so'zlar"),
          h('div', { class: 'learn-list' }, e.items.map((it) => h('div', { class: 'learn-card' },
            h('button', { class: 'speak', 'aria-label': 'Tinglash', onclick: () => speak(it.target, e.tts) }, '🔊'),
            h('div', { class: 'w' }, h('b', { dir: dirAttr }, it.target), h('small', {}, it.uz), it.tr ? h('em', {}, it.tr) : null))))];
      }
      if (e.type === 'mcq' || e.type === 'listen') {
        const isListen = e.type === 'listen';
        const btns = e.options.map((o, i) => h('button', {
          class: 'opt', dir: isListen || e.word ? 'ltr' : dirAttr,
          onclick: () => { if (advance) return; btns.forEach((b) => b.classList.remove('sel')); btns[i].classList.add('sel'); setReady(o); },
        }, h('span', { class: 'k' }, i + 1), o));
        checkFn = (r) => { btns.forEach((b, i) => { b.disabled = true; if (e.options[i] === r.expected) b.classList.add('ok'); else if (b.classList.contains('sel')) b.classList.add('bad'); b.classList.remove('sel'); }); };
        if (isListen) setTimeout(() => speak(e.speak, e.tts), 300);
        return [
          h('h2', {}, e.prompt),
          isListen ? h('button', { class: 'speak big', 'aria-label': 'Tinglash', onclick: () => speak(e.speak, e.tts) }, '🔊')
            : e.word ? [h('div', { class: 'big-word', dir: dirAttr }, e.word, h('button', { class: 'speak', 'aria-label': 'Tinglash', onclick: () => speak(e.word, e.tts) }, '🔊')), e.tr ? h('div', { class: 'tr' }, e.tr) : null] : null,
          h('div', { class: 'opts' }, btns)];
      }
      if (e.type === 'type') {
        const inp = h('input', { class: 't-input', type: 'text', dir: dirAttr, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: 80, placeholder: 'Javobni yozing…', 'aria-label': 'Javob' });
        inp.addEventListener('input', () => { if (!advance) setReady(inp.value.trim() ? inp.value : null); });
        checkFn = (r) => { inp.disabled = true; inp.classList.add(r.correct ? 'ok' : 'bad'); };
        setTimeout(() => inp.focus(), 100);
        return [h('h2', {}, e.prompt), inp, e.hint ? h('div', { class: 'hint' }, e.hint) : null];
      }
      if (e.type === 'order') {
        const board = tokenBoard(e.tokens, dirAttr, (ans) => { if (!advance) setReady(ans); }, { speakLang: e.tts });
        checkFn = (r) => { board.lock(r.correct ? 'ok' : 'bad'); if (r.correct && r.expected) speak(r.expected, e.tts); };
        return [h('h2', {}, e.prompt), board.el, h('div', { class: 'hint' }, "So'zlarni to'g'ri tartibda bosing. Olib tashlash uchun qayta bosing.")];
      }
      if (e.type === 'match') {
        const mapping = {};
        let selL = null;
        const slotOf = {};
        const COLORS = ['#7c5cff', '#00d4ff', '#ff4fa3', '#ffc94d', '#22d39a'];
        const L = e.left.map((t) => h('button', { class: 'm-btn', dir: dirAttr }, t));
        const R = e.right.map((t) => h('button', { class: 'm-btn' }, t));
        const paint = () => {
          const rightOwner = {};
          for (const [l, r] of Object.entries(mapping)) rightOwner[r] = l;
          L.forEach((b, i) => { const t = e.left[i]; const on = t in mapping; b.classList.toggle('sel', selL === t); b.style.borderColor = on ? COLORS[slotOf[t]] : ''; b.style.background = on ? COLORS[slotOf[t]] + '22' : ''; });
          R.forEach((b, i) => { const l = rightOwner[e.right[i]]; b.style.borderColor = l ? COLORS[slotOf[l]] : ''; b.style.background = l ? COLORS[slotOf[l]] + '22' : ''; });
          setReady(Object.keys(mapping).length === e.left.length ? { ...mapping } : null);
        };
        L.forEach((b, i) => b.addEventListener('click', () => {
          if (advance) return;
          const t = e.left[i];
          if (t in mapping) { delete mapping[t]; selL = null; } else { selL = selL === t ? null : t; speak(t, e.tts); }
          paint();
        }));
        R.forEach((b, i) => b.addEventListener('click', () => {
          if (advance || selL == null) return;
          const t = e.right[i];
          for (const [l, r] of Object.entries(mapping)) if (r === t) delete mapping[l];
          mapping[selL] = t;
          const used = new Set(Object.keys(mapping).filter((k) => k !== selL).map((k) => slotOf[k]));
          slotOf[selL] = [0, 1, 2, 3, 4].find((n) => !used.has(n));
          selL = null; paint();
        }));
        checkFn = (r) => {
          const d = r.detail || {};
          L.forEach((b, i) => { b.classList.remove('sel'); b.disabled = true; b.style.borderColor = d[e.left[i]] ? 'var(--ok)' : 'var(--bad)'; b.style.background = d[e.left[i]] ? 'rgba(34,211,154,.14)' : 'rgba(255,93,108,.14)'; });
          R.forEach((b) => { b.disabled = true; });
        };
        return [h('h2', {}, e.prompt), h('div', { class: 'match' }, h('div', { class: 'col' }, L), h('div', { class: 'col' }, R)),
          h('div', { class: 'hint' }, "Chapdagi so'zni, so'ng o'ngdagi tarjimasini tanlang. O'zgartirish uchun qayta bosing.")];
      }
      return [];
    }

    setProgress();
    next();
  }

  function confetti() {
    const colors = ['#7c5cff', '#00d4ff', '#ff4fa3', '#ffc94d', '#22d39a'];
    for (let i = 0; i < 60; i++) {
      const c = h('div', { class: 'confetti', style: { left: Math.random() * 100 + 'vw', background: colors[i % 5], animationDuration: 1.8 + Math.random() * 1.8 + 's', animationDelay: Math.random() * 0.6 + 's' } });
      document.body.append(c); setTimeout(() => c.remove(), 4500);
    }
  }

  const badgeList = (badges) => (badges && badges.length ? h('div', { class: 'new-badges' }, badges.map((b) => h('div', { class: 'new-badge' }, h('span', { class: 'em' }, b.emoji), h('div', {}, h('b', {}, `Yangi nishon: ${b.title}`), h('div', { class: 'muted' }, b.desc))))) : null);

  function renderResult(res, meta) {
    const pct = Math.round(res.accuracy * 100);
    const good = res.passed;
    if (good) { sfx.done(); confetti(); }
    const K = res.kind;
    const title = K === 'review' ? 'Takrorlash tugadi!' : K === 'placement' ? 'Daraja testi tugadi!' : K === 'test' ? (good ? "Test muvaffaqiyatli o'tildi!" : 'Test topshirilmadi') : good ? 'Dars tugadi!' : "Deyarli bo'ldi!";
    const sub = K === 'review' ? "So'zlar xotirangizda mustahkamlandi."
      : K === 'placement' ? (res.placedUnits ? `${res.placedUnits} ta mavzu o'tilgan deb hisoblandi (${res.markedLessons} ta dars ochildi) 🔓` : "Boshidan boshlaymiz — bu ham yaxshi!")
      : K === 'test' ? (good ? (res.firstTime ? 'Mavzu toji sizniki 👑' : "Yaxshi takrorlash!") : "Kamida 80% kerak. Mavzuni takrorlab, yana urinib ko'ring!")
      : good ? (res.firstTime ? 'Keyingi dars ochildi 🔓' : 'Yaxshi takrorlash!') : "Kamida 60% kerak. Yana bir urinib ko'ring!";
    mountPlayer(h('div', { class: 'p-body' }, h('div', { class: 'p-inner result' },
      h('div', { class: 'trophy' }, K === 'placement' ? '🧭' : K === 'test' && good ? '👑' : good ? '🏆' : '💪'), h('h1', {}, title), h('p', { class: 'lead' }, sub),
      (K === 'lesson' || K === 'test') && good ? h('div', { class: 'stars-big' }, [1, 2, 3].map((i) => h('span', { class: i <= res.stars ? '' : 'off' }, '★'))) : null,
      h('div', { class: 'res-stats' },
        h('div', { class: 'stat-tile' }, h('b', {}, `+${res.xp}`), h('span', {}, 'XP')),
        h('div', { class: 'stat-tile' }, h('b', {}, `${pct}%`), h('span', {}, 'Aniqlik')),
        h('div', { class: 'stat-tile' }, h('b', {}, `🔥 ${res.streak}`), h('span', {}, 'Seriya'))),
      badgeList(res.badges),
      h('button', { class: 'btn btn-main btn-block', onclick: () => { closePlayer(); route(); } }, 'Davom etish'))));
  }

  // ---------- games ----------
  const GAME_META = {
    memory: { emoji: '🧩', title: 'Xotira', desc: "16 ta kartada so'z va uning tarjimasini juftlang. Kam harakat — ko'p XP." },
    blitz: { emoji: '⚡', title: 'Blitz', desc: "60 soniyada iloji boricha ko'p so'zning tarjimasini toping." },
    scramble: { emoji: '🔤', title: "So'z tuzish", desc: "Aralashgan harflardan so'zni yig'ing. Vaqt: 90 soniya." },
    builder: { emoji: '🧱', title: 'Jumla quruvchi', desc: "Aralashgan so'zlardan to'g'ri jumla tuzing. Vaqt: 3 daqiqa." },
  };

  async function renderGames() {
    await refreshUser(); await loadCourse();
    const keys = Object.keys(GAME_META);
    const best = await Promise.all(keys.map((k) => api('GET', `/api/games/highscores?game=${k}`).catch(() => ({ best: 0, rows: [] }))));
    const cards = keys.map((k, i) => h('div', { class: 'game-card' },
      h('div', { class: 'g-em' }, GAME_META[k].emoji), h('h3', {}, GAME_META[k].title), h('p', {}, GAME_META[k].desc),
      h('div', { class: 'g-best' }, best[i].best ? `Rekordingiz: ${best[i].best}` : 'Hali o\'ynamadingiz'),
      h('div', { style: { display: 'flex', gap: '8px' } },
        h('button', { class: 'btn btn-main', onclick: () => startGame(k) }, "O'ynash"),
        h('button', { class: 'btn btn-ghost', onclick: () => showHighscores(k, GAME_META[k].title) }, '🏆 Reyting'))));
    await shell('/games', [h('h1', {}, "O'yinlar"), h('p', { class: 'lead' }, `${S.course.lang.flag} ${S.course.lang.name} so'zlari bilan o'ynang. O'yinlardan kuniga 80 XP gacha olish mumkin.`), h('div', { class: 'games-grid' }, cards)], { wide: true });
  }

  async function showHighscores(game, title) {
    try {
      const { rows } = await api('GET', `/api/games/highscores?game=${game}`);
      const close = () => bg.remove();
      const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) close(); } },
        h('div', { class: 'modal' }, h('h2', {}, `${title} — haftalik reyting`),
          rows.length ? rows.map((r) => h('div', { class: 'lb-row' + (r.me ? ' me' : '') }, h('div', { class: 'lb-rank' }, r.rank), h('div', { class: 'lb-name' }, r.name, r.me ? ' (siz)' : ''), h('div', { class: 'lb-xp' }, r.score)))
            : h('div', { class: 'empty' }, 'Hali natijalar yo\'q — birinchi bo\'ling!'),
          h('button', { class: 'btn btn-ghost btn-block', style: { marginTop: '14px' }, onclick: close }, 'Yopish')));
      document.body.append(bg);
    } catch (e) { toast(e.message); }
  }

  // Full-screen shell for a game. Returns a controller; timers registered with ctl.timer() are cleared on close.
  function openGame(title) {
    const timers = new Set();
    const status = h('div', { class: 'g-status' });
    const stage = h('div', { class: 'g-stage' });
    const ctl = {
      stage, status, alive: true,
      timer(fn, ms) { const id = setInterval(fn, ms); timers.add(id); return id; },
      clear(id) { clearInterval(id); timers.delete(id); },
      close() { ctl.alive = false; timers.forEach(clearInterval); timers.clear(); closePlayer(); route(); },
      setStatus(...kids) { status.replaceChildren(...kids); },
    };
    mountPlayer(
      h('div', { class: 'p-top' }, h('button', { class: 'p-close', 'aria-label': 'Yopish', onclick: ctl.close }, '✕'), h('h2', { class: 'g-title' }, title), status),
      h('div', { class: 'p-body' }, h('div', { class: 'p-inner g-inner' }, stage)));
    return ctl;
  }

  async function gameResult(ctl, game, lines, payload, replay) {
    ctl.alive = false; ctl.timers && ctl.timers.clear && ctl.timers.clear();
    let res = null, err = null;
    try { res = await api('POST', '/api/games/score', { game, lang: S.user.currentLang, ...payload }); if (res.user) S.user = res.user; } catch (e) { err = e.message; }
    if (res && res.xp > 0) { sfx.done(); confetti(); }
    ctl.stage.replaceChildren(h('div', { class: 'result' },
      h('div', { class: 'trophy' }, GAME_META[game].emoji), h('h1', {}, GAME_META[game].title),
      h('div', { class: 'res-stats' }, lines.map(([v, l]) => h('div', { class: 'stat-tile' }, h('b', {}, v), h('span', {}, l)))),
      res ? h('p', { class: 'lead' }, `Ball: ${res.score}${res.best ? ` · Rekord: ${res.best}` : ''}`) : null,
      res ? h('p', { class: 'xp-gain' }, res.xp > 0 ? `+${res.xp} XP` : 'Bugungi o\'yin XP limiti tugadi') : null,
      err ? h('p', { class: 'form-err' }, err) : null,
      res ? badgeList(res.badges) : null,
      h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' } },
        h('button', { class: 'btn btn-main', onclick: replay }, "Qayta o'ynash"), h('button', { class: 'btn btn-ghost', onclick: ctl.close }, 'Chiqish'))));
  }

  async function startGame(game) {
    const ctl = openGame(GAME_META[game].title);
    ctl.stage.replaceChildren(h('div', { class: 'spinner' }));
    try {
      if (game === 'memory') await gameMemory(ctl);
      else if (game === 'blitz') await gameBlitz(ctl);
      else if (game === 'scramble') await gameScramble(ctl);
      else await gameBuilder(ctl);
    } catch (e) { ctl.alive = false; toast(e.message); closePlayer(); route(); }
  }
  const replayOf = (ctl, game) => () => { ctl.alive = false; startGame(game); };
  const wordsFor = (n) => api('GET', `/api/games/words?lang=${S.user.currentLang}&n=${n}`);
  const fmtTime = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

  async function gameMemory(ctl) {
    const { lang, words } = await wordsFor(8);
    const pick = words.slice(0, 8);
    const cards = shuffle(pick.flatMap((w) => [{ id: w.id, kind: 't', text: w.target, w }, { id: w.id, kind: 'u', text: w.uz, w }]));
    let flipped = [], matched = 0, moves = 0, lock = false, t0 = 0, timeMs = 0;
    const els = cards.map((c, i) => {
      const b = h('button', { class: 'mem-card', 'aria-label': 'Karta', dir: c.kind === 't' ? lang.dir : 'ltr' },
        h('span', { class: 'mem-front' }, '?'), h('span', { class: 'mem-back' }, c.text));
      b.addEventListener('click', async () => {
        if (lock || !ctl.alive || b.classList.contains('flip') || b.classList.contains('done')) return;
        if (!t0) { t0 = Date.now(); tickId = ctl.timer(() => { timeMs = Date.now() - t0; ctl.setStatus(h('span', { class: 'chip' }, `⏱ ${fmtTime(timeMs)}`), h('span', { class: 'chip' }, `Harakat: ${moves}`)); }, 250); }
        b.classList.add('flip'); if (c.kind === 't') speak(c.text, lang.tts);
        flipped.push(i);
        if (flipped.length === 2) {
          moves++; lock = true;
          const [a, z] = flipped.map((k) => cards[k]);
          if (a.id === z.id && a.kind !== z.kind) {
            flipped.forEach((k) => els[k].classList.add('done')); matched++; sfx.ok(); flipped = []; lock = false;
            if (matched === 8) { ctl.clear(tickId); timeMs = Date.now() - t0; await sleep(500); gameResult(ctl, 'memory', [[moves, 'Harakat'], [fmtTime(timeMs), 'Vaqt'], ['8/8', 'Juftlik']], { pairs: 8, moves: Math.max(8, moves), timeMs: Math.max(6000, timeMs) }, replayOf(ctl, 'memory')); }
          } else { sfx.bad(); await sleep(800); flipped.forEach((k) => els[k].classList.remove('flip')); flipped = []; lock = false; }
        }
        ctl.setStatus(h('span', { class: 'chip' }, `⏱ ${fmtTime(timeMs)}`), h('span', { class: 'chip' }, `Harakat: ${moves}`));
      });
      return b;
    });
    let tickId;
    ctl.setStatus(h('span', { class: 'chip' }, '⏱ 0:00'), h('span', { class: 'chip' }, 'Harakat: 0'));
    ctl.stage.replaceChildren(h('p', { class: 'lead center' }, "So'zni va uning tarjimasini toping"), h('div', { class: 'mem-grid' }, els));
  }

  async function gameBlitz(ctl) {
    const { lang, words } = await wordsFor(40);
    const deck = shuffle(words);
    if (deck.length < 5) throw new Error("Blitz uchun so'zlar yetarli emas — avval bir nechta dars o'ting");
    let i = 0, correct = 0, wrong = 0, combo = 0, busy = false;
    const total = 60000, start = Date.now();
    const bar = h('i'); const wordEl = h('div', { class: 'big-word center', dir: lang.dir }); const optsEl = h('div', { class: 'opts' });
    const score = h('span', { class: 'chip' }, '✓ 0'); const timeEl = h('span', { class: 'chip' }, '60');
    ctl.setStatus(score, timeEl);
    const q = () => {
      const w = deck[i % deck.length]; i++;
      const others = shuffle(deck.filter((x) => x.uz !== w.uz)).slice(0, 3);
      wordEl.replaceChildren(w.target, h('button', { class: 'speak', 'aria-label': 'Tinglash', onclick: () => speak(w.target, lang.tts) }, '🔊'));
      speak(w.target, lang.tts);
      optsEl.replaceChildren(...shuffle([w, ...others]).map((o, k) => h('button', {
        class: 'opt', onclick: async (ev) => {
          if (busy || !ctl.alive) return; busy = true;
          const ok = o.uz === w.uz; ev.currentTarget.classList.add(ok ? 'ok' : 'bad');
          if (ok) { correct++; combo++; sfx.ok(); } else { wrong++; combo = 0; sfx.bad(); [...optsEl.children].find((b) => b.textContent.endsWith(w.uz))?.classList.add('ok'); }
          score.textContent = `✓ ${correct}${combo >= 3 ? ` 🔥${combo}` : ''}`;
          await sleep(ok ? 250 : 650); busy = false;
          if (ctl.alive && correct < 45) q(); else if (ctl.alive && correct >= 45) end();
        },
      }, h('span', { class: 'k' }, k + 1), o.uz)));
    };
    let tick;
    const end = () => { if (!ctl.alive) return; ctl.clear(tick); const elapsed = Math.max(55000, Math.min(70000, Date.now() - start)); gameResult(ctl, 'blitz', [[correct, "To'g'ri"], [wrong, 'Xato'], [Math.max(0, correct * 10 - wrong * 5), 'Ball']], { correct, wrong, timeMs: elapsed }, replayOf(ctl, 'blitz')); };
    tick = ctl.timer(() => { const left = Math.max(0, total - (Date.now() - start)); bar.style.width = `${(left / total) * 100}%`; timeEl.textContent = `⏱ ${Math.ceil(left / 1000)}`; if (left <= 0) end(); }, 100);
    ctl.stage.replaceChildren(h('div', { class: 'bar g-bar' }, bar), wordEl, optsEl);
    bar.style.width = '100%';
    q();
  }

  async function gameScramble(ctl) {
    const { lang, words } = await wordsFor(40);
    const deck = shuffle(words.filter((w) => !/\s/.test(w.target) && Array.from(w.target).length >= 3 && Array.from(w.target).length <= 10));
    if (deck.length < 5) throw new Error("Bu o'yin uchun so'zlar yetarli emas — avval bir nechta dars o'ting");
    const total = 90000, start = Date.now();
    let idx = 0, solved = 0, locked = false;
    const solvedEl = h('span', { class: 'chip' }, '✓ 0'); const timeEl = h('span', { class: 'chip' }, '⏱ 90');
    ctl.setStatus(solvedEl, timeEl);
    const holder = h('div');
    const showWord = () => {
      const w = deck[idx % deck.length]; idx++;
      const letters = Array.from(w.target);
      let order = shuffle(letters.map((_, i) => i));
      for (let k = 0; k < 6 && order.every((v, i) => letters[v] === letters[i]); k++) order = shuffle(order);
      const picked = [];
      locked = false;
      const answerEl = h('div', { class: 'o-line letters', dir: lang.dir }); const poolEl = h('div', { class: 'o-pool letters', dir: lang.dir });
      const render = () => {
        answerEl.replaceChildren(...picked.map((p) => h('button', { class: 'o-tok', onclick: () => { if (locked) return; picked.splice(picked.indexOf(p), 1); render(); } }, letters[p])));
        poolEl.replaceChildren(...order.map((p) => h('button', { class: 'o-tok' + (picked.includes(p) ? ' ghost' : ''), disabled: picked.includes(p), onclick: () => { if (locked) return; picked.push(p); render(); check(); } }, letters[p])));
      };
      const check = async () => {
        if (picked.length !== letters.length) return;
        locked = true;
        if (picked.map((p) => letters[p]).join('') === w.target) {
          solved++; solvedEl.textContent = `✓ ${solved}`; answerEl.classList.add('ok'); sfx.ok(); speak(w.target, lang.tts);
          await sleep(700);
          if (!ctl.alive) return;
          if (solved >= 15) return end();
          showWord();
        } else { answerEl.classList.add('bad'); sfx.bad(); await sleep(500); answerEl.classList.remove('bad'); picked.length = 0; locked = false; render(); }
      };
      render();
      holder.replaceChildren(h('p', { class: 'lead center' }, 'Tarjimasi:'), h('div', { class: 'big-word center' }, w.uz), answerEl, poolEl,
        h('div', { class: 'center', style: { marginTop: '26px' } }, h('button', { class: 'btn btn-ghost', onclick: () => { if (!locked && ctl.alive) showWord(); } }, "O'tkazib yuborish ⏭")));
    };
    let tick;
    const end = () => { if (!ctl.alive) return; ctl.clear(tick); const elapsed = Math.max(Date.now() - start, solved * 2000, 1000); gameResult(ctl, 'scramble', [[solved, "So'z"], [solved * 100, 'Ball']], { solved, timeMs: elapsed }, replayOf(ctl, 'scramble')); };
    tick = ctl.timer(() => { const left = Math.max(0, total - (Date.now() - start)); timeEl.textContent = `⏱ ${Math.ceil(left / 1000)}`; if (left <= 0) end(); }, 250);
    ctl.stage.replaceChildren(holder);
    showWord();
  }

  async function gameBuilder(ctl) {
    const { lang, sentences } = await api('GET', `/api/games/sentences?lang=${S.user.currentLang}&n=10`);
    if (sentences.length < 3) throw new Error("Jumlalar yetarli emas — avval bir nechta dars o'ting");
    const total = 180000, start = Date.now();
    let idx = 0, solved = 0;
    const solvedEl = h('span', { class: 'chip' }, `✓ 0/${sentences.length}`); const timeEl = h('span', { class: 'chip' }, '⏱ 3:00');
    ctl.setStatus(solvedEl, timeEl);
    const holder = h('div');
    const show = () => {
      const s = sentences[idx];
      let busy = false;
      const board = tokenBoard(s.shuffled, lang.dir === 'rtl' ? 'rtl' : 'ltr', async (ans) => {
        if (!ans || busy || !ctl.alive) return;
        busy = true;
        if (ans.join(' ') === s.words.join(' ')) {
          board.lock('ok'); solved++; solvedEl.textContent = `✓ ${solved}/${sentences.length}`; sfx.ok(); speak(s.words.join(' '), lang.tts);
          await sleep(1200); if (!ctl.alive) return;
          idx++; if (idx >= sentences.length) return end(); show();
        } else { board.shake(); sfx.bad(); await sleep(600); board.reset(); busy = false; }
      });
      holder.replaceChildren(h('p', { class: 'lead center' }, `${idx + 1}-jumla`), h('div', { class: 'big-word center sm' }, s.uz), board.el);
    };
    let tick;
    const end = () => { if (!ctl.alive) return; ctl.clear(tick); const elapsed = Math.max(Date.now() - start, solved * 3000, 1000); gameResult(ctl, 'builder', [[solved, 'Jumla'], [solved * 100, 'Ball'], [fmtTime(elapsed), 'Vaqt']], { solved, timeMs: elapsed }, replayOf(ctl, 'builder')); };
    tick = ctl.timer(() => { const left = Math.max(0, total - (Date.now() - start)); timeEl.textContent = `⏱ ${fmtTime(left)}`; if (left <= 0) end(); }, 250);
    ctl.stage.replaceChildren(holder);
    show();
  }

  // ---------- dictionary ----------
  async function renderDictionary() {
    await refreshUser(); await loadCourse();
    const data = await api('GET', `/api/dictionary?lang=${S.user.currentLang}`);
    const units = [...new Set(data.words.map((w) => w.unit))];
    const list = h('div', { class: 'dict-list' });
    const search = h('input', { type: 'search', placeholder: "So'z yoki tarjima qidiring…", class: 't-input', style: { fontSize: '1rem', padding: '12px 16px' }, 'aria-label': 'Qidiruv' });
    const unitSel = h('select', { class: 'sel', 'aria-label': 'Mavzu' }, h('option', { value: '' }, 'Barcha mavzular'), units.map((u) => h('option', { value: u }, u)));
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const rows = data.words.filter((w) => (!unitSel.value || w.unit === unitSel.value) && (!q || w.target.toLowerCase().includes(q) || w.uz.toLowerCase().includes(q) || (w.tr || '').toLowerCase().includes(q)));
      list.replaceChildren(...(rows.length ? rows.map((w) => h('div', { class: 'dict-row' },
        h('button', { class: 'speak', 'aria-label': 'Tinglash', onclick: () => speak(w.target, data.lang.tts) }, '🔊'),
        h('div', { class: 'w' }, h('b', { dir: data.lang.dir }, w.target), w.tr ? h('em', {}, ` ${w.tr}`) : null, h('small', {}, w.uz)),
        h('div', { class: 'strength', title: w.reps < 0 ? 'Hali o\'rganilmagan' : `Mustahkamlik: ${Math.min(w.reps, 4)}/4` }, [0, 1, 2, 3].map((k) => h('i', { class: w.reps > k ? 'on' : '' }))),
        h('span', { class: 'unit-tag' }, w.unit))) : [h('div', { class: 'empty' }, h('span', { class: 'em' }, '🔍'), 'Hech narsa topilmadi')]));
    };
    search.addEventListener('input', draw); unitSel.addEventListener('change', draw);
    draw();
    await shell('/dictionary', [h('h1', {}, "Lug'at"), h('p', { class: 'lead' }, `${S.course.lang.flag} ${S.course.lang.name} · ${data.words.length} ta so'z`), h('div', { class: 'dict-tools' }, search, unitSel), list]);
  }

  // ---------- tutor ----------
  const chatHistory = {};
  async function renderTutor() {
    await refreshUser(); await loadCourse();
    const lang = S.user.currentLang, lm = langMeta(lang) || S.course.lang;
    const hist = chatHistory[lang] = chatHistory[lang] || [];
    const list = h('div', { class: 'chat' });
    const draw = () => list.replaceChildren(...(hist.length ? hist.map((m) => h('div', { class: 'msg ' + (m.role === 'user' ? 'me' : 'ai'), dir: m.role === 'assistant' && lm.dir === 'rtl' ? 'auto' : null }, m.content))
      : [h('div', { class: 'msg ai' }, `Salom! Men sizning ${lm.name} ustozingizman. Biror narsa yozing — men tuzataman va suhbatni davom ettiraman. 😊`)]));
    draw();
    const input = h('input', { type: 'text', maxlength: 500, placeholder: `${lm.native} da yozing…`, 'aria-label': 'Xabar', autocomplete: 'off' });
    const send = h('button', { class: 'btn btn-main', type: 'submit' }, 'Yuborish');
    const form = h('form', {
      class: 'chat-form', onsubmit: async (e) => {
        e.preventDefault();
        const text = input.value.trim(); if (!text) return;
        input.value = ''; hist.push({ role: 'user', content: text }); draw();
        list.append(h('div', { class: 'msg ai typing' }, 'Yozmoqda…'));
        send.disabled = true;
        try { const r = await api('POST', '/api/tutor', { lang, messages: hist.slice(-12) }); hist.push({ role: 'assistant', content: r.reply }); }
        catch (ex) { hist.pop(); toast(ex.message); input.value = text; }
        finally { send.disabled = false; draw(); input.focus(); window.scrollTo(0, document.body.scrollHeight); }
      },
    }, input, send);
    await shell('/tutor', [h('h1', {}, 'AI ustoz'), h('p', { class: 'lead' }, `${lm.flag} ${lm.name} · erkin suhbat`), list, form]);
    input.focus();
  }

  // ---------- leaderboard ----------
  async function renderLeaderboard() {
    await refreshUser(); await loadCourse();
    const { rows } = await api('GET', '/api/leaderboard');
    const list = rows.length
      ? rows.map((r) => h('div', { class: 'lb-row' + (r.me ? ' me' : '') }, h('div', { class: 'lb-rank' }, r.rank), h('div', { class: 'avatar' }, r.name[0].toUpperCase()), h('div', { class: 'lb-name' }, r.name, r.me ? ' (siz)' : ''), h('div', { class: 'lb-xp' }, `${r.xp} XP`)))
      : [h('div', { class: 'empty' }, h('span', { class: 'em' }, '🏁'), "Hali hech kim XP to'plamagan — birinchi bo'ling!")];
    await shell('/leaderboard', [h('h1', {}, 'Haftalik reyting'), h('p', { class: 'lead' }, "So'nggi 7 kun ichida to'plangan XP"), list]);
  }

  // ---------- profile ----------
  async function renderProfile() {
    await refreshUser(); await loadCourse();
    const u = S.user;
    const { badges } = await api('GET', '/api/badges');
    const goals = h('div', { class: 'pills' }, [10, 20, 30, 50].map((g) => h('button', {
      class: 'pill' + (u.dailyGoal === g ? ' on' : ''),
      onclick: async () => { try { S.user = (await api('PATCH', '/api/me', { dailyGoal: g })).user; toast(`Kunlik maqsad: ${g} XP`); renderProfile(); } catch (e) { toast(e.message); } },
    }, `${g} XP`)));
    const themes = h('div', { class: 'pills' }, [['dark', '🌙 Tungi'], ['light', '☀️ Kunduzgi'], ['auto', '🖥 Avto']].map(([m, label]) => h('button', {
      class: 'pill' + (themeMode() === m ? ' on' : ''), onclick: () => { LS.set('lf_theme', m); applyTheme(m); renderProfile(); },
    }, label)));
    const nameIn = h('input', { type: 'text', value: u.name, maxlength: 40, 'aria-label': 'Ism', class: 't-input', style: { fontSize: '1rem', padding: '12px 14px' } });
    const saveName = h('button', { class: 'btn btn-ghost', onclick: async () => { try { S.user = (await api('PATCH', '/api/me', { name: nameIn.value })).user; toast('Saqlandi ✓'); } catch (e) { toast(e.message); } } }, 'Saqlash');
    const muteBtn = h('button', { class: 'btn btn-ghost', onclick: () => { muted = !muted; LS.set('lf_mute', muted ? '1' : '0'); muteBtn.textContent = muted ? "🔇 Ovoz o'chiq" : '🔊 Ovoz yoqiq'; } }, muted ? "🔇 Ovoz o'chiq" : '🔊 Ovoz yoqiq');
    await shell('/profile', [
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' } },
        h('div', { class: 'avatar', style: { width: '64px', height: '64px', fontSize: '1.6rem' } }, u.name[0].toUpperCase()),
        h('div', {}, h('h1', { style: { marginBottom: 0 } }, u.name), h('p', { class: 'lead', style: { marginBottom: 0 } }, u.email, u.isAdmin ? ' · admin' : ''))),
      h('div', { class: 'stats4' },
        h('div', { class: 'stat-tile' }, h('b', {}, u.level), h('span', {}, 'Daraja')),
        h('div', { class: 'stat-tile' }, h('b', {}, u.xp), h('span', {}, 'Jami XP')),
        h('div', { class: 'stat-tile' }, h('b', {}, `🔥${u.streak}`), h('span', {}, 'Seriya')),
        h('div', { class: 'stat-tile' }, h('b', {}, u.bestStreak), h('span', {}, 'Eng uzun'))),
      u.isAdmin ? h('a', { class: 'btn btn-main', href: '/admin', style: { marginTop: '16px' } }, '🛠️ Admin panelga o\'tish') : null,
      h('h3', { class: 'section-title' }, 'Kunlik maqsad'), goals,
      h('h3', { class: 'section-title' }, 'Nishonlar'),
      h('div', { class: 'badges' }, badges.map((b) => h('div', { class: 'badge' + (b.earned ? '' : ' off'), title: b.desc }, h('span', { class: 'em' }, b.emoji), h('b', {}, b.title), h('small', {}, b.desc)))),
      h('h3', { class: 'section-title' }, 'Ko\'rinish'), themes,
      h('h3', { class: 'section-title' }, 'Sozlamalar'),
      h('div', { class: 'card', style: { display: 'grid', gap: '12px' } },
        h('div', { style: { display: 'flex', gap: '10px' } }, nameIn, saveName), muteBtn,
        h('button', { class: 'btn btn-ghost', style: { color: 'var(--bad)' }, onclick: async () => { await api('POST', '/api/auth/logout', {}); S.user = null; S.course = null; location.hash = '#/login'; route(); } }, 'Chiqish')),
    ]);
  }

  // ---------- boot ----------
  (async function boot() {
    if ('speechSynthesis' in window) speechSynthesis.getVoices();
    try { S.user = (await api('GET', '/api/me')).user; await loadLangs(); } catch { S.user = null; }
    if (!location.hash) location.hash = S.user ? '#/learn' : '#/login';
    route();
  })();
})();
