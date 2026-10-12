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

  // ---------- storage, theme, sound, speech ----------
  const memStore = new Map();
  const LS = {
    get: (k) => { try { return localStorage.getItem(k) ?? memStore.get(k) ?? null; } catch { return memStore.get(k) ?? null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} memStore.set(k, v); },
    remove: (k) => { try { localStorage.removeItem(k); } catch {} memStore.delete(k); },
  };

  async function api(method, url, body) {
    const headers = {};
    if (method !== 'GET') headers['content-type'] = 'application/json';
    const token = LS.get('lf_token');
    if (token) headers['authorization'] = `Bearer ${token}`;
    const r = await fetch(url, {
      method,
      headers,
      body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined,
      credentials: 'include',
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.error || 'Xatolik'); e.status = r.status; throw e; }
    return data;
  }
  let muted = LS.get('lf_mute') === '1';

  function isDarkTheme() {
    const cur = themeMode();
    return cur === 'dark' || (cur === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function applyTheme(mode) {
    const dark = mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark || mode === undefined ? 'dark' : 'light';
    const m = $('meta[name=theme-color]'); if (m) m.content = dark ? '#07080d' : '#f8fafc';
    updateAllThemeToggles();
  }

  function toggleTheme() {
    const next = isDarkTheme() ? 'light' : 'dark';
    LS.set('lf_theme', next);
    applyTheme(next);
    toast(next === 'light' ? '☀️ Yuqori kontrastli yorug\' mavzu yoqildi' : '🌙 Tungi qorong\'i mavzu yoqildi');
    return next;
  }

  function updateAllThemeToggles() {
    const dark = isDarkTheme();
    document.querySelectorAll('.theme-toggle-btn').forEach((btn) => {
      const iconSpan = btn.querySelector('.theme-icon');
      if (iconSpan) {
        iconSpan.textContent = dark ? '☀️' : '🌙';
      } else {
        btn.textContent = dark ? '☀️' : '🌙';
      }
      btn.setAttribute('aria-label', dark ? 'Yorug\' mavzuga o\'tish (Yuqori kontrast)' : 'Qorong\'i mavzuga o\'tish');
      btn.title = dark ? 'Yorug\' mavzuga o\'tish (Yuqori kontrast)' : 'Qorong\'i mavzuga o\'tish';
      const labelSpan = btn.querySelector('.theme-label');
      if (labelSpan) {
        labelSpan.textContent = dark ? 'Yorug\' mavzu' : 'Qorong\'i mavzu';
      }
    });
  }

  function createThemeToggleBtn({ showLabel = false, extraClass = '' } = {}) {
    const dark = isDarkTheme();
    return h('button', {
      type: 'button',
      class: 'theme-toggle-btn' + (extraClass ? ' ' + extraClass : ''),
      'aria-label': dark ? 'Yorug\' mavzuga o\'tish (Yuqori kontrast)' : 'Qorong\'i mavzuga o\'tish',
      title: dark ? 'Yorug\' mavzuga o\'tish (Yuqori kontrast)' : 'Qorong\'i mavzuga o\'tish',
      onclick: (e) => {
        e.stopPropagation();
        toggleTheme();
      }
    },
      h('span', { class: 'theme-icon' }, dark ? '☀️' : '🌙'),
      showLabel ? h('span', { class: 'theme-label' }, dark ? 'Yorug\' mavzu' : 'Qorong\'i mavzu') : null);
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

  function speak(text, lang, opts = {}) {
    if (!('speechSynthesis' in window)) { toast("Brauzeringiz ovozli o'qishni qo'llamaydi"); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = opts.rate || 0.9;
    if (opts.pitch) u.pitch = opts.pitch;
    const v = speechSynthesis.getVoices().find((x) => x.lang === lang) || speechSynthesis.getVoices().find((x) => x.lang.startsWith(lang.slice(0, 2)));
    if (v) u.voice = v;
    if (opts.onStart) u.onstart = opts.onStart;
    if (opts.onEnd) u.onend = opts.onEnd;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
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
    '/start': renderStart,
    '/learn': renderLearn, '/exams': renderExams, '/review': renderReview, '/games': renderGames, '/dictionary': renderDictionary,
    '/tutor': renderTutor, '/leaderboard': renderLeaderboard, '/profile': renderProfile,
  };
  const NAV = [
    ['/learn', '🏠', "O'rganish"], ['/exams', '🎓', 'Sertifikatlar'], ['/review', '🧠', 'Takrorlash'], ['/games', '🎮', "O'yinlar"], ['/dictionary', '📚', "Lug'at"],
    ['/tutor', '🎙️', 'JARVIS Ustoz'], ['/leaderboard', '🏆', 'Reyting'], ['/profile', '👤', 'Profil'],
  ];
  const TABS = ['/learn', '/exams', '/games', '/review', '/profile'];

  function parseHash() {
    const [path, query = ''] = (location.hash.slice(1) || '/start').split('?');
    return { path, params: new URLSearchParams(query) };
  }

  async function route() {
    const { path, params } = parseHash();
    if (!S.user) {
      if (path === '/login') return renderAuth('login', params.get('email') || '');
      if (path === '/register') return renderAuth('register', params.get('email') || '');
      if (path === '/reset') return renderAuth('reset', params.get('email') || '');
      return renderStart();
    }
    if (path === '/start') return renderStart();
    if (path === '/login' || path === '/register' || path === '/reset') { location.hash = '#/learn'; return; }
    try { await (routes[path] || renderLearn)(path); } catch (e) {
      if (e.status === 401 || e.status === 403) {
        S.user = null;
        LS.remove('lf_token');
        toast(e.message);
        return renderAuth('login');
      }
      toast(e.message);
    }
  }
  addEventListener('hashchange', route);

  // ---------- start & onboarding ----------
  const LANG_CATEGORIES = [
    { id: 'all', name: 'Barchasi', icon: '🌟' },
    { id: 'saved', name: 'Saqlanganlar', icon: '📌' },
    { id: 'european', name: 'Yevropa', icon: '🇪🇺' },
    { id: 'asian', name: 'Osiyo', icon: '🌏' },
    { id: 'middle_eastern', name: 'Yaqin Sharq', icon: '🕌' },
  ];

  const getSavedLangs = () => {
    try {
      const key = S.user ? 'lf_saved_langs_' + S.user.id : 'lf_saved_langs';
      const raw = localStorage.getItem(key) || localStorage.getItem('lf_saved_langs');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return ['en', 'de']; // default pinned learning languages
  };

  const toggleSaveLang = (code) => {
    const key = S.user ? 'lf_saved_langs_' + S.user.id : 'lf_saved_langs';
    let saved = getSavedLangs();
    const isPinned = saved.includes(code);
    if (isPinned) {
      saved = saved.filter((c) => c !== code);
    } else {
      saved.push(code);
    }
    try {
      localStorage.setItem(key, JSON.stringify(saved));
      localStorage.setItem('lf_saved_langs', JSON.stringify(saved));
    } catch {}
    return !isPinned;
  };

  const LANG_CATALOG = [
    // European (8 languages)
    { code: 'en', category: 'european', categoryName: 'Yevropa', cert: '🎓 IELTS Band 4.0 - 8.5+ · CEFR A1 - C1', sub: 'IELTS imtihoni, xalqaro ta\'lim va kasbiy til', badge: 'IELTS / CEFR', name: 'Ingliz tili', native: 'English', flag: '🇬🇧', color: '#7c5cff', lessons: 30, active: true },
    { code: 'de', category: 'european', categoryName: 'Yevropa', cert: '🎓 Goethe-Zertifikat · TestDaF (A1 - C1)', sub: 'Germaniyada bepul oliy ta\'lim va Ausbildung', badge: 'Goethe / TestDaF', name: 'Nemis tili', native: 'Deutsch', flag: '🇩🇪', color: '#ffc94d', lessons: 30, active: true },
    { code: 'ru', category: 'european', categoryName: 'Yevropa', cert: '🎓 TRKI / TORFL (A1 - C1)', sub: 'Xalqaro standartdagi rasmiy rus tili attestatsiyasi', badge: 'TRKI / TORFL', name: 'Rus tili', native: 'Русский', flag: '🇷🇺', color: '#00d4ff', lessons: 30, active: true },
    { code: 'fr', category: 'european', categoryName: 'Yevropa', cert: '🎓 DELF / DALF (A1 - C1)', sub: 'Fransiya oliygohlari va Yevropa ta\'lim grantlari', badge: 'DELF / DALF', name: 'Fransuz tili', native: 'Français', flag: '🇫🇷', color: '#4f8bff', lessons: 30, active: true },
    { code: 'es', category: 'european', categoryName: 'Yevropa', cert: '🎓 DELE / SIELE (A1 - C1)', sub: 'Ispaniya va Lotin Amerikasi rasmiy sertifikati', badge: 'DELE / SIELE', name: 'Ispan tili', native: 'Español', flag: '🇪🇸', color: '#ff4fa3', lessons: 30, active: true },
    { code: 'it', category: 'european', categoryName: 'Yevropa', cert: '🎓 CILS / CELI (A1 - C1)', sub: 'Italiya madaniyati, arxitektura va san\'at tili', badge: 'CILS / CELI', name: 'Italyan tili', native: 'Italiano', flag: '🇮🇹', color: '#9dff5c', lessons: 24, active: false },
    { code: 'pt', category: 'european', categoryName: 'Yevropa', cert: '🎓 CAPLE / Celpe-Bras', sub: 'Portugaliya va Braziliya rasmiy muloqot tili', badge: 'CAPLE', name: 'Portugal tili', native: 'Português', flag: '🇵🇹', color: '#38bdf8', lessons: 22, active: false },
    { code: 'pl', category: 'european', categoryName: 'Yevropa', cert: '🎓 Certyfikat Polski', sub: 'Polsha oliygohlari va Yevropa Karta Polaka', badge: 'Polski', name: 'Polyak tili', native: 'Polski', flag: '🇵🇱', color: '#fb7185', lessons: 20, active: false },

    // Asian (4 languages)
    { code: 'tr', category: 'asian', categoryName: 'Osiyo', cert: '🎓 TÖMER / Yunus Emre (A1 - C1)', sub: 'Turkiya grantlari, sayohat va biznes tili', badge: 'TÖMER', name: 'Turk tili', native: 'Türkçe', flag: '🇹🇷', color: '#ff5d6c', lessons: 30, active: false },
    { code: 'ko', category: 'asian', categoryName: 'Osiyo', cert: '🎓 TOPIK I & II (1 - 6-daraja)', sub: 'Janubiy Koreya universitetlari (GKS) va EPS imtihoni', badge: 'TOPIK', name: 'Koreys tili', native: '한국어', flag: '🇰🇷', color: '#5cffd6', lessons: 32, active: false },
    { code: 'ja', category: 'asian', categoryName: 'Osiyo', cert: '🎓 JLPT (N5 - N1 darajalar)', sub: 'Yaponiya texnologiya, anime va ish vizalari', badge: 'JLPT', name: 'Yapon tili', native: '日本語', flag: '🇯🇵', color: '#e45cff', lessons: 28, active: false },
    { code: 'zh', category: 'asian', categoryName: 'Osiyo', cert: '🎓 HSK (1 - 6-darajalar)', sub: 'Xitoy biznesi, savdo va xalqaro stipendiyalar', badge: 'HSK', name: 'Xitoy tili', native: '中文', flag: '🇨🇳', color: '#ff8a3d', lessons: 34, active: false },

    // Middle Eastern (3 languages)
    { code: 'ar', category: 'middle_eastern', categoryName: 'Yaqin Sharq', cert: '🎓 ALPT / Fasih Arab tili (A1 - C1)', sub: 'Fasih arab tili, Yaqin Sharq va xalqaro attestatsiya', badge: 'ALPT / Fasih', name: 'Arab tili', native: 'العربية', flag: '🇸🇦', color: '#22d39a', lessons: 30, active: true },
    { code: 'fa', category: 'middle_eastern', categoryName: 'Yaqin Sharq', cert: '🎓 AMFA / Samt Attestatsiya', sub: 'Sharq adabiyoti, Fors tarixi va mumtoz madaniyati', badge: 'AMFA', name: 'Fors tili', native: 'فارسی', flag: '🇮🇷', color: '#f59e0b', lessons: 18, active: false },
    { code: 'az', category: 'middle_eastern', categoryName: 'Yaqin Sharq', cert: '🎓 Rasmiy sertifikat', sub: 'Qardosh turkiy til, Kavkaz va Kasbiy muloqot', badge: 'Azərbaycan', name: 'Ozarbayjon tili', native: 'Azərbaycan', flag: '🇦🇿', color: '#06b6d4', lessons: 18, active: false },
  ];

  const getLangObj = (code) => {
    const fromCat = LANG_CATALOG.find((l) => l.code === code);
    const fromS = S.langs.find((l) => l.code === code);
    if (fromCat && fromS) return {
      ...fromCat,
      ...fromS,
      cert: fromCat.cert,
      sub: fromCat.sub,
      badge: fromCat.badge,
      category: fromCat.category,
      categoryName: fromCat.categoryName,
      lessons: fromS.lessons || fromCat.lessons || 30,
      done: fromS.done || 0,
      active: true,
    };
    if (fromCat) return { ...fromCat, lessons: fromCat.lessons || 30, done: 0, active: false };
    if (fromS) return { ...fromS, cert: 'Xalqaro sertifikat', sub: `${fromS.lessons} interaktiv dars`, badge: 'Til', category: 'european', categoryName: 'Yevropa', lessons: fromS.lessons || 30, done: fromS.done || 0, active: true };
    return { code: 'en', name: 'Ingliz tili', native: 'English', flag: '🇬🇧', color: '#7c5cff', cert: 'IELTS Band 4.0 - 8.5+', sub: 'Xalqaro kurs', category: 'european', categoryName: 'Yevropa', lessons: 30, done: 0, active: true };
  };

  async function renderStart() {
    await loadLangs();
    let chosenLang = getQueryLang() || (S.user ? S.user.currentLang : (S.langs[0] ? S.langs[0].code : 'en'));
    let chosenGoal = 'lessons'; // 'lessons' | 'ielts' | 'jarvis' | 'placement'
    let currentCategory = 'all';
    let searchQuery = '';

    const container = h('div', { class: 'start-container' });

    // Top Bar
    const startThemeBtn = createThemeToggleBtn();
    const topBar = h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' } },
      h('a', { href: '#/start', class: 'logo' }, h('span', { class: 'logo-mark' }, 'L'), 'LinguaFlow'),
      h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
        startThemeBtn,
        S.user
          ? h('a', { href: '#/learn', class: 'btn btn-ghost' }, '🏠 O\'rganish sahifasi')
          : h('a', { href: '#/login', class: 'btn btn-ghost' }, 'Kirish')));

    // Header
    const head = h('div', { class: 'start-head' },
      h('span', { class: 'start-badge' }, '✨ Darslarni boshlash uchun tilni tanlang'),
      h('h1', { class: 'start-title' }, 'Qaysi tilni o\'rganmoqchisiz?'),
      h('p', { class: 'start-subtitle' }, 'Barcha xalqaro standartdagi til kurslari: Yevropa, Osiyo va Yaqin Sharq tillari, CEFR & IELTS sertifikatlari, hamda JARVIS AI bilan jonli nutq muloqoti.'));

    // Daily XP Goal & Study Habit Tracker
    const dailyGoalCard = h('div', { class: 'daily-goal-card' });
    async function setDailyGoal(g) {
      const prevGoal = (S.user && S.user.dailyGoal) || Number(LS.get('lf_daily_goal')) || 20;
      const prevXp = (S.user && S.user.dailyXp) || Number(LS.get('lf_daily_xp')) || 0;
      const prevHit = prevXp >= prevGoal;
      LS.set('lf_daily_goal', g);
      if (S.user) {
        try {
          const res = await api('PATCH', '/api/me', { dailyGoal: g });
          if (res && res.user) {
            S.user = res.user;
          }
        } catch {}
      }
      const nowGoal = (S.user && S.user.dailyGoal) || g;
      const nowXp = (S.user && S.user.dailyXp) || prevXp;
      const nowHit = nowXp >= nowGoal;
      if (!prevHit && nowHit && nowXp > 0) {
        sfx.done();
        confetti();
        toast(`🎯 Kunlik maqsad ${g} XP/kun ga o'rnatildi va bajarildi! 🎉`);
      } else {
        toast(`🎯 Kunlik maqsad ${g} XP/kun qilib belgilandi! O'rganishda davomiylik muhim 🔥`);
      }
      renderDailyGoalCard();
    }

    function renderDailyGoalCard() {
      dailyGoalCard.replaceChildren();
      const goal = (S.user && S.user.dailyGoal) || Number(LS.get('lf_daily_goal')) || 20;
      const xp = (S.user && S.user.dailyXp) || Number(LS.get('lf_daily_xp')) || 0;
      const streak = (S.user && S.user.goalStreak != null) ? S.user.goalStreak : ((S.user && S.user.streak) || Number(LS.get('lf_guest_streak')) || 0);
      const bestStreak = (S.user && S.user.bestGoalStreak != null) ? S.user.bestGoalStreak : ((S.user && S.user.bestStreak) || Math.max(streak, Number(LS.get('lf_guest_best_streak')) || streak));
      const pct = Math.min(100, Math.round((xp / goal) * 100));
      const isDone = xp >= goal;
      const inProgress = xp > 0 && xp < goal;

      // Aggregated progress across all languages
      const totalLessonsDone = S.langs.reduce((acc, l) => acc + (Number(l.done) || 0), 0);

      const topRow = h('div', { class: 'daily-goal-top' },
        h('div', { class: 'daily-goal-title-wrap' },
          h('div', { class: 'daily-goal-title' },
            '🎯 Kunlik XP Maqsadi & O\'rganish Odati',
            isDone ? h('span', { style: { fontSize: '.9rem' } }, '🎉') : null),
          h('p', { class: 'daily-goal-desc' },
            'Har kungi muntazam o\'rganish tilda erkin so\'zlashish garovidir. O\'zingizga mos kunlik yuklamani tanlang.')),
        h('div', { class: 'daily-goal-badges' },
          h('div', { class: 'daily-goal-badge-streak' }, '🔥 ', h('b', {}, `${streak} kunlik seriya`)),
          h('div', { class: 'daily-goal-badge-target' }, `🎯 Maqsad: ${goal} XP/kun`)));

      const meter = h('div', { class: 'daily-goal-meter' },
        h('div', { class: 'daily-goal-meter-head' },
          h('div', { class: 'daily-goal-meter-current' },
            h('span', {}, 'Bugungi natija:'),
            h('b', { style: { color: isDone ? '#22d39a' : '#00d4ff' } }, `${xp} / ${goal} XP`)),
          h('div', {
            class: 'daily-goal-meter-pct ' + (isDone ? 'done' : (inProgress ? 'in-progress' : ''))
          }, isDone ? `🎉 100% Bajarildi (+${xp - goal} XP)` : `${pct}%`)),
        h('div', { class: 'daily-goal-track' },
          h('div', {
            class: 'daily-goal-fill ' + (isDone ? 'done' : (inProgress ? 'in-progress' : '')),
            style: { width: `${Math.max(4, pct)}%` }
          })),
        h('div', { class: 'daily-goal-meter-foot' },
          h('span', {
            class: 'daily-goal-status-motive ' + (isDone ? 'done' : (inProgress ? 'in-progress' : 'not-started'))
          }, isDone
            ? '🏆 Bugungi kunlik maqsad to\'liq bajarildi! Yangi rekord o\'rnating!'
            : inProgress
              ? `⚡ Bugun yana ${goal - xp} XP to'plang — kunlik seriyangiz davom etadi!`
              : '🚀 Bugun hali dars boshlanmadi. 1 ta dars o\'ting va maqsad sari qadam tashlang!'),
          totalLessonsDone > 0
            ? h('span', { style: { color: 'var(--muted)', fontSize: '.74rem' } }, `📚 O'zlashtirilgan: ${totalLessonsDone} dars`)
            : null));

      // 7-day history for the visual streak counter
      const dayNames = ['Ya', 'Du', 'Se', 'Cho', 'Pa', 'Ju', 'Sha'];
      let history = (S.user && S.user.goalHistory) ? S.user.goalHistory : [];
      if (!history.length) {
        history = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const isToday = i === 0;
          const met = isToday ? isDone : (streak > i);
          history.push({
            day: dayNames[d.getDay()],
            xp: isToday ? xp : (met ? goal : 0),
            met,
            isToday,
          });
        }
      }

      // Visual Streak Counter Widget
      const streakWidget = h('div', { class: 'daily-goal-streak-widget' },
        h('div', { class: 'daily-goal-streak-head' },
          h('div', { class: 'streak-main-info' },
            h('div', { class: 'streak-flame-icon', title: 'Ketma-ket kunlik maqsad seriyasi' }, '🔥'),
            h('div', { class: 'streak-text-block' },
              h('div', { class: 'streak-title-row' },
                h('span', { class: 'streak-count-val' }, `${streak}`),
                h('span', { class: 'streak-count-unit' }, streak === 1 ? 'kun ketma-ket maqsad bajarildi' : 'kun ketma-ket maqsad seriyasi')),
              h('span', { class: 'streak-status-hint' },
                isDone
                  ? '✅ Bugungi kunlik maqsad to\'liq bajarildi! Seriyangiz mustahkamlandi 🔥'
                  : inProgress
                    ? `⚡ Seriyani saqlash va davom ettirish uchun bugun yana ${goal - xp} XP to'plang!`
                    : (streak > 0
                        ? `🔥 ${streak} kunlik seriyangiz faol! Bugun ${goal} XP to'plab davom ettiring.`
                        : '🚀 Bugun darslarni boshlang va 1-kunlik o\'rganish seriyasini yoqing!')))),
          h('div', { class: 'streak-meta-badges' },
            h('div', { class: 'streak-best-badge' }, '🏆 Rekord: ', h('b', {}, `${bestStreak} kun`)),
            h('div', { class: 'streak-state-badge ' + (isDone ? 'active' : 'pending') },
              isDone ? '✓ Bugun bajarildi' : (inProgress ? '⏳ Jarayonda' : '💤 Kutilmoqda')))),
        h('div', { class: 'streak-week-track' },
          history.map((dayItem) => {
            const isToday = dayItem.isToday;
            const met = dayItem.met;
            const pending = isToday && !met;
            return h('div', { class: 'streak-day-cell' + (isToday ? ' is-today' : '') },
              isToday ? h('span', { class: 'today-pill' }, 'Bugun') : null,
              h('span', { class: 'streak-day-name' }, dayItem.day),
              h('div', { class: 'streak-day-circle' + (met ? ' met' : (pending ? ' today-pending' : '')) },
                met ? '🔥' : (pending ? '⚡' : '·')),
              h('span', { class: 'streak-day-xp' }, `${dayItem.xp || 0} XP`));
          }))
      );

      const goalOptions = [
        { xp: 10, title: '10 XP / kun', meta: '☕ Yengil · 5 daqiqa' },
        { xp: 20, title: '20 XP / kun', meta: '🚶 Standart · 10 daqiqa' },
        { xp: 30, title: '30 XP / kun', meta: '🏃 Faol · 15 daqiqa' },
        { xp: 50, title: '50 XP / kun', meta: '🚀 Intensiv · 25 daqiqa' },
      ];

      const chips = h('div', { class: 'daily-goal-chips' });
      goalOptions.forEach((opt) => {
        const isCurrent = goal === opt.xp;
        const chip = h('button', {
          type: 'button',
          class: 'daily-goal-chip' + (isCurrent ? ' active' : ''),
          onclick: () => setDailyGoal(opt.xp)
        },
          h('div', { class: 'daily-goal-chip-xp' },
            opt.title,
            isCurrent ? h('span', { class: 'daily-goal-chip-check' }, '✓') : null),
          h('div', { class: 'daily-goal-chip-meta' }, opt.meta));
        chips.append(chip);
      });

      const selector = h('div', { class: 'daily-goal-selector' },
        h('div', { class: 'daily-goal-selector-head' },
          h('div', { class: 'daily-goal-selector-label' },
            '⚡ Kunlik maqsadni tanlang:',
            h('span', { style: { fontSize: '.76rem', color: '#00d4ff', fontWeight: 'normal' } }, '(istalgan vaqt o\'zgartirish mumkin)')),
          h('span', { class: 'daily-goal-selector-hint' }, 'Har kuni avtomatik hisoblanadi')),
        chips);

      dailyGoalCard.append(topRow, meter, streakWidget, selector);
    }
    renderDailyGoalCard();

    // Category Filter Bar
    const counts = () => {
      const savedCodes = getSavedLangs();
      return {
        all: LANG_CATALOG.length,
        saved: savedCodes.length,
        european: LANG_CATALOG.filter((x) => x.category === 'european').length,
        asian: LANG_CATALOG.filter((x) => x.category === 'asian').length,
        middle_eastern: LANG_CATALOG.filter((x) => x.category === 'middle_eastern').length,
      };
    };

    const filterBar = h('div', { class: 'lang-filter-bar' });
    function renderFilterButtons() {
      filterBar.replaceChildren();
      const cObj = counts();
      LANG_CATEGORIES.forEach((cat) => {
        const btn = h('button', {
          type: 'button',
          class: 'lang-filter-btn' + (cat.id === currentCategory ? ' active' : ''),
          onclick: () => {
            currentCategory = cat.id;
            renderFilterButtons();
            refreshGrid();
          }
        },
          h('span', {}, `${cat.icon} ${cat.name}`),
          h('span', { class: 'lang-filter-count' }, `${cObj[cat.id] || 0}`));
        filterBar.append(btn);
      });
    }
    renderFilterButtons();

    // Saved Languages section
    const savedSection = h('div', { class: 'saved-langs-section' });
    function renderSavedSection() {
      savedSection.replaceChildren();
      const savedCodes = getSavedLangs();
      const savedItems = savedCodes.map((code) => getLangObj(code)).filter(Boolean);

      const header = h('div', { class: 'saved-langs-header' },
        h('div', { class: 'saved-langs-title' },
          '📌 Saqlangan tillar',
          h('span', { class: 'badge' }, `${savedItems.length} ta til`)),
        h('div', { class: 'saved-langs-hint' }, 'Asosiy o\'rganilayotgan tillaringizga tezkor kirish'));

      const savedGrid = h('div', { class: 'saved-langs-grid' });
      if (!savedItems.length) {
        savedGrid.append(
          h('div', { class: 'saved-empty-box' },
            h('span', {}, 'Hozircha hech qanday til saqlanmagan. Istalgan til kartasidagi 📌 tugmasi orqali qadab qo\'yishingiz mumkin.'),
            h('button', {
              type: 'button',
              onclick: () => {
                toggleSaveLang('en');
                toggleSaveLang('de');
                renderSavedSection();
                renderFilterButtons();
                refreshGrid();
              }
            }, '+ Tavsiya etilganlarni qadash')));
      } else {
        savedItems.forEach((l) => {
          const isSelected = l.code === chosenLang;
          const done = Number(l.done) || 0;
          const total = Number(l.lessons) || 30;
          const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
          const card = h('div', {
            class: 'saved-card-compact' + (isSelected ? ' active' : ''),
            style: { '--c': l.color },
            onclick: () => {
              chosenLang = l.code;
              updateSelection();
            }
          },
            h('div', { class: 'saved-card-left' },
              h('div', { class: 'saved-card-flag' }, l.flag),
              h('div', { class: 'saved-card-info' },
                h('div', { class: 'saved-card-name' }, l.name),
                h('div', { class: 'saved-card-meta' },
                  h('span', { style: { color: l.color, fontWeight: '700' } }, l.native),
                  '·',
                  h('span', {}, l.active ? '🔥 Faol' : '🎙️ AI')),
                h('div', { class: 'saved-card-progress-bar' },
                  h('div', { class: 'saved-progress-track' },
                    h('div', {
                      class: 'saved-progress-fill',
                      style: {
                        width: `${pct}%`,
                        background: pct === 100 ? '#22d39a' : (pct > 0 ? `linear-gradient(90deg, ${l.color}, #00d4ff)` : 'rgba(255,255,255,.12)')
                      }
                    })),
                  h('span', { class: 'saved-progress-pct', style: { color: pct > 0 ? '#00d4ff' : 'var(--muted)' } }, `${pct}%`)))),
            h('div', { class: 'saved-card-actions' },
              h('button', {
                type: 'button',
                class: 'lang-pin-btn pinned',
                title: 'Saqlanganlardan chiqarish',
                onclick: (e) => {
                  e.stopPropagation();
                  toggleSaveLang(l.code);
                  toast(`📌 ${l.name} saqlangan tillardan olib tashlandi`);
                  renderSavedSection();
                  renderFilterButtons();
                  refreshGrid();
                }
              }, '📌')));
          card.dataset.savedLangCode = l.code;
          savedGrid.append(card);
        });
      }

      savedSection.append(header, savedGrid);
    }
    renderSavedSection();

    // Search bar (placed directly above the language filter grid)
    const searchInput = h('input', {
      type: 'text',
      class: 'lang-search-input',
      placeholder: '🔍 Til nomini kiriting (masalan: Ingliz, Koreys, Turk, Nemis, Arab...)',
      'aria-label': 'Tilni qidirish'
    });
    const searchClear = h('button', {
      type: 'button',
      class: 'lang-search-clear',
      style: { display: 'none' },
      title: 'Qidiruvni tozalash',
      onclick: () => {
        searchInput.value = '';
        searchQuery = '';
        searchClear.style.display = 'none';
        searchInput.focus();
        refreshGrid();
      }
    }, '✕');
    const searchStatus = h('div', { class: 'lang-search-status', style: { display: 'none' } });

    searchInput.oninput = (e) => {
      searchQuery = e.target.value.trim().toLowerCase();
      searchClear.style.display = searchQuery ? 'grid' : 'none';
      refreshGrid();
    };

    const searchWrap = h('div', { class: 'lang-search-bar' },
      searchInput,
      searchClear);

    // Grid of cards
    const grid = h('div', { class: 'start-grid' });

    function getFilteredLangs() {
      const savedCodes = getSavedLangs();
      return LANG_CATALOG.map((catItem) => {
        const dbLang = S.langs.find((x) => x.code === catItem.code);
        return {
          ...catItem,
          lessons: dbLang ? dbLang.lessons : catItem.lessons,
          done: dbLang ? (dbLang.done || 0) : 0,
          ...(dbLang ? { active: true } : {}),
        };
      }).filter((l) => {
        const matchesCat = currentCategory === 'all'
          ? true
          : (currentCategory === 'saved' ? savedCodes.includes(l.code) : l.category === currentCategory);
        const matchesQ = !searchQuery ||
          l.name.toLowerCase().includes(searchQuery) ||
          l.native.toLowerCase().includes(searchQuery) ||
          l.categoryName.toLowerCase().includes(searchQuery) ||
          l.cert.toLowerCase().includes(searchQuery) ||
          l.badge.toLowerCase().includes(searchQuery);
        return matchesCat && matchesQ;
      });
    }

    function refreshGrid() {
      grid.replaceChildren();
      const list = getFilteredLangs();
      if (searchQuery) {
        searchStatus.style.display = 'flex';
        searchStatus.textContent = list.length
          ? `🔍 "${searchQuery}" bo'yicha ${list.length} ta til topildi`
          : `🔍 "${searchQuery}" bo'yicha hech qanday til topilmadi`;
      } else {
        searchStatus.style.display = 'none';
      }
      if (!list.length) {
        grid.append(
          h('div', { class: 'start-empty-filter' },
            h('div', { style: { fontSize: '2.5rem', marginBottom: '8px' } }, '🔍'),
            h('h3', {}, 'Hech qanday til topilmadi'),
            h('p', {}, `"${searchQuery}" bo'yicha til topilmadi. Qidiruvni yoki tanlangan toifani o'zgartirib ko'ring.`),
            h('button', {
              type: 'button',
              onclick: () => {
                searchQuery = '';
                searchInput.value = '';
                searchClear.style.display = 'none';
                searchStatus.style.display = 'none';
                currentCategory = 'all';
                renderFilterButtons();
                refreshGrid();
              }
            }, '🔄 Barcha tillarni ko\'rsatish')));
        return;
      }

      list.forEach((l) => {
        const isSelected = l.code === chosenLang;
        const isPinned = getSavedLangs().includes(l.code);
        const done = Number(l.done) || 0;
        const total = Number(l.lessons) || 30;
        const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
        const isCompleted = pct === 100;
        const isStarted = pct > 0 && pct < 100;

        const pinBtn = h('button', {
          type: 'button',
          class: 'lang-pin-btn' + (isPinned ? ' pinned' : ''),
          title: isPinned ? 'Saqlanganlardan chiqarish' : 'Saqlangan tillarga qadash',
          onclick: (e) => {
            e.stopPropagation();
            const nowPinned = toggleSaveLang(l.code);
            toast(nowPinned ? `📌 ${l.name} saqlangan tillarga qo'shildi!` : `📌 ${l.name} saqlangan tillardan olib tashlandi`);
            renderSavedSection();
            renderFilterButtons();
            refreshGrid();
          }
        }, '📌');

        const progressBar = h('div', { class: 'lang-card-progress' },
          h('div', { class: 'lang-progress-head' },
            h('span', { class: 'lang-progress-label' }, '📊 O\'zlashtirish:'),
            h('span', {
              class: 'lang-progress-badge ' + (isCompleted ? 'done' : isStarted ? 'started' : 'not-started')
            }, isCompleted ? '🎉 100% Tugallangan' : isStarted ? `⚡ ${pct}%` : '🎯 0%')),
          h('div', { class: 'lang-progress-track' },
            h('div', {
              class: 'lang-progress-fill' + (pct > 0 ? ' glow' : ''),
              style: {
                width: `${pct}%`,
                background: isCompleted ? '#22d39a' : (pct > 0 ? `linear-gradient(90deg, ${l.color}, #00d4ff)` : 'rgba(255,255,255,.12)')
              }
            })),
          h('div', { class: 'lang-progress-foot' },
            h('span', {}, `${done}/${total} dars`),
            h('span', { class: 'lang-progress-motive' },
              isCompleted
                ? 'Kurs to\'liq yakunlandi! 🏆'
                : isStarted
                  ? `Yana ${total - done} ta dars qoldi 🔥`
                  : 'Boshlash uchun bosing 🚀'))
        );

        const card = h('div', {
          class: 'start-card' + (isSelected ? ' active' : ''),
          style: { '--c': l.color },
          onclick: () => {
            chosenLang = l.code;
            updateSelection();
          }
        },
          h('div', { class: 'start-card-top' },
            h('div', { class: 'start-flag' }, l.flag),
            h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
              h('span', { class: 'start-cat-tag' }, l.categoryName),
              h('span', { class: 'start-status-badge ' + (l.active ? 'active' : 'ai-ready') },
                l.active ? '🔥 Faol kurs' : '🎙️ JARVIS AI'),
              h('div', { class: 'start-check' }, isSelected ? '✓' : ''),
              pinBtn)),
          h('div', {},
            h('div', { class: 'start-card-name' }, l.name),
            h('div', { class: 'start-card-sub' }, `${l.native} · ${l.lessons} dars`),
            h('div', { class: 'start-cert-badge' }, l.cert)),
          h('p', { style: { fontSize: '.84rem', color: 'var(--muted)', margin: '4px 0' } }, l.sub),
          progressBar,
          h('div', { class: 'start-card-meta' },
            h('span', {}, l.active ? 'Tinglash · O\'qish · Yozish · Gapirish' : 'AI Ovoz · Talaffuz · Jonli nutq'),
            h('span', { style: { color: l.color, fontWeight: '700' } }, isSelected ? 'Tanlangan ✓' : 'Tanlash →')));
        card.dataset.langCode = l.code;
        grid.append(card);
      });
      updateSelection();
    }

    refreshGrid();

    // Goals
    const goals = [
      ['lessons', '🚀 Noldan boshlash', 'Boshlang\'ich A1 darslardan qadam-baqadam boshlash'],
      ['ielts', '🎓 IELTS & Sertifikat', 'Xalqaro daraja va rasmiy sertifikatga tayyorgarlik'],
      ['jarvis', '🎙️ JARVIS Voice AI', 'Ovozli gaplashish va jonli talaffuz mashqlari'],
      ['placement', '🧭 Daraja testi', 'Bilimingizni aniqlab, mos darajadan boshlash'],
    ];

    let goalGrid;
    const goalChips = goals.map(([gKey, gTitle, gDesc]) => {
      const chip = h('button', {
        type: 'button',
        class: 'start-goal-chip' + (gKey === chosenGoal ? ' active' : ''),
        onclick: () => {
          chosenGoal = gKey;
          Array.from(goalGrid.children).forEach((c) => c.classList.remove('active'));
          chip.classList.add('active');
        }
      }, h('b', {}, gTitle), h('small', {}, gDesc));
      return chip;
    });
    goalGrid = h('div', { class: 'start-goal-grid' }, ...goalChips);
    const goalBox = h('div', { class: 'start-goal-box' },
      h('div', { class: 'start-goal-title' }, '🎯 Maqsadni tanlang:'),
      goalGrid);

    // Primary CTA Button
    const ctaBtn = h('button', {
      class: 'start-btn-primary',
      type: 'button',
      onclick: async () => {
        ctaBtn.disabled = true;
        try {
          const l = getLangObj(chosenLang);
          if (!S.user) {
            const guestRes = await api('POST', '/api/auth/guest', {});
            if (guestRes.token) LS.set('lf_token', guestRes.token);
            S.user = guestRes.user;
          }
          const pendingGoal = Number(LS.get('lf_daily_goal'));
          const updatePayload = { currentLang: chosenLang };
          if (pendingGoal && [10, 20, 30, 50].includes(pendingGoal)) {
            updatePayload.dailyGoal = pendingGoal;
          }
          if (l.active) {
            S.user = (await api('PATCH', '/api/me', updatePayload)).user;
            LS.set('lf_lang_selected_' + S.user.id, chosenLang);
            sessionStorage.setItem('lf_entered_lang_' + S.user.id, '1');
            await loadCourse();
            toast(`${l.flag} ${l.name} darslari boshlandi! 🚀`);
            if (chosenGoal === 'jarvis') {
              location.hash = '#/tutor';
            } else if (chosenGoal === 'ielts') {
              location.hash = '#/exams';
            } else if (chosenGoal === 'placement') {
              location.hash = '#/learn';
              setTimeout(startPlacement, 300);
            } else {
              location.hash = '#/learn';
            }
          } else {
            // Extra catalog language with JARVIS AI voice tutor
            if (pendingGoal && [10, 20, 30, 50].includes(pendingGoal) && S.user.dailyGoal !== pendingGoal) {
              try { S.user = (await api('PATCH', '/api/me', { dailyGoal: pendingGoal })).user; } catch {}
            }
            LS.set('lf_lang_selected_' + S.user.id, chosenLang);
            LS.set('lf_jarvis_target_lang', chosenLang);
            sessionStorage.setItem('lf_entered_lang_' + S.user.id, '1');
            toast(`${l.flag} ${l.name} uchun JARVIS AI Ovozli murabbiyi tayyor! 🎙️`);
            location.hash = '#/tutor';
          }
          route();
        } catch (ex) {
          toast(ex.message);
          ctaBtn.disabled = false;
        }
      }
    });

    const regBtn = !S.user
      ? h('button', {
          class: 'start-btn-secondary',
          type: 'button',
          onclick: () => {
            location.hash = `#/register?lang=${chosenLang}`;
            route();
          }
        }, '👤 Ro\'yxatdan o\'tish (Shaxsiy hisob yaratish va progressni saqlash)')
      : null;

    function updateSelection() {
      const l = getLangObj(chosenLang);
      ctaBtn.textContent = l.active
        ? `🚀 ${l.flag} ${l.name} darslarini boshlash →`
        : `🎙️ ${l.flag} ${l.name} bilan JARVIS AI Ovozli darsni boshlash →`;

      Array.from(grid.querySelectorAll('.start-card')).forEach((c) => {
        const isMatch = c.dataset.langCode === chosenLang;
        c.classList.toggle('active', isMatch);
        const chk = c.querySelector('.start-check');
        if (chk) chk.textContent = isMatch ? '✓' : '';
        const metaTag = c.querySelector('.start-card-meta span:last-child');
        if (metaTag) metaTag.textContent = isMatch ? 'Tanlangan ✓' : 'Tanlash →';
      });

      Array.from(savedSection.querySelectorAll('.saved-card-compact')).forEach((c) => {
        const isMatch = c.dataset.savedLangCode === chosenLang;
        c.classList.toggle('active', isMatch);
      });
    }
    updateSelection();

    const ctaBar = h('div', { class: 'start-cta-bar' }, ctaBtn, regBtn);

    container.append(topBar, head, dailyGoalCard, searchWrap, searchStatus, filterBar, savedSection, grid, goalBox, ctaBar);
    mount(container);
    window.scrollTo(0, 0);
  }

  // ---------- auth ----------
  function getQueryLang() {
    try {
      const sp = new URLSearchParams(location.search);
      if (sp.get('lang')) return sp.get('lang');
      const hp = parseHash().params;
      if (hp.get('lang')) return hp.get('lang');
    } catch {}
    return null;
  }

  function renderAuth(mode, presetEmail = '') {
    const isReg = mode === 'register';
    const isReset = mode === 'reset';
    let chosenLang = getQueryLang() || (S.langs[0] ? S.langs[0].code : 'en');
    const err = h('div', { class: 'form-err', role: 'alert' });
    const name = h('input', { type: 'text', autocomplete: 'name', required: true, maxlength: 40, placeholder: 'Ismingiz' });
    const email = h('input', { type: 'email', autocomplete: 'email', required: true, placeholder: 'email@example.com', value: presetEmail });
    const pass = h('input', { type: 'password', autocomplete: isReg || isReset ? 'new-password' : 'current-password', required: true, minlength: 8, placeholder: isReg ? 'Kamida 8 belgi' : isReset ? 'Yangi parol (kamida 8 belgi)' : 'Parol' });
    const submitText = isReg ? "Ro'yxatdan o'tish" : isReset ? "Parolni yangilash va kirish" : 'Kirish';
    const btn = h('button', { class: 'btn btn-main btn-block', type: 'submit' }, submitText);

    // Language selector badge for auth
    const authLangIcon = h('span', { class: 'fl' }, langMeta(chosenLang)?.flag || '🇬🇧');
    const authLangName = h('span', {}, (langMeta(chosenLang)?.name || 'Ingliz tili') + ' ▾');
    const authLangBadge = h('div', {
      class: 'auth-lang-banner',
      role: 'button',
      tabIndex: 0,
      title: "O'rganmoqchi bo'lgan tilni tanlang",
      onclick: () => {
        openLangPicker({
          mustPick: false,
          title: "O'rganmoqchi bo'lgan tilingizni tanlang",
          subtitle: "Qaysi tilni o'rganishni rejalashtiryapsiz?",
          onSelect: (l) => {
            chosenLang = l.code;
            authLangIcon.textContent = l.flag;
            authLangName.textContent = l.name + ' ▾';
          }
        });
      }
    },
      h('span', { class: 'lbl' }, "O'rganmoqchi bo'lgan til:"),
      h('span', { class: 'curr' }, authLangIcon, authLangName));

    const onAuthSuccess = async (res) => {
      if (res.token) LS.set('lf_token', res.token);
      S.user = res.user;
      await loadLangs();
      if (chosenLang && chosenLang !== S.user.currentLang) {
        try { S.user = (await api('PATCH', '/api/me', { currentLang: chosenLang })).user; } catch {}
      }
      // Saytga kirish paytida birinchi navbatda o'rganmoqchi bo'lgan tilni tanlashi kerak:
      const hasChosen = getQueryLang() || sessionStorage.getItem('lf_entered_lang_' + S.user.id) || LS.get('lf_lang_selected_' + S.user.id);
      if (!hasChosen) {
        openLangPicker({
          mustPick: true,
          title: "Xush kelibsiz! Tilni tanlang",
          subtitle: "LinguaFlow bilan o'rganishni boshlash uchun avvalo tilni tanlang:"
        });
      } else {
        LS.set('lf_lang_selected_' + S.user.id, S.user.currentLang);
        sessionStorage.setItem('lf_entered_lang_' + S.user.id, '1');
        await loadCourse();
        location.hash = '#/learn';
        route();
      }
    };

    const guestBtn = h('button', {
      type: 'button',
      class: 'btn btn-ghost btn-block',
      style: { marginTop: '10px' },
      onclick: async () => {
        guestBtn.disabled = true; err.textContent = '';
        try {
          const res = await api('POST', '/api/auth/guest', {});
          await onAuthSuccess(res);
        } catch (ex) { err.textContent = ex.message; }
        finally { guestBtn.disabled = false; }
      }
    }, '⚡ Sinab ko\'rish (Mehmon)');

    const langChips = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center', margin: '12px 0 16px' } },
      S.langs.map((l) => {
        const btn = h('button', {
          type: 'button',
          class: 'chip' + (l.code === chosenLang ? ' on' : ''),
          style: { cursor: 'pointer', fontSize: '.8rem', padding: '5px 10px', border: l.code === chosenLang ? '1.5px solid var(--brand)' : '1px solid var(--line2)' },
          onclick: () => {
            chosenLang = l.code;
            authLangIcon.textContent = l.flag;
            authLangName.textContent = l.name + ' ▾';
            Array.from(langChips.children).forEach((c) => c.classList.remove('on'));
            btn.classList.add('on');
          }
        }, l.flag + ' ' + l.name);
        return btn;
      }));

    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); err.textContent = ''; btn.disabled = true;
        try {
          const endpoint = isReg ? '/api/auth/register' : isReset ? '/api/auth/reset-password' : '/api/auth/login';
          const body = { email: email.value, password: pass.value, ...(isReg ? { name: name.value } : {}) };
          const res = await api('POST', endpoint, body);
          await onAuthSuccess(res);
        } catch (ex) { err.textContent = ex.message; } finally { btn.disabled = false; }
      },
    },
      authLangBadge,
      isReg ? h('label', { class: 'field' }, h('span', {}, 'Ism'), name) : null,
      h('label', { class: 'field' }, h('span', {}, 'Email'), email),
      h('label', { class: 'field' }, h('span', {}, isReset ? 'Yangi parol' : 'Parol'), pass),
      err, btn, (!isReg && !isReset) ? guestBtn : null);

    const title = isReg ? 'Hisob yarating' : isReset ? 'Parolni tiklash' : 'Xush kelibsiz!';
    const sub = isReg ? "Bepul boshlang va 6 ta tilni o'rganing." : isReset ? "Email va yangi parolingizni kiriting." : 'Davom etish uchun hisobingizga kiring.';

    const forgotLink = (!isReg && !isReset) ? h('div', { style: { textAlign: 'right', marginTop: '8px', fontSize: '.88rem' } }, h('a', { href: '#/reset', style: { color: 'var(--muted)' } }, 'Parolni unutdingizmi?')) : null;

    let switchContent;
    if (isReg) {
      switchContent = ['Hisobingiz bormi? ', h('a', { href: '#/login' }, 'Kirish')];
    } else if (isReset) {
      switchContent = ['Esladingizmi? ', h('a', { href: '#/login' }, 'Kirish')];
    } else {
      switchContent = ["Hisobingiz yo'qmi? ", h('a', { href: '#/register' }, "Ro'yxatdan o'tish")];
    }

    const startLink = h('div', { style: { textAlign: 'center', marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--line)' } },
      h('a', { href: '#/start', style: { fontSize: '.86rem', color: 'var(--brand)', textDecoration: 'none', fontWeight: '700' } }, '🌍 Barcha tillarni ko\'rish va noldan boshlash →'));

    mount(h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' },
      h('a', { href: '/', class: 'logo' }, h('span', { class: 'logo-mark' }, 'L'), 'LinguaFlow'),
      h('h1', {}, title),
      h('p', { class: 'sub' }, sub),
      langChips,
      form,
      forgotLink,
      h('div', { class: 'auth-switch' }, ...switchContent),
      startLink)));
    (isReg ? name : email).focus();
  }

  // ---------- shell ----------
  async function shell(active, content, { wide = false } = {}) {
    const due = S.course ? S.course.due : 0;
    const items = [...NAV, ...(S.user.isAdmin ? [['/admin', '🛠️', 'Admin panel']] : [])];
    const link = (p, cls, kids) => (p === '/admin' ? h('a', { href: '/admin', class: cls }, kids) : h('a', { href: '#' + p, class: cls + (active === p ? ' on' : '') }, kids));
    const sideTheme = h('div', { class: 'side-theme-wrap' },
      createThemeToggleBtn({ showLabel: true, extraClass: 'side-theme-btn' }));
    const side = h('aside', { class: 'side' },
      h('a', { href: '#/learn', class: 'logo' }, h('span', { class: 'logo-mark' }, 'L'), 'LinguaFlow'),
      items.map(([p, ic, label]) => link(p, 'nav-item', [h('span', { class: 'ic' }, ic), label, p === '/review' && due ? h('span', { class: 'count' }, due) : null])),
      sideTheme);
    const lm = langMeta(S.user.currentLang);
    const themeBtn = createThemeToggleBtn();
    const top = h('header', { class: 'topbar' },
      h('div', { class: 'logo-sm' }, h('span', { class: 'logo-mark' }, 'L')),
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
        h('button', { class: 'chip lang', title: "Tilni o'zgartirish", onclick: openLangPicker }, h('span', { class: 'fl' }, lm ? lm.flag : '🌍'), lm ? lm.name : 'Til'),
        h('span', { class: 'chip fire', title: 'Ketma-ket kunlar' }, '🔥 ', S.user.streak),
        h('span', { class: 'chip xp', title: 'Jami XP' }, '⭐ ', S.user.xp),
        themeBtn));
    const tabs = h('nav', { class: 'tabbar' }, TABS.map((p) => { const [, ic, label] = NAV.find((n) => n[0] === p); return link(p, 'tab', [h('span', { class: 'ic' }, ic), label, p === '/review' && due ? h('span', { class: 'count' }, due) : null]); }));
    const note = S.config && S.config.announcement ? h('div', { class: 'announce ' + S.config.announcement.level }, '📢 ', S.config.announcement.text) : null;
    mount(h('div', { class: 'shell' }, side, h('div', { class: 'main' }, top, h('main', { class: 'page' + (wide ? ' wide' : '') }, note, content)), tabs));
    window.scrollTo(0, 0);
  }

  function openLangPicker(opts = {}) {
    const {
      mustPick = false,
      title = "Qaysi tilni o'rganasiz?",
      subtitle = "O'rganmoqchi bo'lgan asosiy tilingizni tanlang:",
      onSelect = null,
    } = typeof opts === 'object' && opts !== null && !opts.target ? opts : {};

    document.querySelectorAll('.lang-modal-bg').forEach((m) => m.remove());
    const close = () => { if (!mustPick) bg.remove(); };

    let modalCat = 'all';
    let modalQ = '';

    const filterBar = h('div', { class: 'lang-filter-bar', style: { marginBottom: '14px', gap: '6px' } });
    const searchInput = h('input', {
      type: 'text',
      class: 'lang-search-input',
      placeholder: '🔍 Qidirish (masalan: Nemis, Koreys, Arab...)',
      style: { padding: '9px 14px 9px 36px', fontSize: '.86rem' }
    });
    const searchWrap = h('div', { class: 'lang-search-bar', style: { marginBottom: '14px', maxWidth: '100%' } },
      h('span', { class: 'lang-search-icon', style: { left: '12px' } }, '🔍'),
      searchInput);

    const pickGrid = h('div', { class: 'lang-pick-grid' });

    function renderModalCats() {
      filterBar.replaceChildren();
      const savedCodes = getSavedLangs();
      LANG_CATEGORIES.forEach((cat) => {
        const count = cat.id === 'all'
          ? LANG_CATALOG.length
          : (cat.id === 'saved' ? savedCodes.length : LANG_CATALOG.filter((x) => x.category === cat.id).length);
        const btn = h('button', {
          type: 'button',
          class: 'lang-filter-btn' + (cat.id === modalCat ? ' active' : ''),
          style: { padding: '6px 12px', fontSize: '.82rem' },
          onclick: () => {
            modalCat = cat.id;
            renderModalCats();
            renderModalGrid();
          }
        }, `${cat.icon} ${cat.name} (${count})`);
        filterBar.append(btn);
      });
    }

    function renderModalGrid() {
      pickGrid.replaceChildren();
      const savedCodes = getSavedLangs();
      const list = LANG_CATALOG.map((catItem) => {
        const dbLang = S.langs.find((x) => x.code === catItem.code);
        return {
          ...catItem,
          lessons: dbLang ? dbLang.lessons : catItem.lessons,
          done: dbLang ? (dbLang.done || 0) : 0,
          ...(dbLang ? { active: true } : {}),
        };
      }).filter((l) => {
        const matchesCat = modalCat === 'all'
          ? true
          : (modalCat === 'saved' ? savedCodes.includes(l.code) : l.category === modalCat);
        const matchesQ = !modalQ ||
          l.name.toLowerCase().includes(modalQ) ||
          l.native.toLowerCase().includes(modalQ) ||
          l.categoryName.toLowerCase().includes(modalQ);
        return matchesCat && matchesQ;
      });

      if (!list.length) {
        pickGrid.append(h('div', { style: { gridColumn: '1/-1', textAlign: 'center', padding: '20px', color: 'var(--muted)' } }, 'Til topilmadi'));
        return;
      }

      list.forEach((l) => {
        const isCurr = S.user && l.code === S.user.currentLang;
        const isPinned = savedCodes.includes(l.code);
        const done = Number(l.done) || 0;
        const total = Number(l.lessons) || 30;
        const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
        const pinBtn = h('button', {
          type: 'button',
          class: 'lang-pin-btn' + (isPinned ? ' pinned' : ''),
          style: { marginLeft: '8px', width: '26px', height: '26px', fontSize: '.78rem' },
          title: isPinned ? 'Saqlanganlardan chiqarish' : 'Saqlanganlarga qadash',
          onclick: (e) => {
            e.stopPropagation();
            const nowPinned = toggleSaveLang(l.code);
            toast(nowPinned ? `📌 ${l.name} saqlanganlarga qo'shildi!` : `📌 ${l.name} saqlanganlardan olib tashlandi`);
            renderModalCats();
            renderModalGrid();
          }
        }, '📌');

        const card = h('button', {
          class: 'lang-card-btn' + (isCurr ? ' active' : ''),
          style: { '--c': l.color },
          onclick: async () => {
            if (onSelect) onSelect(l);
            try {
              if (S.user) {
                if (l.active) {
                  S.user = (await api('PATCH', '/api/me', { currentLang: l.code })).user;
                  LS.set('lf_lang_selected_' + S.user.id, l.code);
                  sessionStorage.setItem('lf_entered_lang_' + S.user.id, '1');
                  bg.remove();
                  await loadCourse();
                  toast(`${l.flag} ${l.name} tanlandi! Xush kelibsiz! 🚀`);
                  location.hash = '#/learn';
                  route();
                } else {
                  LS.set('lf_lang_selected_' + S.user.id, l.code);
                  LS.set('lf_jarvis_target_lang', l.code);
                  sessionStorage.setItem('lf_entered_lang_' + S.user.id, '1');
                  bg.remove();
                  toast(`${l.flag} ${l.name} uchun JARVIS AI Ovozli murabbiyi ochildi! 🎙️`);
                  location.hash = '#/tutor';
                  route();
                }
              } else {
                bg.remove();
              }
            } catch (e) { toast(e.message); }
          },
        },
          h('span', { class: 'fl' }, l.flag),
          h('div', { class: 'tx' },
            h('b', {}, l.name),
            h('span', { class: 'subt' }, `${l.native} · ${l.categoryName}`),
            h('div', { class: 'modal-card-progress' },
              h('div', { class: 'modal-progress-track' },
                h('div', {
                  class: 'modal-progress-fill',
                  style: {
                    width: `${pct}%`,
                    background: pct === 100 ? '#22d39a' : (pct > 0 ? `linear-gradient(90deg, ${l.color}, #00d4ff)` : 'rgba(255,255,255,.15)')
                  }
                })),
              h('span', { class: 'modal-progress-pct', style: { color: pct > 0 ? '#00d4ff' : 'var(--muted)' } }, `${pct}%`))),
          isCurr
            ? h('span', { class: 'tag-curr' }, 'Tanlangan')
            : h('span', { class: 'start-status-badge ' + (l.active ? 'active' : 'ai-ready'), style: { marginLeft: 'auto' } }, l.active ? 'Faol' : 'JARVIS AI'),
          pinBtn);
        pickGrid.append(card);
      });
    }

    searchInput.oninput = (e) => {
      modalQ = e.target.value.trim().toLowerCase();
      renderModalGrid();
    };

    renderModalCats();
    renderModalGrid();

    const bg = h('div', { class: 'modal-bg lang-modal-bg', onclick: (e) => { if (e.target === bg) close(); } },
      h('div', { class: 'modal lang-modal', role: 'dialog', 'aria-modal': 'true' },
        h('div', { class: 'lang-modal-head' },
          h('h2', {}, title),
          h('p', {}, subtitle)),
        filterBar,
        searchWrap,
        pickGrid,
        !mustPick ? h('div', { style: { textAlign: 'center', marginTop: '18px' } },
          h('button', { class: 'btn btn-ghost', onclick: () => bg.remove() }, 'Yopish')) : null));
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

    const certBadge = c.lang.code === 'en' ? '🎓 IELTS (Band 4.0 - 8.5+) & CEFR (A1 - C1)'
      : c.lang.code === 'de' ? '🎓 Goethe-Zertifikat · TestDaF (A1 - C1)'
      : c.lang.code === 'ru' ? '🎓 TRKI / TORFL (A1 - C1)'
      : c.lang.code === 'fr' ? '🎓 DELF / DALF (A1 - C1)'
      : c.lang.code === 'es' ? '🎓 DELE / SIELE (A1 - C1)'
      : '🎓 ALPT & Fasih arab tili (A1 - C1)';

    const langStrip = h('div', { class: 'learn-lang-strip' },
      h('div', { class: 'learn-lang-left' },
        h('span', { class: 'learn-lang-flag' }, c.lang.flag),
        h('div', {},
          h('div', { class: 'learn-lang-title' }, `${c.lang.name} (${c.lang.native})`),
          h('div', { class: 'learn-lang-tag' }, certBadge))),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        h('button', { class: 'learn-lang-btn', onclick: () => { location.hash = '#/start'; route(); } }, '🔄 Boshqa tilni tanlash'),
        h('a', { class: 'learn-lang-btn', href: '#/tutor', style: { color: '#00d4ff', borderColor: 'rgba(0,212,255,.4)' } }, '🎙️ JARVIS bilan gaplashish')));

    const hero = h('div', { class: 'hero-row' },
      h('div', {}, h('h2', {}, `Salom, ${u.name.split(' ')[0]}! 👋`), h('p', {}, goalMsg), h('p', {}, `${c.lang.name}: ${doneN}/${all.length} dars · ${c.words.learned} so'z o'rganilgan`)),
      ring(u.dailyXp / u.dailyGoal, `${Math.min(u.dailyXp, 999)}`, `/ ${u.dailyGoal} XP`));

    const goalOptions = [10, 20, 30, 50];
    const isGoalDone = u.dailyXp >= u.dailyGoal;
    const goalStreak = u.goalStreak != null ? u.goalStreak : (u.streak || 0);
    const learnGoalBar = h('div', { class: 'learn-goal-row' },
      h('div', { class: 'learn-goal-left' },
        h('span', { style: { fontSize: '1.2rem' } }, isGoalDone ? '🏆' : '🎯'),
        h('div', {},
          h('div', { style: { fontWeight: '800', fontSize: '.88rem', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            `Kunlik maqsad: ${u.dailyGoal} XP/kun · `,
            h('span', { style: { color: isGoalDone ? '#22d39a' : '#00d4ff' } },
              isGoalDone ? 'Bajarildi! 🎉' : `${Math.min(100, Math.round((u.dailyXp / u.dailyGoal) * 100))}%`),
            h('span', { class: 'learn-goal-streak-pill' + (isGoalDone ? ' done' : '') },
              `🔥 ${goalStreak} kunlik seriya`)),
          h('div', { style: { fontSize: '.76rem', color: 'var(--muted)' } },
            isGoalDone
              ? `Ajoyib! Bugun jami ${u.dailyXp} XP to'plandi (+${u.dailyXp - u.dailyGoal} XP ortiqcha) · Seriyangiz davom etmoqda 🔥`
              : `Bugun ${u.dailyXp} XP to'plandi · Seriyani davom ettirish uchun yana ${u.dailyGoal - u.dailyXp} XP qoldi`))),
      h('div', { class: 'learn-goal-chips' },
        h('span', { style: { fontSize: '.76rem', color: 'var(--muted)', marginRight: '4px' } }, 'Maqsad:'),
        ...goalOptions.map((g) => h('button', {
          type: 'button',
          class: 'learn-goal-chip' + (u.dailyGoal === g ? ' active' : ''),
          title: `${g} XP/kun qilib belgilash`,
          onclick: async () => {
            if (u.dailyGoal === g) return;
            try {
              const prevHit = u.dailyXp >= u.dailyGoal;
              S.user = (await api('PATCH', '/api/me', { dailyGoal: g })).user;
              LS.set('lf_daily_goal', g);
              const nowHit = S.user.dailyXp >= S.user.dailyGoal;
              if (!prevHit && nowHit && S.user.dailyXp > 0) {
                sfx.done();
                confetti();
                toast(`🎯 Kunlik maqsad ${g} XP/kun ga o'rnatildi va bajarildi! 🎉`);
              } else {
                toast(`🎯 Kunlik maqsad ${g} XP/kun ga o'rnatildi!`);
              }
              renderLearn();
            } catch (e) {
              toast(e.message);
            }
          }
        }, `${g} XP`))));

    const quick = h('div', { class: 'quick' },
      h('a', { class: 'q-btn', href: '#/exams' }, h('span', {}, '🎓'), 'Sertifikatlar'),
      h('button', { class: 'q-btn', onclick: () => openCurriculumModal() }, h('span', {}, '📘'), 'Dars rejasi'),
      h('button', { class: 'q-btn', onclick: startPlacement }, h('span', {}, '🧭'), 'Daraja testi'),
      h('a', { class: 'q-btn', href: '#/games' }, h('span', {}, '🎮'), "O'yinlar"),
      h('a', { class: 'q-btn', href: '#/dictionary' }, h('span', {}, '📚'), "Lug'at"),
      h('a', { class: 'q-btn', href: '#/tutor' }, h('span', {}, '🎙️'), 'JARVIS Ustoz'));
    const placeBanner = doneN === 0 ? h('div', { class: 'banner place' }, h('span', { class: 'em' }, '🧭'),
      h('div', { class: 'tx' }, h('b', {}, "Bilasizmi? Daraja testidan o'ting"), h('small', {}, "Biladigan mavzularni o'tkazib yuborasiz va rasmiy CEFR sertifikatiga ega bo'lasiz")),
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

    // Curriculum organized into 5 official CEFR certification stages (A1, A2, B1, B2, C1)
    const CEFR_STAGES = [
      {
        level: 'A1',
        title: "1-Bosqich: A1 · Boshlang'ich",
        desc: "Salomlashish, raqamlar, oila va oziq-ovqat",
        target: "CEFR A1 Sertifikati",
        from: 0, to: 4,
      },
      {
        level: 'A2',
        title: "2-Bosqich: A2 · Elementar muloqot",
        desc: "Sayohat, ranglar, hayvonlar va tana a'zolari",
        target: "IELTS 4.0 · Goethe A2 · DELF A2",
        from: 4, to: 8,
      },
      {
        level: 'B1',
        title: "3-Bosqich: B1 · O'rta mustaqil daraja",
        desc: "Hafta kunlari, vaqt, uy-ro'zg'or va shahar hayoti",
        target: "IELTS 5.0 - 5.5 · Goethe B1 · DELE B1",
        from: 8, to: 12,
      },
      {
        level: 'B2',
        title: "4-Bosqich: B2 · O'rtadan yuqori (Professional)",
        desc: "Ob-havo, tabiat, kiyim-kechak, kasblar va fe'llar",
        target: "IELTS 6.0 - 6.5 · Goethe B2 · TestDaF 3",
        from: 12, to: 16,
      },
      {
        level: 'C1',
        title: "5-Bosqich: C1 · Ilg'or & Akademik mukammallik",
        desc: "Harakatlar, nozik sifatlar, tuyg'ular va ilmiy o'qish",
        target: "IELTS 7.0 - 8.5 Akademik · Goethe C1 · DALF C1",
        from: 16, to: 20,
      },
    ];

    const stageElements = CEFR_STAGES.map((st) => {
      const stageUnits = c.units.slice(st.from, st.to);
      if (!stageUnits.length) return null;
      const stageLessons = stageUnits.flatMap((u) => u.lessons);
      const stageDone = stageLessons.filter((l) => l.state === 'done').length;
      const stageAll = stageLessons.length;

      const header = h('div', { class: 'cefr-stage-header' },
        h('div', { class: 'cefr-stage-info' },
          h('span', { class: 'cefr-pill' }, st.level),
          h('h3', { class: 'cefr-stage-title' }, st.title),
          h('div', { class: 'cefr-stage-desc' }, st.desc),
          h('div', { class: 'cefr-stage-target' },
            h('span', { class: 'muted' }, 'Imtihon maqsadi:'),
            h('span', { class: 'cefr-target-badge' }, st.target))),
        h('div', { class: 'cefr-stage-action' },
          h('div', { style: { textAlign: 'right', fontSize: '.84rem', color: 'var(--muted)', marginRight: '6px' } },
            h('b', { style: { color: 'var(--text)', display: 'block', fontSize: '1.05rem' } }, `${stageDone}/${stageAll}`),
            'dars o\'tildi'),
          h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' } },
            h('button', { class: 'btn btn-ghost', onclick: () => openCurriculumModal(null, st.level) }, '📘 Dars rejasi'),
            h('a', { class: 'btn btn-ghost', href: '#/exams' }, '🎓 Sertifikat sinovi'))));

      const unitNodes = stageUnits.map((un) => h('section', { class: 'unit' },
        h('div', { class: 'unit-head' },
          h('span', { class: 'em' }, un.emoji),
          h('div', {},
            h('h3', {}, un.title),
            h('small', {}, `${un.lessons.filter((l) => l.state === 'done').length}/${un.lessons.length} dars`))),
        h('div', { class: 'nodes' },
          un.lessons.map((l) => node(l, l.title, l.state === 'done' ? '✓' : l.index)),
          un.test ? node(un.test, 'Mavzu testi', un.test.state === 'done' ? '👑' : '🏁') : null)));

      return h('div', { class: 'cefr-stage-wrapper' }, header, unitNodes);
    }).filter(Boolean);

    await shell('/learn', [langStrip, hero, learnGoalBar, quick, placeBanner, banner, stageElements]);
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

  // ---------- certificates & exams ----------
  function openCertificateModal(cert) {
    if (!cert) return;
    const close = () => bg.remove();
    const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) close(); } },
      h('div', { class: 'modal cert-modal', role: 'dialog', 'aria-modal': 'true' },
        h('div', { class: 'cert-paper' },
          h('div', { class: 'cert-seal' }, '🏆'),
          h('div', { class: 'cert-org' }, 'LinguaFlow International Language Academy'),
          h('h2', { class: 'cert-headline' }, 'RASMIY SERTIFIKAT'),
          h('div', { class: 'cert-sub' }, 'Xalqaro CEFR & IELTS Ekvivalent Standarti bo\'yicha berildi'),
          h('div', { class: 'cert-name' }, cert.user_name || cert.userName || S.user.name),
          h('p', { class: 'cert-desc' },
            `Ushbu sertifikat egasi ${cert.lang || (S.course && S.course.lang && S.course.lang.name) || 'Ingliz tili'} bo'yicha ${cert.cefr_level || cert.cefrLevel || 'B2'} (${cert.exam_title || cert.examTitle || 'IELTS Ekvivalenti'}) darajasidagi xalqaro imtihon sinovini ${cert.accuracy || 85}% aniqlik bilan muvaffaqiyatli topshirganligini tasdiqlaydi.`),
          h('div', { class: 'cert-badge-row' },
            h('div', { class: 'cert-stat' }, h('b', {}, cert.cefr_level || cert.cefrLevel || 'B2'), h('span', {}, 'CEFR Darajasi')),
            h('div', { class: 'cert-stat' }, h('b', {}, `Band ${cert.band_score || cert.bandScore || '6.5'}`), h('span', {}, 'IELTS / Band Balli')),
            h('div', { class: 'cert-stat' }, h('b', {}, `${cert.accuracy || 85}%`), h('span', {}, 'Imtihon Aniqligi'))),
          h('div', { class: 'cert-foot' },
            h('span', {}, `Sertifikat ID: ${cert.cert_id || cert.certId}`),
            h('span', {}, `Berilgan sana: ${new Date(cert.issued_at || cert.issuedAt || Date.now()).toLocaleDateString('uz-UZ')}`)),
          h('div', { class: 'cert-actions' },
            h('button', { class: 'btn btn-main', onclick: () => window.print() }, '🖨️ Chop etish / PDF saqlash'),
            h('button', { class: 'btn btn-ghost', onclick: close }, 'Yopish')))));
    document.body.append(bg);
  }

  async function openCurriculumModal(currData = null, initialLevel = 'A1') {
    let data = currData;
    if (!data) {
      try {
        data = await api('GET', `/api/curriculum?lang=${S.user.currentLang}`);
      } catch (e) {
        return toast(e.message);
      }
    }
    const stages = data.stages || [];
    let selectedLevel = initialLevel || 'A1';

    const close = () => bg.remove();
    const contentBox = h('div', { class: 'syllabus-body' });

    function renderStageDetail(level) {
      const st = stages.find((s) => s.level === level) || stages[0];
      if (!st) return;
      selectedLevel = level;
      tabs.forEach((tb) => {
        tb.el.classList.toggle('active', tb.level === level);
      });

      contentBox.replaceChildren(
        h('div', { class: 'stage-detail-box' },
          h('div', { class: 'stage-meta-row' },
            h('div', { class: 'stage-meta-item' }, h('small', {}, 'IELTS Ekvivalenti'), h('b', {}, `Band ${st.ieltsBand}`)),
            h('div', { class: 'stage-meta-item' }, h('small', {}, 'Xalqaro Sertifikat'), h('b', {}, st.certTarget)),
            h('div', { class: 'stage-meta-item' }, h('small', {}, 'Faol So\'z Boyligi'), h('b', {}, st.targetWords)),
            h('div', { class: 'stage-meta-item' }, h('small', {}, 'Mavzular diapazoni'), h('b', {}, st.unitsRange))),
          h('div', {},
            h('h4', { class: 'syllabus-sec-title' }, '🎯 Bosqich maqsadi va tavsifi'),
            h('p', { style: { color: 'var(--text)', fontSize: '.95rem', lineHeight: '1.5' } }, st.desc)),
          h('div', {},
            h('h4', { class: 'syllabus-sec-title' }, '📝 Asosiy Grammatika Mavzulari (Grammar Blueprint)'),
            h('ul', { class: 'grammar-list' },
              st.grammarTopics.map((g) => h('li', { class: 'grammar-item' }, `✓ ${g}`)))),
          h('div', {},
            h('h4', { class: 'syllabus-sec-title' }, '🎓 4 ta Asosiy Imtihon Ko\'nikmasi (Skills Mastery)'),
            h('div', { class: 'skills-breakdown-grid' },
              h('div', { class: 'skill-box' }, h('h5', {}, '🎧 Listening (Eshitish)'), h('p', {}, st.skills.listening)),
              h('div', { class: 'skill-box' }, h('h5', {}, '📖 Reading (O\'qish)'), h('p', {}, st.skills.reading)),
              h('div', { class: 'skill-box' }, h('h5', {}, '✍️ Writing (Yozish)'), h('p', {}, st.skills.writing)),
              h('div', { class: 'skill-box' }, h('h5', {}, '🗣️ Speaking (So\'zlashish)'), h('p', {}, st.skills.speaking)))),
          h('div', { class: 'exam-tips-box' },
            h('h4', {}, '💡 IELTS & Xalqaro Imtihondan O\'tish Maslahatlari'),
            h('ul', {}, st.examTips.map((tip) => h('li', {}, tip)))),
          h('div', { style: { display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' } },
            h('button', {
              class: 'btn btn-main',
              onclick: () => { close(); openExamSimulator(st.level); }
            }, `📝 ${st.level} Sinovini topshirish (Band ${st.ieltsBand})`),
            h('button', { class: 'btn btn-ghost', onclick: close }, 'Yopish'))
        )
      );
    }

    const tabs = stages.map((st) => {
      const el = h('button', {
        class: `syllabus-tab${st.level === selectedLevel ? ' active' : ''}`,
        onclick: () => renderStageDetail(st.level),
      }, `${st.level} · Band ${st.ieltsBand}`);
      return { level: st.level, el };
    });

    const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) close(); } },
      h('div', { class: 'modal syllabus-modal', role: 'dialog', 'aria-modal': 'true' },
        h('div', { class: 'syllabus-header' },
          h('h2', {}, `📘 ${data.lang.name} Mukammal Dars Rejasi`),
          h('p', { class: 'muted', style: { margin: 0, fontSize: '.92rem' } },
            'CEFR (A1-C1) va IELTS (Band 4.0 - 8.5+) bo\'yicha to\'liq standartlashtirilgan o\'quv dasturi.')),
        h('div', { class: 'syllabus-tabs' }, tabs.map((t) => t.el)),
        contentBox));

    document.body.append(bg);
    renderStageDetail(selectedLevel);
  }

  async function openExamSimulator(level = 'B2') {
    toast(`⏳ ${level} darajadagi xalqaro imtihon tayyorlanmoqda...`);
    let data;
    try {
      data = await api('GET', `/api/exams/mock?lang=${S.user.currentLang}&level=${level}`);
    } catch (e) {
      return toast(e.message);
    }

    const close = () => { clearInterval(timerInterval); bg.remove(); };
    const answers = {};
    let secondsLeft = (data.meta.timeLimitMinutes || 20) * 60;

    const timerEl = h('div', { class: 'exam-sim-timer' }, '⏱️ 20:00');
    const timerInterval = setInterval(() => {
      secondsLeft--;
      if (secondsLeft <= 0) {
        clearInterval(timerInterval);
        submitExam();
        return;
      }
      const m = Math.floor(secondsLeft / 60);
      const s = secondsLeft % 60;
      timerEl.textContent = `⏱️ ${m}:${s < 10 ? '0' : ''}${s}`;
    }, 1000);

    const container = h('div', { class: 'exam-sim-body', style: { display: 'flex', flexDirection: 'column', gap: '20px' } });

    // Listening section
    const lSection = h('div', {},
      h('h3', { style: { color: 'var(--a2)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' } }, '🎧 1-Bo\'lim: Tinglab Tushunish (Listening)'),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
        data.listening.map((q, idx) => {
          const optContainer = h('div', { class: 'exam-opts' });
          const btns = q.options.map((opt) => {
            const btn = h('button', {
              class: 'exam-opt-btn',
              onclick: () => {
                answers[q.id] = opt;
                btns.forEach((b) => b.classList.remove('selected'));
                btn.classList.add('selected');
              }
            }, h('span', { class: 'exam-opt-circle' }, ''), opt);
            return btn;
          });
          btns.forEach((b) => optContainer.append(b));

          return h('div', { class: 'exam-q-box' },
            h('span', { class: 'exam-q-num' }, `Listening Savol #${idx + 1}`),
            h('div', { class: 'exam-audio-row' },
              h('button', {
                class: 'exam-audio-btn',
                onclick: () => speak(q.audioText, data.meta.lang.tts)
              }, '🔊 Audioni tinglash'),
              h('span', { class: 'muted', style: { fontSize: '.84rem' } }, q.tip)),
            h('div', { class: 'exam-q-text' }, q.question),
            optContainer);
        })));

    // Reading section
    const rSection = h('div', {},
      h('h3', { style: { color: '#ffc94d', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' } }, '📖 2-Bo\'lim: O\'qish va Tahlil (Reading Comprehension)'),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
        data.reading.map((q, idx) => {
          const optContainer = h('div', { class: 'exam-opts' });
          const btns = q.options.map((opt) => {
            const btn = h('button', {
              class: 'exam-opt-btn',
              onclick: () => {
                answers[q.id] = opt;
                btns.forEach((b) => b.classList.remove('selected'));
                btn.classList.add('selected');
              }
            }, h('span', { class: 'exam-opt-circle' }, ''), opt);
            return btn;
          });
          btns.forEach((b) => optContainer.append(b));

          return h('div', { class: 'exam-q-box' },
            h('span', { class: 'exam-q-num' }, `Reading Savol #${idx + 1}`),
            h('div', { class: 'exam-q-passage' }, q.passage),
            h('div', { class: 'exam-q-text' }, q.question),
            optContainer);
        })));

    // Grammar section
    const gSection = h('div', {},
      h('h3', { style: { color: '#ff4fa3', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' } }, '✍️ 3-Bo\'lim: Grammatika va Leksika (Grammar & Academic Lexis)'),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
        data.grammar.map((q, idx) => {
          const optContainer = h('div', { class: 'exam-opts' });
          const btns = q.options.map((opt) => {
            const btn = h('button', {
              class: 'exam-opt-btn',
              onclick: () => {
                answers[q.id] = opt;
                btns.forEach((b) => b.classList.remove('selected'));
                btn.classList.add('selected');
              }
            }, h('span', { class: 'exam-opt-circle' }, ''), opt);
            return btn;
          });
          btns.forEach((b) => optContainer.append(b));

          return h('div', { class: 'exam-q-box' },
            h('span', { class: 'exam-q-num' }, `Grammar Savol #${idx + 1}`),
            h('div', { class: 'exam-q-text' }, q.question),
            optContainer);
        })));

    // Writing/Speaking Prompt section
    const wp = data.writingPrompt;
    const wSection = h('div', {},
      h('h3', { style: { color: '#22d39a', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' } }, '🗣️ 4-Bo\'lim: Insho va Nutq Tayyorgarligi (Writing / Speaking)'),
      h('div', { class: 'exam-q-box' },
        h('h4', { style: { color: 'var(--text)', margin: 0 } }, wp.title),
        h('div', { class: 'exam-q-passage' }, wp.topic),
        h('ul', { style: { paddingLeft: '20px', margin: 0, color: 'var(--muted)', fontSize: '.86rem', lineHeight: '1.5' } },
          wp.guidelines.map((g) => h('li', {}, g))),
        h('textarea', {
          rows: 4,
          placeholder: 'Ixtiyoriy: O\'z insho yoki javobingizni shu yerda sinab yozishingiz mumkin...',
          style: { width: '100%', borderRadius: '12px', background: 'rgba(255,255,255,.05)', border: '1px solid var(--line)', padding: '10px', color: 'var(--text)', fontFamily: 'inherit' }
        })));

    container.append(lSection, rSection, gSection, wSection);

    const submitBtn = h('button', {
      class: 'btn btn-main',
      style: { padding: '14px 28px', fontSize: '1.05rem', fontWeight: '800' },
      onclick: submitExam,
    }, '🏁 Imtihonni topshirish va Sertifikat olish');

    async function submitExam() {
      clearInterval(timerInterval);
      submitBtn.disabled = true;
      submitBtn.textContent = 'Natijalar tekshirilmoqda...';

      try {
        const res = await api('POST', '/api/exams/submit', {
          examToken: data.examToken,
          answers,
        });

        modalContent.replaceChildren(
          h('div', { class: 'exam-result-box' },
            h('div', { class: 'exam-result-badge' }, res.passed ? '🎉' : '📚'),
            h('h2', { style: { fontSize: '1.8rem', fontWeight: '800', marginBottom: '8px' } },
              res.passed ? 'Tabriklaymiz! Imtihondan o\'tdingiz!' : 'Imtihon yakunlandi'),
            h('div', { class: 'exam-result-score' }, `${res.accuracy}% Aniqlik`),
            h('p', { class: 'lead', style: { color: '#ffc94d', fontWeight: '700' } },
              `${res.examTitle} · IELTS Band ${res.bandScore}`),
            h('div', { class: 'exam-result-breakdown' },
              h('div', { class: 'exam-breakdown-col' }, h('b', {}, `${res.sectionBreakdown.listening}%`), h('span', {}, 'Listening')),
              h('div', { class: 'exam-breakdown-col' }, h('b', {}, `${res.sectionBreakdown.reading}%`), h('span', {}, 'Reading')),
              h('div', { class: 'exam-breakdown-col' }, h('b', {}, `${res.sectionBreakdown.grammar}%`), h('span', {}, 'Grammar'))),
            h('p', { style: { color: 'var(--text)', fontSize: '.95rem', maxWidth: '540px', margin: '0 auto 20px', lineHeight: '1.5' } },
              res.passed
                ? 'Sizning xalqaro darajangiz rasman tasdiqlandi va rasmiy LinguaFlow Sertifikati ro\'yxatga olindi!'
                : 'Sertifikat olish uchun kamida 65% aniqlik talab etiladi. Dars rejasi bo\'yicha kamchiliklarni to\'ldirib, istalgan paytda qayta topshiring!'),
            h('div', { style: { display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' } },
              res.passed && res.certificate
                ? h('button', {
                    class: 'btn btn-main',
                    onclick: () => { close(); openCertificateModal(res.certificate); if (location.hash === '#/exams') route(); }
                  }, '🏆 Rasmiy Sertifikatni Ko\'rish')
                : null,
              h('button', {
                class: 'btn btn-ghost',
                onclick: () => { close(); if (location.hash === '#/exams') route(); }
              }, 'Yopish'),
              !res.passed
                ? h('button', {
                    class: 'btn btn-main',
                    onclick: () => { close(); openExamSimulator(level); }
                  }, '🔄 Qayta topshirish')
                : null))
        );
      } catch (e) {
        submitBtn.disabled = false;
        submitBtn.textContent = '🏁 Imtihonni topshirish va Sertifikat olish';
        toast(e.message);
      }
    }

    const modalContent = h('div', { class: 'modal exam-sim-modal', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'exam-sim-head' },
        h('div', { class: 'exam-sim-title' },
          h('span', {}, data.meta.lang.flag),
          data.meta.examTitle),
        timerEl),
      container,
      h('div', { style: { textAlign: 'center', marginTop: '12px', borderTop: '1px solid var(--line)', paddingTop: '16px' } }, submitBtn));

    const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) close(); } }, modalContent);
    document.body.append(bg);
  }

  async function renderExams() {
    await refreshUser();
    await loadCourse();

    let summary, curriculum;
    try {
      [summary, curriculum] = await Promise.all([
        api('GET', `/api/exams/summary?lang=${S.user.currentLang}`),
        api('GET', `/api/curriculum?lang=${S.user.currentLang}`),
      ]);
    } catch (e) {
      toast(e.message);
      return;
    }

    const L = summary.lang;
    const certs = summary.certificates || [];

    // Hero Header
    const hero = h('section', { class: 'exam-hero' },
      h('span', { class: 'cefr-pill', style: { marginBottom: '12px', display: 'inline-block' } }, `Xalqaro Standart · ${L.flag} ${L.name}`),
      h('h1', { class: 'exam-hero-title' }, '🎓 Xalqaro Sertifikatlar & IELTS Markazi'),
      h('p', { class: 'exam-hero-desc' },
        'CEFR (A1 dan C1 gacha) mukammal dars rejasi. IELTS (Band 4.0 - 8.5+), Goethe-Zertifikat, DELF/DALF, DELE va TRKI xalqaro sertifikat imtihonlariga 100% kafolatlangan tayyorgarlik va rasmiy attestatsiya.'),
      h('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' } },
        h('button', { class: 'btn btn-main', onclick: () => openCurriculumModal(curriculum) }, '📘 Mukammal Dars Rejasi (Syllabus)'),
        h('button', { class: 'btn btn-ghost', onclick: () => openExamSimulator(curriculum.userProgress.currentStage) }, '🎯 Sinov topshirish (Mock Test)'),
        h('a', { class: 'btn btn-ghost', href: '#/tutor' }, '🎙️ IELTS Speaking & Writing')),
      h('div', { class: 'exam-stats-bar' },
        h('div', { class: 'exam-stat-box' }, h('b', {}, `${summary.doneLessonsCount}/${summary.allLessonsCount}`), h('span', {}, 'O\'tilgan Darslar')),
        h('div', { class: 'exam-stat-box' }, h('b', {}, curriculum.userProgress.currentStage), h('span', {}, 'Joriy CEFR Darajasi')),
        h('div', { class: 'exam-stat-box' }, h('b', {}, `Band ${curriculum.userProgress.ieltsTarget}`), h('span', {}, 'IELTS Maqsad Balli')),
        h('div', { class: 'exam-stat-box' }, h('b', {}, `${certs.length} ta`), h('span', {}, 'Qo\'lga Kiritilgan Sertifikatlar')))
    );

    // 4 Skills Strategy Cards
    const skillsSection = h('section', {},
      h('h2', { style: { fontSize: '1.5rem', fontWeight: '800', marginBottom: '8px' } }, '🏆 4 Asosiy Imtihon Ko\'nikmasi (Exam Mastery)'),
      h('p', { class: 'muted', style: { marginBottom: '18px' } }, 'IELTS va boshqa xalqaro sertifikatlarda yuqori ball olish uchun 4 yo\'nalishda tizimli mashg\'ulot:'),
      h('div', { class: 'skills-strategy-grid' },
        h('div', { class: 'strategy-card' },
          h('h4', {}, '🎧 Listening (Eshitib tushunish)'),
          h('p', {}, 'Har bir darsda ona tili so\'zlashuvchilari ovozi (TTS) bilan audio tahlil. IELTS Part 1-4 formati bo\'yicha tez aytilgan raqamlar, ismlar va ilmiy ma\'ruzalarni anglash.'),
          h('ul', {},
            h('li', {}, 'Tovushlar farqi va intonatsiya'),
            h('li', {}, 'Kalit so\'zlarni oldindan ilib olish'),
            h('li', {}, 'Akademik leksika va konspekt olish'))),
        h('div', { class: 'strategy-card' },
          h('h4', {}, '📖 Reading (O\'qish va tahlil)'),
          h('p', {}, 'Skimming (umumiy ma\'no) va Scanning (aniq fakt qidirish) strategiyalari. Xalqaro matnlar, ilmiy maqolalar va True/False/Not Given savollari tahlili.'),
          h('ul', {},
            h('li', {}, 'Sinonim va parafrazalarni ilg\'ash'),
            h('li', {}, 'Matching Headings & Summary Completion'),
            h('li', {}, 'Daqiqasiga 250+ so\'z tezlikda o\'qish'))),
        h('div', { class: 'strategy-card' },
          h('h4', {}, '✍️ Writing (Insho va hisobotlar)'),
          h('p', {}, 'IELTS Academic Task 1 (Grafiklar va trendlar tavsifi) hamda Task 2 (Daliliy insholar) uchun zarur bo\'lgan rasmiy akademik bog\'lovchilar.'),
          h('ul', {},
            h('li', {}, 'Task Response: To\'liq javob berish'),
            h('li', {}, 'Coherence & Cohesion: Mantiqiy zanjir'),
            h('li', {}, 'Lexical Resource & Grammatical Accuracy'))),
        h('div', { class: 'strategy-card' },
          h('h4', {}, '🗣️ Speaking (Og\'zaki muloqot)'),
          h('p', {}, 'IELTS Speaking Part 1, 2 (Cue Card) va Part 3 bosqichlari. AI Ustoz orqali jonli suhbat, talaffuz tekshirish va ravonlik (Fluency) mashqlari.'),
          h('ul', {},
            h('li', {}, '2 daqiqa to\'xtovsiz nutq so\'zlash'),
            h('li', {}, 'Tabiiy idomatik iboralar (Band 7.5+)'),
            h('li', {}, 'Murakkab grammatik strukturalar')))));

    // 5 Stages Certification Roadmap
    const stagesSection = h('section', {},
      h('h2', { style: { fontSize: '1.5rem', fontWeight: '800', marginBottom: '8px' } }, '🗺️ Bosqichma-bosqich Sertifikat Yo\'l Xaritasi'),
      h('p', { class: 'muted', style: { marginBottom: '18px' } }, 'Har bir bosqich darslarini yakunlab, tegishli rasmiy sertifikat imtihonini topshiring:'),
      h('div', { class: 'exam-grid' },
        summary.stages.map((st) => {
          const equiv = st.equivalents[L.code] || st.examTarget;
          return h('div', { class: 'exam-card' },
            h('div', { class: 'exam-card-head' },
              h('div', { class: 'exam-card-em' }, st.level === 'A1' ? '🌱' : st.level === 'A2' ? '🌿' : st.level === 'B1' ? '🌳' : st.level === 'B2' ? '💎' : '👑'),
              h('div', {},
                h('h3', {}, st.title),
                h('div', { class: 'exam-band' }, `🎯 ${equiv}`))),
            h('div', { class: 'exam-card-body' },
              h('div', { class: 'exam-skills-chips' },
                h('span', { class: 'exam-skill-chip' }, `Talab: ${st.lessonsNeed} ta dars`),
                h('span', { class: 'exam-skill-chip' }, `Natija: ${st.doneInStage}/${st.totalInStage} (${st.percent}%)`)),
              h('div', { class: 'bar', style: { margin: '8px 0 12px' } },
                h('span', { style: { width: `${st.percent}%` } }))),
            h('div', { style: { display: 'flex', gap: '8px', marginTop: 'auto' } },
              h('button', {
                class: 'btn btn-main',
                style: { flex: 1 },
                onclick: () => openExamSimulator(st.level),
              }, '📝 Sinov topshirish'),
              h('button', {
                class: 'btn btn-ghost',
                onclick: () => openCurriculumModal(curriculum, st.level),
              }, '🔍 Dars rejasi')));
        })));

    // Earned Certificates Gallery
    const certsSection = h('section', { style: { marginTop: '30px' } },
      h('h2', { style: { fontSize: '1.5rem', fontWeight: '800', marginBottom: '8px' } }, '🎖️ Mening Sertifikatlarim'),
      certs.length === 0
        ? h('div', { class: 'empty' },
            h('span', { class: 'em' }, '📜'),
            h('h3', {}, 'Hozircha rasmiy sertifikat yo\'q'),
            h('p', { class: 'lead' }, 'Yuqoridagi bosqichlardan birini tanlang va "Sinov topshirish" tugmasini bosib, birinchi sertifikatingizni qo\'lga kiriting!'),
            h('button', { class: 'btn btn-main', onclick: () => openExamSimulator('A1') }, 'A1 Sinovini Boshlash'))
        : h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' } },
            certs.map((c) => h('div', { class: 'exam-card', style: { borderColor: '#ffc94d' } },
              h('div', { class: 'exam-card-head' },
                h('div', { class: 'exam-card-em' }, '🏆'),
                h('div', {},
                  h('h3', {}, `${c.exam_title}`),
                  h('div', { style: { color: '#00d4ff', fontWeight: '700', fontSize: '.88rem' } }, `Band ${c.band_score} · ${c.cefr_level} Daraja`))),
              h('div', { style: { fontSize: '.84rem', color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: '4px' } },
                h('div', {}, `Sertifikat ID: ${c.cert_id}`),
                h('div', {}, `Berilgan sana: ${new Date(c.issued_at).toLocaleDateString('uz-UZ')}`),
                h('div', {}, `Aniqlik darajasi: ${c.accuracy}%`)),
              h('button', {
                class: 'btn btn-main',
                style: { marginTop: '10px' },
                onclick: () => openCertificateModal(c),
              }, '🏆 Sertifikatni ko\'rish / Chop etish'))))
    );

    await shell('/exams', [hero, skillsSection, stagesSection, certsSection]);
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
        const prevDailyXp = S.user ? S.user.dailyXp : 0;
        const prevDailyGoal = S.user ? S.user.dailyGoal : 20;
        const prevHit = prevDailyXp >= prevDailyGoal;
        const res = await api('POST', `/api/sessions/${sid}/finish`, {});
        S.user = res.user;
        const nowHit = S.user ? (S.user.dailyXp >= S.user.dailyGoal) : false;
        const newlyHitGoal = !prevHit && nowHit;
        renderResult(res, meta, { newlyHitGoal });
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
    const colors = ['#7c5cff', '#00d4ff', '#ff4fa3', '#ffc94d', '#22d39a', '#ff8c32', '#38bdf8'];
    for (let i = 0; i < 75; i++) {
      const isRound = i % 3 === 0;
      const isRibbon = i % 4 === 0;
      const sizeW = isRound ? (8 + Math.random() * 6) : (isRibbon ? (6 + Math.random() * 4) : (9 + Math.random() * 6));
      const sizeH = isRound ? sizeW : (isRibbon ? (16 + Math.random() * 10) : (10 + Math.random() * 6));
      const rot = Math.round(Math.random() * 360);
      const c = h('div', {
        class: 'confetti',
        style: {
          left: (Math.random() * 100) + 'vw',
          width: sizeW + 'px',
          height: sizeH + 'px',
          borderRadius: isRound ? '50%' : '2px',
          background: colors[i % colors.length],
          animationDuration: (1.8 + Math.random() * 2) + 's',
          animationDelay: (Math.random() * 0.5) + 's',
          transform: `rotate(${rot}deg)`
        }
      });
      document.body.append(c);
      setTimeout(() => c.remove(), 4500);
    }
  }

  const badgeList = (badges) => (badges && badges.length ? h('div', { class: 'new-badges' }, badges.map((b) => h('div', { class: 'new-badge' }, h('span', { class: 'em' }, b.emoji), h('div', {}, h('b', {}, `Yangi nishon: ${b.title}`), h('div', { class: 'muted' }, b.desc))))) : null);

  function renderResult(res, meta, { newlyHitGoal = false } = {}) {
    const pct = Math.round(res.accuracy * 100);
    const good = res.passed;
    if (good || newlyHitGoal) { sfx.done(); confetti(); }
    if (newlyHitGoal && S.user) {
      toast(`🎯 Tabriklaymiz! Kunlik maqsad bajarildi (${S.user.dailyXp}/${S.user.dailyGoal} XP)! 🎉`);
    }
    const K = res.kind;
    const title = K === 'review' ? 'Takrorlash tugadi!' : K === 'placement' ? 'Daraja testi tugadi!' : K === 'test' ? (good ? "Test muvaffaqiyatli o'tildi!" : 'Test topshirilmadi') : good ? 'Dars tugadi!' : "Deyarli bo'ldi!";
    const sub = K === 'review' ? "So'zlar xotirangizda mustahkamlandi."
      : K === 'placement' ? (res.placedUnits ? `${res.placedUnits} ta mavzu o'tilgan deb hisoblandi (${res.markedLessons} ta dars ochildi) 🔓` : "Boshidan boshlaymiz — bu ham yaxshi!")
      : K === 'test' ? (good ? (res.firstTime ? 'Mavzu toji sizniki 👑' : "Yaxshi takrorlash!") : "Kamida 80% kerak. Mavzuni takrorlab, yana urinib ko'ring!")
      : good ? (res.firstTime ? 'Keyingi dars ochildi 🔓' : 'Yaxshi takrorlash!') : "Kamida 60% kerak. Yana bir urinib ko'ring!";
    mountPlayer(h('div', { class: 'p-body' }, h('div', { class: 'p-inner result' },
      h('div', { class: 'trophy' }, K === 'placement' ? '🧭' : K === 'test' && good ? '👑' : good ? '🏆' : '💪'), h('h1', {}, title), h('p', { class: 'lead' }, sub),
      (K === 'lesson' || K === 'test') && good ? h('div', { class: 'stars-big' }, [1, 2, 3].map((i) => h('span', { class: i <= res.stars ? '' : 'off' }, '★'))) : null,
      newlyHitGoal && S.user ? h('div', {
        class: 'goal-hit-banner',
        style: {
          display: 'flex', alignItems: 'center', gap: '12px',
          background: 'linear-gradient(135deg, rgba(34,211,154,.2), rgba(0,212,255,.15))',
          border: '1.5px solid #22d39a', borderRadius: '16px',
          padding: '12px 18px', margin: '14px 0', textAlign: 'left',
          animation: 'pop .4s ease-out'
        }
      },
        h('span', { style: { fontSize: '1.8rem' } }, '🎯'),
        h('div', {},
          h('b', { style: { color: '#22d39a', fontSize: '1rem', display: 'block' } }, 'Kunlik maqsad bajarildi! 🎉'),
          h('span', { style: { fontSize: '.84rem', color: 'var(--text)' } }, `Bugun ${S.user.dailyXp} XP to'plandi (Maqsad: ${S.user.dailyGoal} XP). Barakalla!`))
      ) : null,
      h('div', { class: 'res-stats' },
        h('div', { class: 'stat-tile' }, h('b', {}, `+${res.xp}`), h('span', {}, 'XP')),
        h('div', { class: 'stat-tile' }, h('b', {}, `${pct}%`), h('span', {}, 'Aniqlik')),
        h('div', { class: 'stat-tile' }, h('b', {}, `🔥 ${res.streak}`), h('span', {}, 'Seriya'))),
      badgeList(res.badges),
      h('button', { class: 'btn btn-main btn-block', onclick: () => { closePlayer(); route(); } }, 'Davom etish'))));
  }

  // ---------- games ----------
  const GAME_META = {
    stage: { emoji: '🎯', title: "5 so'z bosqichi", desc: "5 ta yangi so'zni kamida 2 ta o'yin (Juftlash + So'z tuzish) orqali o'rganing." },
    memory: { emoji: '🧩', title: 'Xotira', desc: "16 ta kartada so'z va uning tarjimasini juftlang. Kam harakat — ko'p XP." },
    blitz: { emoji: '⚡', title: 'Blitz', desc: "60 soniyada iloji boricha ko'p so'zning tarjimasini toping." },
    scramble: { emoji: '🔤', title: "So'z tuzish", desc: "Aralashgan harflardan so'zni yig'ing. Vaqt: 90 soniya." },
    builder: { emoji: '🧱', title: 'Jumla quruvchi', desc: "Aralashgan so'zlardan to'g'ri jumla tuzing. Vaqt: 3 daqiqa." },
  };

  async function renderGames() {
    await refreshUser(); await loadCourse();
    const currentStageLevel = Math.max(1, Number(LS.get('lf_game_level_' + S.user.id + '_' + S.user.currentLang)) || 1);
    const stageWordsData = await api('GET', `/api/games/words?lang=${S.user.currentLang}&level=${currentStageLevel}`).catch(() => null);

    let stageHero = null;
    if (stageWordsData && stageWordsData.words && stageWordsData.words.length >= 5) {
      stageHero = h('section', { class: 'stage-hero' },
        h('div', { class: 'stage-badge' }, '🎯 Tavsiya etiladi · 5 ta so\'zli bosqich'),
        h('h2', { class: 'stage-title' }, `📌 ${stageWordsData.level}-bosqich · ${stageWordsData.unitEmoji || '📘'} ${stageWordsData.unitTitle || 'Mavzu'} (${stageWordsData.level}/${stageWordsData.totalLevels})`),
        h('p', { class: 'stage-desc' }, "5 ta yangi so'zni kamida 2 ta o'yin (1-o'yin: Juftlash → 2-o'yin: So'z tuzish) orqali mukammal o'rganing. Bosqich yakunlangach, yangi o'yin faqat yangi/boshqa so'zlar bilan davom etadi!"),
        h('div', { class: 'stage-words-preview' }, stageWordsData.words.map((w) => h('div', { class: 'stage-word-card' },
          h('b', { dir: stageWordsData.lang.dir }, w.target),
          h('small', {}, w.uz),
          h('button', { class: 'spk-mini', 'aria-label': 'Tinglash', onclick: () => speak(w.target, stageWordsData.lang.tts) }, '🔊')))),
        h('div', { class: 'stage-controls' },
          h('button', {
            class: 'btn btn-main',
            onclick: () => startStageChallenge(stageWordsData.level)
          }, "▶ 2 ta o'yinni boshlash (Juftlash → So'z tuzish)"),
          h('button', {
            class: 'btn btn-ghost',
            disabled: stageWordsData.level <= 1,
            onclick: async () => {
              LS.set('lf_game_level_' + S.user.id + '_' + S.user.currentLang, stageWordsData.level - 1);
              renderGames();
            }
          }, "← Oldingi 5 so'z"),
          h('button', {
            class: 'btn btn-ghost',
            disabled: stageWordsData.level >= stageWordsData.totalLevels,
            onclick: async () => {
              LS.set('lf_game_level_' + S.user.id + '_' + S.user.currentLang, stageWordsData.level + 1);
              renderGames();
            }
          }, "Keyingi 5 so'z →"),
          h('div', { class: 'stage-flow-pills' },
            h('span', { class: 'stage-flow-pill on' }, "1: Juftlash"),
            h('span', {}, "→"),
            h('span', { class: 'stage-flow-pill on' }, "2: So'z tuzish"),
            h('span', {}, "→"),
            h('span', { class: 'stage-flow-pill' }, "Yangi 5 ta so'z 🌟"))));
    }

    const freeKeys = ['memory', 'blitz', 'scramble', 'builder'];
    const best = await Promise.all(freeKeys.map((k) => api('GET', `/api/games/highscores?game=${k}`).catch(() => ({ best: 0, rows: [] }))));
    const cards = freeKeys.map((k, i) => h('div', { class: 'game-card' },
      h('div', { class: 'g-em' }, GAME_META[k].emoji), h('h3', {}, GAME_META[k].title), h('p', {}, GAME_META[k].desc),
      h('div', { class: 'g-best' }, best[i].best ? `Rekordingiz: ${best[i].best}` : 'Hali o\'ynamadingiz'),
      h('div', { style: { display: 'flex', gap: '8px' } },
        h('button', { class: 'btn btn-main', onclick: () => startGame(k) }, "O'ynash"),
        h('button', { class: 'btn btn-ghost', onclick: () => showHighscores(k, GAME_META[k].title) }, '🏆 Reyting'))));

    await shell('/games', [
      h('h1', {}, "O'yinlar"),
      h('p', { class: 'lead' }, `${S.course.lang.flag} ${S.course.lang.name} so'zlari bilan o'ynang. O'yinlardan kuniga 80 XP gacha olish mumkin.`),
      stageHero,
      h('h3', { class: 'section-title', style: { marginTop: '36px' } }, "Barcha erkin o'yinlar"),
      h('div', { class: 'games-grid' }, cards)
    ], { wide: true });
  }

  // 5 Words Challenge: Taught through 2 games, then next game ONLY with different words!
  async function startStageChallenge(level = 1) {
    const ctl = openGame(`${level}-bosqich · 5 ta so'z`);
    ctl.stage.replaceChildren(h('div', { class: 'spinner' }));
    try {
      const data = await api('GET', `/api/games/words?lang=${S.user.currentLang}&level=${level}`);
      const { lang, words, totalLevels, unitTitle, unitEmoji } = data;
      if (!words || words.length < 5) throw new Error("Bu bosqich uchun so'zlar yetarli emas");
      const levelWords = words.slice(0, 5);
      const t0 = Date.now();
      await runStageGame1(ctl, { lang, words: levelWords, level, totalLevels, unitTitle, unitEmoji, t0 });
    } catch (e) {
      ctl.alive = false;
      toast(e.message);
      closePlayer();
      route();
    }
  }

  async function runStageGame1(ctl, { lang, words, level, totalLevels, unitTitle, unitEmoji, t0 }) {
    if (!ctl.alive) return;
    ctl.setStatus(
      h('span', { class: 'chip' }, `📌 ${level}-bosqich`),
      h('span', { class: 'chip' }, `🎮 1/2: Juftlash`),
      h('span', { class: 'chip' }, `Juftlik: 0/5`)
    );

    const cards = shuffle(words.flatMap((w) => [
      { id: w.id, kind: 't', text: w.target, w },
      { id: w.id, kind: 'u', text: w.uz, w }
    ]));

    let flipped = [], matched = 0, moves = 0, lock = false;
    let timeMs = 0;
    const tickId = ctl.timer(() => {
      timeMs = Date.now() - t0;
      ctl.setStatus(
        h('span', { class: 'chip' }, `📌 ${level}-bosqich`),
        h('span', { class: 'chip' }, `🎮 1/2: Juftlash`),
        h('span', { class: 'chip' }, `✓ ${matched}/5`),
        h('span', { class: 'chip' }, `⏱ ${fmtTime(timeMs)}`)
      );
    }, 300);

    const els = cards.map((c, i) => {
      const b = h('button', { class: 'mem-card', 'aria-label': 'Karta', dir: c.kind === 't' ? lang.dir : 'ltr' },
        h('span', { class: 'mem-front' }, '?'),
        h('span', { class: 'mem-back' }, c.text));
      b.addEventListener('click', async () => {
        if (lock || !ctl.alive || b.classList.contains('flip') || b.classList.contains('done')) return;
        b.classList.add('flip');
        if (c.kind === 't') speak(c.text, lang.tts);
        flipped.push(i);
        if (flipped.length === 2) {
          moves++; lock = true;
          const [a, z] = flipped.map((k) => cards[k]);
          if (a.id === z.id && a.kind !== z.kind) {
            flipped.forEach((k) => els[k].classList.add('done'));
            matched++;
            sfx.ok();
            flipped = [];
            lock = false;
            ctl.setStatus(
              h('span', { class: 'chip' }, `📌 ${level}-bosqich`),
              h('span', { class: 'chip' }, `🎮 1/2: Juftlash`),
              h('span', { class: 'chip' }, `✓ ${matched}/5`),
              h('span', { class: 'chip' }, `⏱ ${fmtTime(Date.now() - t0)}`)
            );
            if (matched === 5) {
              ctl.clear(tickId);
              sfx.done();
              await sleep(600);
              showStageMidpoint(ctl, { lang, words, level, totalLevels, unitTitle, unitEmoji, t0, moves });
            }
          } else {
            sfx.bad();
            await sleep(800);
            flipped.forEach((k) => els[k].classList.remove('flip'));
            flipped = [];
            lock = false;
          }
        }
      });
      return b;
    });

    ctl.stage.replaceChildren(
      h('div', { class: 'stage-subbanner' },
        h('span', { class: 'lvl-txt' }, `🎯 1-o'yin: 5 ta so'zning juftini toping (Xotira kartalari)`),
        h('span', { class: 'muted' }, `${unitEmoji} ${unitTitle}`)),
      h('div', { class: 'mem-grid' }, els)
    );
  }

  function showStageMidpoint(ctl, ctx) {
    if (!ctl.alive) return;
    const nextBtn = h('button', {
      class: 'btn btn-main btn-block',
      onclick: () => runStageGame2(ctl, ctx),
    }, "2-o'yinga o'tish (So'z tuzish) ⏭");

    ctl.stage.replaceChildren(
      h('div', { class: 'result', style: { paddingTop: '20px' } },
        h('div', { class: 'trophy' }, '👏'),
        h('h1', {}, "1-o'yin muvaffaqiyatli tugadi!"),
        h('p', { class: 'lead' }, "5 ta juftlik topildi! Endi aynan shu 5 ta so'zni 2-o'yin (Harflardan so'z tuzish) orqali mustahkamlaymiz."),
        h('div', { style: { maxWidth: '360px', margin: '24px auto 0' } }, nextBtn)
      )
    );
  }

  async function runStageGame2(ctl, { lang, words, level, totalLevels, unitTitle, unitEmoji, t0, moves }) {
    if (!ctl.alive) return;
    let idx = 0;
    let solved = 0;
    let locked = false;

    const holder = h('div');
    const tickId = ctl.timer(() => {
      const timeMs = Date.now() - t0;
      ctl.setStatus(
        h('span', { class: 'chip' }, `📌 ${level}-bosqich`),
        h('span', { class: 'chip' }, `🎮 2/2: So'z tuzish`),
        h('span', { class: 'chip' }, `So'z: ${idx + 1}/5`),
        h('span', { class: 'chip' }, `⏱ ${fmtTime(timeMs)}`)
      );
    }, 300);

    const showWord = () => {
      if (idx >= words.length) {
        ctl.clear(tickId);
        return finishStageChallenge(ctl, { lang, words, level, totalLevels, unitTitle, unitEmoji, t0, moves, solved });
      }
      const w = words[idx];
      const letters = Array.from(w.target);
      let order = shuffle(letters.map((_, i) => i));
      for (let k = 0; k < 6 && order.every((v, i) => letters[v] === letters[i]); k++) order = shuffle(order);
      const picked = [];
      locked = false;

      const answerEl = h('div', { class: 'o-line letters', dir: lang.dir });
      const poolEl = h('div', { class: 'o-pool letters', dir: lang.dir });

      const renderLetters = () => {
        answerEl.replaceChildren(...picked.map((p) => h('button', {
          class: 'o-tok',
          onclick: () => { if (locked) return; picked.splice(picked.indexOf(p), 1); renderLetters(); }
        }, letters[p])));
        poolEl.replaceChildren(...order.map((p) => h('button', {
          class: 'o-tok' + (picked.includes(p) ? ' ghost' : ''),
          disabled: picked.includes(p),
          onclick: () => { if (locked) return; picked.push(p); renderLetters(); checkLetters(); }
        }, letters[p])));
      };

      const checkLetters = async () => {
        if (picked.length !== letters.length) return;
        locked = true;
        const currentAttempt = picked.map((p) => letters[p]).join('');
        if (currentAttempt === w.target) {
          solved++;
          answerEl.classList.add('ok');
          sfx.ok();
          speak(w.target, lang.tts);
          await sleep(750);
          if (!ctl.alive) return;
          idx++;
          showWord();
        } else {
          answerEl.classList.add('bad');
          sfx.bad();
          await sleep(550);
          answerEl.classList.remove('bad');
          picked.length = 0;
          locked = false;
          renderLetters();
        }
      };

      renderLetters();
      holder.replaceChildren(
        h('div', { class: 'stage-subbanner' },
          h('span', { class: 'lvl-txt' }, `🎯 2-o'yin: ${idx + 1}/5-so'zni harflardan yig'ing`),
          h('span', { class: 'muted' }, `${unitEmoji} ${unitTitle}`)),
        h('p', { class: 'lead center', style: { marginBottom: '4px' } }, "O'zbekcha tarjimasi:"),
        h('div', { class: 'big-word center', style: { marginBottom: '14px' } }, w.uz),
        answerEl,
        poolEl,
        h('div', { class: 'center', style: { marginTop: '20px' } },
          h('button', {
            class: 'btn btn-ghost',
            onclick: () => {
              if (locked || !ctl.alive) return;
              speak(w.target, lang.tts);
              picked.length = 0;
              picked.push(...letters.map((_, i) => i));
              renderLetters();
              checkLetters();
            }
          }, "Yordam (so'zni ochish) 💡"))
      );
    };

    ctl.stage.replaceChildren(holder);
    showWord();
  }

  async function finishStageChallenge(ctl, { lang, words, level, totalLevels, unitTitle, unitEmoji, t0, moves, solved }) {
    ctl.alive = false;
    const timeMs = Math.max(Date.now() - t0, 3000);
    sfx.done();
    confetti();

    let res = null, err = null;
    try {
      res = await api('POST', '/api/games/score', {
        game: 'stage',
        lang: lang.code || S.user.currentLang,
        level,
        solved: 5,
        timeMs
      });
      if (res.user) S.user = res.user;
    } catch (e) {
      err = e.message;
    }

    const nextLevel = level < totalLevels ? level + 1 : 1;
    LS.set('lf_game_level_' + S.user.id + '_' + S.user.currentLang, nextLevel);

    const learnedList = h('div', { class: 'learn-list', style: { margin: '20px 0', textAlign: 'left' } },
      words.map((w) => h('div', { class: 'learn-card' },
        h('button', { class: 'speak', onclick: () => speak(w.target, lang.tts) }, '🔊'),
        h('div', { class: 'w' },
          h('b', { dir: lang.dir }, w.target),
          h('small', {}, w.uz),
          w.tr ? h('em', {}, w.tr) : null),
        h('span', { style: { color: 'var(--ok)', fontWeight: 'bold' } }, '✓ O\'rganildi'))));

    ctl.stage.replaceChildren(
      h('div', { class: 'result' },
        h('div', { class: 'trophy' }, '🏆'),
        h('h1', {}, `${level}-bosqich muvaffaqiyatli tugadi!`),
        h('p', { class: 'lead' }, "Siz ushbu 5 ta so'zni 2 ta o'yin (Juftlash + So'z tuzish) orqali to'liq o'rgandingiz!"),
        h('div', { class: 'res-stats' },
          h('div', { class: 'stat-tile' }, h('b', {}, `+${res ? res.xp : 15}`), h('span', {}, 'XP')),
          h('div', { class: 'stat-tile' }, h('b', {}, '5 / 5'), h('span', {}, 'So\'zlar')),
          h('div', { class: 'stat-tile' }, h('b', {}, fmtTime(timeMs)), h('span', {}, 'Vaqt'))),
        learnedList,
        h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '16px' } },
          h('button', {
            class: 'btn btn-main',
            onclick: () => { ctl.alive = false; startStageChallenge(nextLevel); }
          }, `Keyingi bosqich (${nextLevel}-bosqich: Yangi 5 ta so'z) ⏭`),
          h('button', {
            class: 'btn btn-ghost',
            onclick: () => { ctl.alive = false; startStageChallenge(level); }
          }, "Shu bosqichni qayta o'ynash 🔄"),
          h('button', { class: 'btn btn-ghost', onclick: ctl.close }, 'Chiqish'))
      )
    );
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
    const prevDailyXp = S.user ? S.user.dailyXp : 0;
    const prevDailyGoal = S.user ? S.user.dailyGoal : 20;
    const prevGoalHit = prevDailyXp >= prevDailyGoal;
    try { res = await api('POST', '/api/games/score', { game, lang: S.user.currentLang, ...payload }); if (res.user) S.user = res.user; } catch (e) { err = e.message; }
    const nowGoalHit = S.user ? (S.user.dailyXp >= S.user.dailyGoal) : false;
    const hitDailyGoal = !prevGoalHit && nowGoalHit;
    if ((res && res.xp > 0) || hitDailyGoal) { sfx.done(); confetti(); }
    if (hitDailyGoal && S.user) {
      toast(`🎯 Tabriklaymiz! O'yin orqali kunlik maqsad bajarildi (${S.user.dailyXp}/${S.user.dailyGoal} XP)! 🎉`);
    }
    ctl.stage.replaceChildren(h('div', { class: 'result' },
      h('div', { class: 'trophy' }, GAME_META[game].emoji), h('h1', {}, GAME_META[game].title),
      h('div', { class: 'res-stats' }, lines.map(([v, l]) => h('div', { class: 'stat-tile' }, h('b', {}, v), h('span', {}, l)))),
      hitDailyGoal && S.user ? h('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '10px',
          background: 'linear-gradient(135deg, rgba(34,211,154,.2), rgba(0,212,255,.15))',
          border: '1.5px solid #22d39a', borderRadius: '16px',
          padding: '10px 16px', margin: '14px 0', textAlign: 'left',
          animation: 'pop .4s ease-out'
        }
      },
        h('span', { style: { fontSize: '1.5rem' } }, '🎯'),
        h('div', {},
          h('b', { style: { color: '#22d39a', display: 'block' } }, 'Kunlik maqsad bajarildi! 🎉'),
          h('span', { style: { fontSize: '.84rem' } }, `Bugun jami ${S.user.dailyXp} XP to'plandi (Maqsad: ${S.user.dailyGoal} XP)`))
      ) : null,
      res ? h('p', { class: 'lead' }, `Ball: ${res.score}${res.best ? ` · Rekord: ${res.best}` : ''}`) : null,
      res ? h('p', { class: 'xp-gain' }, res.xp > 0 ? `+${res.xp} XP` : 'Bugungi o\'yin XP limiti tugadi') : null,
      err ? h('p', { class: 'form-err' }, err) : null,
      res ? badgeList(res.badges) : null,
      h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' } },
        h('button', { class: 'btn btn-main', onclick: replay }, "Qayta o'ynash"), h('button', { class: 'btn btn-ghost', onclick: ctl.close }, 'Chiqish'))));
  }

  async function startGame(game) {
    if (game === 'stage') {
      const currentLevel = Math.max(1, Number(LS.get('lf_game_level_' + S.user.id + '_' + S.user.currentLang)) || 1);
      return startStageChallenge(currentLevel);
    }
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

  // ---------- tutor & JARVIS ----------
  const chatHistory = {};
  const jarvisHistory = {};
  let jarvisActiveRecognition = null;
  let chatActiveCleanup = null;

  async function renderTutor() {
    await refreshUser(); await loadCourse();
    const lang = S.user.currentLang, lm = langMeta(lang) || S.course.lang;
    let tutorView = 'jarvis'; // default featured voice assistant

    const viewTabs = h('div', { class: 'tutor-chips', style: { marginBottom: '20px', borderBottom: '1px solid var(--line2)', paddingBottom: '10px' } },
      h('button', {
        class: 'tutor-mode-chip active',
        onclick: (e) => {
          tutorView = 'jarvis';
          Array.from(viewTabs.children).forEach((c) => c.classList.remove('active'));
          e.target.classList.add('active');
          renderView();
        }
      }, '🎙️ JARVIS Ovozli Muloqot (Voice AI)'),
      h('button', {
        class: 'tutor-mode-chip',
        onclick: (e) => {
          tutorView = 'chat';
          Array.from(viewTabs.children).forEach((c) => c.classList.remove('active'));
          e.target.classList.add('active');
          renderView();
        }
      }, '💬 Matnli Chat & Talaffuz (MediaRecorder)'));

    const contentHolder = h('div', { class: 'tutor-content-holder' });

    function renderView() {
      if (chatActiveCleanup) {
        try { chatActiveCleanup(); } catch {}
        chatActiveCleanup = null;
      }
      if (tutorView === 'jarvis') {
        renderJarvisView();
      } else {
        renderChatView();
      }
    }

    // ========== JARVIS VOICE INTERFACE ==========
    function renderJarvisView() {
      if (jarvisActiveRecognition) {
        try { jarvisActiveRecognition.abort(); } catch {}
        jarvisActiveRecognition = null;
      }

      const hist = jarvisHistory[lang] = jarvisHistory[lang] || [];
      let jarvisState = 'idle'; // 'idle' | 'listening' | 'thinking' | 'speaking'
      let handsFree = true;
      let speechSpeed = 1.0;
      let lastJarvisReply = '';

      // HUD Status
      const statusDot = h('div', { class: 'jarvis-status-dot' });
      const statusText = h('span', {}, 'JARVIS TAYYOR · KUTMOQDA');
      const statusBadge = h('div', { class: 'jarvis-status-badge' }, statusDot, statusText);

      function updateStatus(st, msg = '') {
        jarvisState = st;
        statusBadge.className = 'jarvis-status-badge ' + (st !== 'idle' ? st : '');
        orbOuter.className = 'jarvis-orb-outer ' + (st !== 'idle' ? st : '');
        waves.classList.toggle('active', st === 'speaking' || st === 'listening');

        if (st === 'listening') {
          statusText.textContent = 'SIZNI ESHITMOQDA...';
          micBtn.classList.add('recording');
          micBtn.innerHTML = '🛑 To\'xtatish & Yuborish';
          hintText.textContent = msg || 'Gapiring... JARVIS eshitmoqda 🎙️';
        } else if (st === 'thinking') {
          statusText.textContent = 'JARVIS TAHLIL QILMOQDA...';
          micBtn.classList.remove('recording');
          micBtn.innerHTML = '⚡ O\'ylamoqda...';
          hintText.textContent = 'JARVIS javob tayyorlamoqda... ⚡';
        } else if (st === 'speaking') {
          statusText.textContent = 'JARVIS GAPIRMOQDA...';
          micBtn.classList.remove('recording');
          micBtn.innerHTML = '🔊 Gapirmoqda...';
          hintText.textContent = msg || 'JARVIS gapirmoqda... 🔊';
        } else {
          statusText.textContent = 'JARVIS TAYYOR · KUTMOQDA';
          micBtn.classList.remove('recording');
          micBtn.innerHTML = '🎙️ GAPIRISH (Mikrofon)';
          hintText.textContent = msg || 'Mikrofonni yoqing yoki savol bering, JARVIS ovoz orqali javob beradi.';
        }
      }

      // Animated Arc Reactor Orb
      const core = h('div', { class: 'jarvis-core', title: 'JARVIS bilan gaplashish uchun bosing' }, '⚡');
      const orbOuter = h('div', { class: 'jarvis-orb-outer', onclick: toggleMic },
        h('div', { class: 'jarvis-ring-1' }),
        h('div', { class: 'jarvis-ring-2' }),
        h('div', { class: 'jarvis-ring-3' }),
        core);

      // Soundwave Equalizer Bars
      const waves = h('div', { class: 'jarvis-waves' },
        ...Array.from({ length: 10 }, () => h('div', { class: 'jarvis-bar' })));

      const hintText = h('div', { class: 'jarvis-hint-text' },
        `Salom, ${S.user.name.split(' ')[0]}! Men JARVIS. ${lm.name} bo'yicha jonli ovozli suhbatga tayyorman.`);

      // Transcript Stream
      const streamBox = h('div', { class: 'jarvis-stream' });
      function refreshStream() {
        if (!hist.length) {
          streamBox.replaceChildren(
            h('div', { class: 'jarvis-line jarvis' },
              h('b', {}, 'J.A.R.V.I.S.'),
              `Salom, ${S.user.name.split(' ')[0]}! Men sizning ${lm.name} bo'yicha shaxsiy ovozli suhbatdoshingizman. Istalgan mavzuda gapiring, talaffuzingizni to'g'rilayman va ravon gapirishni o'rgataman!`));
          return;
        }
        streamBox.replaceChildren(...hist.map((m) =>
          h('div', { class: `jarvis-line ${m.role === 'user' ? 'user' : 'jarvis'}` },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
              h('b', {}, m.role === 'user' ? (S.user.name.split(' ')[0] + ' (Siz)') : 'J.A.R.V.I.S.'),
              m.role === 'assistant'
                ? h('button', {
                    style: { background: 'none', border: 'none', color: '#00d4ff', cursor: 'pointer', fontSize: '.85rem' },
                    title: 'Qayta tinglash',
                    onclick: () => speak(m.content, lm.tts, { rate: speechSpeed })
                  }, '🔊')
                : null),
            m.content)));
        streamBox.scrollTop = streamBox.scrollHeight;
      }
      refreshStream();

      // Send speech or text to JARVIS
      async function submitToJarvis(userText) {
        const text = String(userText || '').trim();
        if (!text) return;
        hist.push({ role: 'user', content: text });
        refreshStream();
        updateStatus('thinking');

        try {
          const res = await api('POST', '/api/tutor', {
            lang,
            mode: 'jarvis',
            messages: hist.slice(-10),
          });

          const reply = res.reply || `Understood, ${S.user.name.split(' ')[0]}. Let us continue speaking.`;
          lastJarvisReply = reply;
          hist.push({ role: 'assistant', content: reply });
          refreshStream();

          // Speak JARVIS reply out loud
          updateStatus('speaking', reply);
          speak(reply, lm.tts, {
            rate: speechSpeed,
            onStart: () => updateStatus('speaking', reply),
            onEnd: () => {
              updateStatus('idle');
              if (handsFree && tutorView === 'jarvis') {
                setTimeout(startListening, 600);
              }
            },
          });
        } catch (e) {
          updateStatus('idle', `Xatolik yuz berdi: ${e.message}`);
          toast(e.message);
        }
      }

      // Voice recognition handling
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      let recLangMode = 'target'; // 'target' | 'uz'

      function startListening() {
        if (!SpeechRec) {
          toast("Brauzeringiz ovoz yozishni qo'llamaydi. Matn kiritib suhbatlashishingiz mumkin!");
          return;
        }
        if (jarvisActiveRecognition) {
          try { jarvisActiveRecognition.abort(); } catch {}
          jarvisActiveRecognition = null;
        }

        try {
          const rec = new SpeechRec();
          jarvisActiveRecognition = rec;
          rec.continuous = false;
          rec.interimResults = true;
          rec.lang = recLangMode === 'target' ? (lm.tts || 'en-US') : 'uz-UZ';

          let recognizedText = '';

          rec.onstart = () => {
            updateStatus('listening');
          };

          rec.onresult = (evt) => {
            let finalTranscript = '';
            for (let i = evt.resultIndex; i < evt.results.length; ++i) {
              if (evt.results[i].isFinal) finalTranscript += evt.results[i][0].transcript;
              else recognizedText = evt.results[i][0].transcript;
            }
            if (finalTranscript) {
              recognizedText = finalTranscript;
            }
            hintText.textContent = `Siz: "${recognizedText}"`;
          };

          rec.onerror = (err) => {
            console.warn('[speech rec error]', err.error);
            jarvisActiveRecognition = null;
            updateStatus('idle');
          };

          rec.onend = () => {
            jarvisActiveRecognition = null;
            const final = recognizedText.trim();
            if (final) {
              submitToJarvis(final);
            } else {
              updateStatus('idle');
            }
          };

          rec.start();
        } catch (e) {
          console.error(e);
          jarvisActiveRecognition = null;
          updateStatus('idle');
        }
      }

      function stopListening() {
        if (jarvisActiveRecognition) {
          try { jarvisActiveRecognition.stop(); } catch {}
          jarvisActiveRecognition = null;
        }
      }

      function toggleMic() {
        if ('speechSynthesis' in window && speechSynthesis.speaking) {
          speechSynthesis.cancel();
          updateStatus('idle');
          return;
        }
        if (jarvisState === 'listening') {
          stopListening();
        } else {
          startListening();
        }
      }

      // Contextual topic prompts per language and certification
      const topicsByLang = {
        en: [
          `Salom JARVIS, bugun qanday mashg'ulot bajaramiz?`,
          `IELTS Speaking Part 1 mavzusida savol bering`,
          `IELTS Speaking Part 2 cue-card berib, nutqimni baholang`,
          `Aeroportda ro'yxatdan o'tishni inglizcha mashq qilaylik`,
          `Menga bugun 3 ta zamonaviy C1 akademik ibora o'rgating`,
          `Mening talaffuz va grammatikamdagi xatolarni to'g'irlang`,
        ],
        de: [
          `Hallo JARVIS, sprechen wir auf Deutsch!`,
          `Goethe B2 Sprechen: Erzähle mir über deine Heimatstadt`,
          `Am Flughafen einchecken und nach dem Flugsteig fragen`,
          `Korrigiere bitte meine Grammatik und Aussprache`,
        ],
        ru: [
          `Привет, JARVIS, давай попрактикуем русский язык`,
          `ТРКИ разговорная часть: расскажи о путешествиях`,
          `В ресторане: как сделать заказ и попросить счет`,
          `Исправь мои грамматические ошибки и ударения`,
        ],
        fr: [
          `Bonjour JARVIS, parlons en français!`,
          `DELF B2: Parle-moi de tes projets pour l'avenir`,
          `Au restaurant: commander un plat et demander l'addition`,
          `Corrige ma prononciation et mes fautes s'il te plaît`,
        ],
        es: [
          `¡Hola JARVIS! Vamos a practicar conversación en español`,
          `DELE B2: Cuéntame sobre tus pasatiempos favoritos`,
          `En el aeropuerto: facturar el equipaje y pasar el control`,
          `Corrige por favor mi pronunciación y gramática`,
        ],
        ar: [
          `مرحباً جارفيس، لنتحدث باللغة العربية الفصحى`,
          `سؤال محادثة: حدثني عن مدينتك وما يعجبك فيها`,
          `في المطار والفندق: محادثة باللغة العربية`,
          `صحح نطقي وأخطائي النحوية من فضلك`,
        ]
      };
      const sampleTopics = topicsByLang[lang] || topicsByLang.en;

      const topicChips = h('div', { class: 'jarvis-topics' },
        sampleTopics.map((top) => h('button', {
          class: 'jarvis-topic-chip',
          onclick: () => submitToJarvis(top),
        }, `💬 ${top}`)));

      // Controls Row
      const micBtn = h('button', { class: 'jarvis-btn-main', onclick: toggleMic }, '🎙️ GAPIRISH (Mikrofon)');
      const handsFreeToggle = h('button', {
        class: `jarvis-toggle${handsFree ? ' active' : ''}`,
        onclick: () => {
          handsFree = !handsFree;
          handsFreeToggle.classList.toggle('active', handsFree);
          handsFreeToggle.textContent = handsFree ? '🔄 Avto-suhbat (Hands-Free): YOQILGAN' : '🔄 Avto-suhbat: O\'CHIRILGAN';
          toast(handsFree ? 'Avto-suhbat yoqildi (JARVIS gapirgach mikrofon o\'zi ochiladi)' : 'Avto-suhbat o\'chirildi');
        }
      }, handsFree ? '🔄 Avto-suhbat (Hands-Free): YOQILGAN' : '🔄 Avto-suhbat: O\'CHIRILGAN');

      const replayBtn = h('button', {
        class: 'jarvis-toggle',
        onclick: () => {
          if (lastJarvisReply) {
            updateStatus('speaking', lastJarvisReply);
            speak(lastJarvisReply, lm.tts, {
              rate: speechSpeed,
              onEnd: () => updateStatus('idle')
            });
          } else {
            toast('Hali JARVIS javob bermagan');
          }
        }
      }, '🔊 Qayta eshitish');

      const speedBtn = h('button', {
        class: 'jarvis-toggle',
        onclick: () => {
          speechSpeed = speechSpeed === 1.0 ? 0.85 : speechSpeed === 0.85 ? 1.15 : 1.0;
          speedBtn.textContent = `⏩ Tezlik: ${speechSpeed}x`;
        }
      }, `⏩ Tezlik: ${speechSpeed}x`);

      const recLangBtn = h('button', {
        class: 'jarvis-toggle',
        onclick: () => {
          recLangMode = recLangMode === 'target' ? 'uz' : 'target';
          recLangBtn.textContent = recLangMode === 'target' ? `🌐 Til: ${lm.name}` : "🌐 Til: O'zbekcha";
          toast(recLangMode === 'target' ? `Mikrofon ${lm.name} uchun sozlandi` : "Mikrofon O'zbek tili uchun sozlandi");
        }
      }, `🌐 Til: ${lm.name}`);

      const controls = h('div', { class: 'jarvis-controls' }, micBtn, handsFreeToggle, replayBtn, speedBtn, recLangBtn);

      // Keyboard fallback input
      const fallbackInput = h('input', {
        type: 'text',
        placeholder: `Mikrofonsiz ham yozishingiz mumkin (${lm.native} yoki O'zbekcha)...`,
        style: { flex: 1, padding: '14px 18px', borderRadius: '14px', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(0,212,255,.3)', color: '#fff', fontSize: '.95rem' }
      });
      const fallbackSend = h('button', { class: 'btn btn-main', type: 'submit' }, 'Yuborish');
      const fallbackForm = h('form', {
        style: { display: 'flex', gap: '10px', marginTop: '16px', position: 'relative', zIndex: 3 },
        onsubmit: (e) => {
          e.preventDefault();
          const val = fallbackInput.value.trim();
          if (!val) return;
          fallbackInput.value = '';
          submitToJarvis(val);
        }
      }, fallbackInput, fallbackSend);

      const panel = h('div', { class: 'jarvis-panel' },
        h('div', { class: 'jarvis-hud-top' },
          h('div', { class: 'jarvis-logo' },
            'J.A.R.V.I.S.',
            h('span', { class: 'jarvis-logo-badge' }, 'VOICE AI PROTOCOL')),
          statusBadge),
        h('div', { class: 'jarvis-orb-stage' },
          orbOuter,
          waves,
          hintText),
        topicChips,
        controls,
        streamBox,
        fallbackForm);

      contentHolder.replaceChildren(panel);
    }

    // ========== CLASSIC CHAT & PRONUNCIATION INTERFACE (MediaRecorder) ==========
    function renderChatView() {
      if (chatActiveCleanup) {
        try { chatActiveCleanup(); } catch {}
        chatActiveCleanup = null;
      }

      const hist = chatHistory[lang] = chatHistory[lang] || [];
      let currentMode = 'general';

      const modes = [
        ['general', '💬 Erkin suhbat'],
        ['pronunciation', '🗣️ Talaffuz Mashqi (MediaRecorder)'],
        ['ielts_speaking', '🎙️ IELTS Speaking Mock'],
        ['ielts_writing', '✍️ IELTS Writing Tahlili'],
        ['exam', '🎓 Imtihon Murabbiyi'],
      ];

      // Sample practice phrases tailored to current target language
      const samplePracticePhrases = {
        en: [
          "Good morning, how are you today?",
          "I am preparing for the IELTS Speaking test.",
          "Could you evaluate my pronunciation and word stress?",
          "Consistency and clear articulation lead to natural fluency."
        ],
        de: [
          "Guten Tag, wie geht es Ihnen heute?",
          "Ich möchte mein deutsches Sprechen verbessern.",
          "Könnten Sie bitte meine Aussprache korrigieren?"
        ],
        ru: [
          "Здравствуйте, я изучаю русский язык.",
          "Пожалуйста, проверьте моё произношение и ударение."
        ],
        fr: [
          "Bonjour, je pratique la prononciation française.",
          "Pouvez-vous m'aider à corriger mon accent ?"
        ],
        es: [
          "¡Hola! Me gustaría practicar la pronunciación.",
          "¿Podrías evaluar mi entonación y fluidez?"
        ],
        ar: [
          "مرحباً، أود ممارسة النطق باللغة العربية الفصحى.",
          "هل يمكنك تقييم مخارج الحروف والطلاقة؟"
        ]
      };
      const phrases = samplePracticePhrases[lang] || samplePracticePhrases.en;

      const helperPills = h('div', { class: 'pronunciation-helper' },
        h('span', { style: { fontSize: '.8rem', color: 'var(--muted)', alignSelf: 'center', whiteSpace: 'nowrap' } }, '🎯 Namunalar:'),
        ...phrases.map((phr) => h('button', {
          type: 'button',
          class: 'pronunciation-chip',
          onclick: () => {
            input.value = phr;
            input.focus();
            toast("Mashq jumlasi tanlandi! Endi 🎙️ mikrofon tugmasini bosing.");
          }
        }, `🗣️ "${phr}"`))
      );

      const modeChips = h('div', { class: 'tutor-chips' },
        modes.map(([mKey, mTitle]) => {
          const btn = h('button', {
            type: 'button',
            class: `tutor-mode-chip${mKey === currentMode ? ' active' : ''}`,
            onclick: () => {
              currentMode = mKey;
              Array.from(modeChips.children).forEach((c) => c.classList.remove('active'));
              btn.classList.add('active');
              input.placeholder = mKey === 'ielts_writing' ? 'Insho yoki murakkab jumlalaringizni yozing...'
                : mKey === 'ielts_speaking' ? 'Speaking savoliga javob bering...'
                : mKey === 'pronunciation' ? 'Mashq jumlasi yoki mikrofonni bosing...'
                : `${lm.native} da yozing…`;
            }
          }, mTitle);
          return btn;
        }));

      const list = h('div', { class: 'chat' });
      const draw = () => list.replaceChildren(...(hist.length ? hist.map((m) => {
        if (m.isAudioPractice && m.audioUrl) {
          return h('div', { class: 'msg me audio-msg' },
            h('div', { class: 'audio-msg-bubble' },
              h('div', { class: 'audio-msg-header' },
                h('span', {}, '🎙️ Ovozli talaffuz yozuvi'),
                h('span', { class: 'pronunciation-score-tag' }, `${m.duration || 1}s · MediaRecorder`)
              ),
              h('audio', {
                controls: true,
                src: m.audioUrl,
                class: 'audio-player-custom',
                preload: 'metadata'
              }),
              m.transcribed ? h('div', { class: 'audio-practice-text' }, `"${m.transcribed}"`) : null
            )
          );
        }

        const msgEl = h('div', { class: 'msg ' + (m.role === 'user' ? 'me' : 'ai'), dir: m.role === 'assistant' && lm.dir === 'rtl' ? 'auto' : null });
        const contentDiv = h('div', { style: { whiteSpace: 'pre-wrap' } }, m.content);
        msgEl.appendChild(contentDiv);

        if (m.role === 'assistant') {
          const actionRow = h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' } });
          const ttsTarget = m.modelText || m.content.slice(0, 160);
          actionRow.appendChild(h('button', {
            class: 'btn btn-ghost',
            style: { fontSize: '.78rem', padding: '4px 10px', color: '#00d4ff', border: '1px solid rgba(0,212,255,.3)' },
            onclick: () => speak(ttsTarget, lm.tts)
          }, '🔊 Qayta tinglash'));

          if (m.isPronunciationFeedback && m.modelText) {
            actionRow.appendChild(h('button', {
              class: 'btn btn-ghost',
              style: { fontSize: '.78rem', padding: '4px 10px' },
              onclick: () => {
                input.value = m.modelText;
                toast("Jumla tanlandi. 🎙️ Mikrofon tugmasini bosing!");
              }
            }, '🔄 Qayta mashq'));
          }
          msgEl.appendChild(actionRow);
        }

        return msgEl;
      })
      : [h('div', { class: 'msg ai' }, `Salom! Men sizning ${lm.name} bo'yicha matnli va talaffuz murabbiyingizman. 🎙️ Mikrofon tugmasi orqali MediaRecorder yordamida ovozingizni yozib, talaffuzingizni mashq qiling yoki mavzuni tanlang! 🎓`)]));
      draw();

      const input = h('input', { type: 'text', maxlength: 500, placeholder: `${lm.native} da yozing yoki mikrofon orqali talaffuz mashqi…`, 'aria-label': 'Xabar', autocomplete: 'off' });
      const send = h('button', { class: 'btn btn-main', type: 'submit' }, 'Yuborish');

      // ===== MediaRecorder Audio Capture =====
      let mediaRecorder = null;
      let activeStream = null;
      let audioChunks = [];
      let isRecording = false;
      let recTimer = null;
      let recSeconds = 0;
      let speechRec = null;
      let liveTranscript = '';
      let audioCtx = null;
      let analyser = null;
      let animFrame = null;

      // Status Panel for Recording
      const timerEl = h('span', { class: 'chat-rec-timer' }, '00:00 / 00:45');
      const waveBars = Array.from({ length: 6 }, () => h('div', { class: 'chat-rec-wave' }));
      const wavesWrap = h('div', { class: 'chat-rec-waves' }, ...waveBars);

      const stopBtn = h('button', {
        type: 'button',
        class: 'chat-rec-stop-btn',
        onclick: () => stopRecording(true)
      }, "🛑 To'xtatish & Tahlil");

      const cancelBtn = h('button', {
        type: 'button',
        class: 'chat-rec-cancel-btn',
        onclick: () => stopRecording(false)
      }, '✕ Bekor');

      const recordPanel = h('div', { class: 'chat-record-panel', style: { display: 'none' } },
        h('div', { class: 'chat-record-info' },
          h('div', { class: 'chat-rec-dot' }),
          h('span', { class: 'chat-rec-title' }, 'Talaffuz yozilmoqda (MediaRecorder)...'),
          timerEl,
          wavesWrap
        ),
        h('div', { class: 'chat-rec-actions' }, cancelBtn, stopBtn)
      );

      // Microphone button
      const micBtn = h('button', {
        type: 'button',
        class: 'chat-mic-btn',
        title: "Ovoz yozish va talaffuz mashqi (MediaRecorder API)",
        'aria-label': "Talaffuz mashqi uchun ovoz yozish (MediaRecorder)",
        onclick: (e) => {
          e.preventDefault();
          if (isRecording) {
            stopRecording(true);
          } else {
            startRecording();
          }
        }
      }, '🎙️');

      async function startRecording() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
          toast("Brauzeringiz MediaRecorder API ni qo'llab-quvvatlamaydi. Matn yozishingiz mumkin.");
          return;
        }

        try {
          activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err) {
          console.warn('Microphone error:', err);
          toast("Mikrofondan foydalanishga ruxsat berilmadi. Iltimos brauzer sozlamalarida ruxsat bering.");
          return;
        }

        audioChunks = [];
        liveTranscript = '';
        recSeconds = 0;
        timerEl.textContent = '00:00 / 00:45';

        // Select best supported MIME type
        const mimeCandidates = [
          'audio/webm;codecs=opus',
          'audio/webm',
          'audio/ogg;codecs=opus',
          'audio/mp4',
          'audio/wav'
        ];
        const chosenMime = mimeCandidates.find((m) => window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(m)) || '';

        try {
          mediaRecorder = chosenMime ? new MediaRecorder(activeStream, { mimeType: chosenMime }) : new MediaRecorder(activeStream);
        } catch (e) {
          console.warn('MediaRecorder init fallback:', e);
          mediaRecorder = new MediaRecorder(activeStream);
        }

        mediaRecorder.ondataavailable = (evt) => {
          if (evt.data && evt.data.size > 0) {
            audioChunks.push(evt.data);
          }
        };

        // Parallel speech recognition for live transcription if supported
        const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRec) {
          try {
            speechRec = new SpeechRec();
            speechRec.continuous = false;
            speechRec.interimResults = true;
            speechRec.lang = lm.tts || 'en-US';
            speechRec.onresult = (ev) => {
              let t = '';
              for (let i = ev.resultIndex; i < ev.results.length; i++) {
                t += ev.results[i][0].transcript;
              }
              if (t.trim()) liveTranscript = t.trim();
            };
            speechRec.onerror = () => {};
            speechRec.start();
          } catch {}
        }

        // Audio visualizer using Web Audio API
        try {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (AudioContextClass) {
            audioCtx = new AudioContextClass();
            const source = audioCtx.createMediaStreamSource(activeStream);
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 32;
            source.connect(analyser);
            const freqData = new Uint8Array(analyser.frequencyBinCount);

            const renderEqualizer = () => {
              if (!isRecording) return;
              analyser.getByteFrequencyData(freqData);
              waveBars.forEach((bar, idx) => {
                const val = Math.max(4, Math.min(22, (freqData[idx % freqData.length] || 10) / 10));
                bar.style.height = `${val}px`;
              });
              animFrame = requestAnimationFrame(renderEqualizer);
            };
            renderEqualizer();
          }
        } catch {}

        isRecording = true;
        micBtn.classList.add('recording');
        micBtn.innerHTML = '🛑';
        micBtn.title = "Yozishni to'xtatish (MediaRecorder)";
        recordPanel.style.display = 'flex';

        recTimer = setInterval(() => {
          recSeconds++;
          const mm = String(Math.floor(recSeconds / 60)).padStart(2, '0');
          const ss = String(recSeconds % 60).padStart(2, '0');
          timerEl.textContent = `${mm}:${ss} / 00:45`;
          if (recSeconds >= 45) {
            stopRecording(true);
          }
        }, 1000);

        mediaRecorder.start(250);
      }

      function stopRecording(shouldSubmit = true) {
        if (!isRecording) return;
        isRecording = false;

        clearInterval(recTimer);
        recTimer = null;

        if (animFrame) {
          cancelAnimationFrame(animFrame);
          animFrame = null;
        }
        if (audioCtx && audioCtx.state !== 'closed') {
          try { audioCtx.close(); } catch {}
          audioCtx = null;
        }
        if (speechRec) {
          try { speechRec.stop(); } catch {}
          speechRec = null;
        }

        micBtn.classList.remove('recording');
        micBtn.innerHTML = '🎙️';
        micBtn.title = "Ovoz yozish va talaffuz mashqi (MediaRecorder API)";
        recordPanel.style.display = 'none';

        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
          mediaRecorder.onstop = async () => {
            if (activeStream) {
              try { activeStream.getTracks().forEach((tr) => tr.stop()); } catch {}
              activeStream = null;
            }

            if (!shouldSubmit || audioChunks.length === 0) return;

            const finalMime = (mediaRecorder && mediaRecorder.mimeType) || 'audio/webm';
            const audioBlob = new Blob(audioChunks, { type: finalMime });
            const audioUrl = URL.createObjectURL(audioBlob);
            const duration = Math.max(1, recSeconds);

            const practiceText = input.value.trim() || liveTranscript || `[${lm.name} talaffuz mashqi]`;
            input.value = '';

            // Add audio message to chat
            const audioMessage = {
              role: 'user',
              content: `🎙️ "${practiceText}"`,
              audioUrl,
              duration,
              isAudioPractice: true,
              transcribed: practiceText
            };
            hist.push(audioMessage);
            draw();

            list.append(h('div', { class: 'msg ai typing' }, 'MediaRecorder talaffuz tahlil qilinmoqda…'));
            send.disabled = true;
            micBtn.disabled = true;

            try {
              const r = await api('POST', '/api/tutor', {
                lang,
                mode: currentMode === 'general' ? 'pronunciation' : currentMode,
                isAudioPractice: true,
                duration,
                messages: hist.map((m) => ({ role: m.role, content: m.content })).slice(-12)
              });

              hist.push({
                role: 'assistant',
                content: r.reply,
                isPronunciationFeedback: true,
                modelText: practiceText
              });
            } catch (ex) {
              toast(ex.message);
            } finally {
              send.disabled = false;
              micBtn.disabled = false;
              draw();
              window.scrollTo(0, document.body.scrollHeight);
            }
          };

          try { mediaRecorder.stop(); } catch {}
        } else if (activeStream) {
          try { activeStream.getTracks().forEach((tr) => tr.stop()); } catch {}
          activeStream = null;
        }
      }

      chatActiveCleanup = () => {
        stopRecording(false);
      };

      const form = h('form', {
        class: 'chat-form', onsubmit: async (e) => {
          e.preventDefault();
          const text = input.value.trim(); if (!text) return;
          input.value = ''; hist.push({ role: 'user', content: text }); draw();
          list.append(h('div', { class: 'msg ai typing' }, 'Yozmoqda…'));
          send.disabled = true;
          try {
            const r = await api('POST', '/api/tutor', { lang, mode: currentMode, messages: hist.map(m => ({ role: m.role, content: m.content })).slice(-12) });
            hist.push({ role: 'assistant', content: r.reply });
          }
          catch (ex) { hist.pop(); toast(ex.message); input.value = text; }
          finally { send.disabled = false; draw(); input.focus(); window.scrollTo(0, document.body.scrollHeight); }
        },
      }, input, micBtn, send);

      contentHolder.replaceChildren(modeChips, helperPills, list, recordPanel, form);
    }

    renderView();

    await shell('/tutor', [
      h('h1', {}, '🎙️ J.A.R.V.I.S. Ovozli AI Ustoz'),
      h('p', { class: 'lead' }, `${lm.flag} ${lm.name} · Real vaqtda gaplashish va IELTS Speaking mashqi`),
      viewTabs,
      contentHolder
    ]);
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
        h('button', { class: 'btn btn-ghost', style: { color: 'var(--bad)' }, onclick: async () => {
          LS.remove('lf_token');
          try { await api('POST', '/api/auth/logout', {}); } catch {}
          S.user = null; S.course = null; location.hash = '#/login'; route();
        } }, 'Chiqish')),
    ]);
  }

  // ---------- boot ----------
  (async function boot() {
    if ('speechSynthesis' in window) {
      speechSynthesis.getVoices();
      speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
    }
    try {
      S.user = (await api('GET', '/api/me')).user;
      await loadLangs();
    } catch {
      S.user = null;
      LS.remove('lf_token');
    }
    const qLang = getQueryLang();
    if (S.user && qLang && qLang !== S.user.currentLang) {
      try {
        S.user = (await api('PATCH', '/api/me', { currentLang: qLang })).user;
        LS.set('lf_lang_selected_' + S.user.id, qLang);
        sessionStorage.setItem('lf_entered_lang_' + S.user.id, '1');
      } catch {}
    }
    if (!location.hash) location.hash = S.user ? '#/learn' : '#/start';
    await route();

    // Saytga kirish paytida birinchi navbatda til tanlashi kerak:
    if (S.user && !qLang && !sessionStorage.getItem('lf_entered_lang_' + S.user.id) && !LS.get('lf_lang_selected_' + S.user.id)) {
      openLangPicker({
        mustPick: true,
        title: "O'rganmoqchi bo'lgan tilingizni tanlang",
        subtitle: "LinguaFlow bilan o'rganishni boshlash uchun avvalo tilni tanlang:"
      });
    }
  })();
})();
