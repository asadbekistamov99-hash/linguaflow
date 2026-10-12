'use strict';
(() => {
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
  const svgEl = (tag, attrs, text) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };
  const $ = (s, r = document) => r.querySelector(s);
  const root = $('#root');
  const mount = (...n) => root.replaceChildren(...n.flat(Infinity));

  let toastTimer;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400); }

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
  const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message); } };

  try { const m = LS.get('lf_theme') || 'dark'; document.documentElement.dataset.theme = m === 'light' ? 'light' : m === 'auto' && !matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark'; } catch { /* ignore */ }

  const S = { me: null };
  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString('uz-UZ', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const fmtDay = (key) => (key == null ? '—' : new Date(key * 86400000).toLocaleDateString('uz-UZ'));
  const num = (n) => Number(n).toLocaleString('en-US').replace(/,/g, ' ');

  // ---------- gate ----------
  function renderLogin(msg) {
    const err = h('div', { class: 'form-err', role: 'alert' }, msg || '');
    const email = h('input', { type: 'email', required: true, placeholder: 'admin@example.com', autocomplete: 'email' });
    const pass = h('input', { type: 'password', required: true, placeholder: 'Parol', autocomplete: 'current-password' });
    mount(h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' },
      h('div', { class: 'logo' }, h('span', { class: 'logo-mark' }, 'L'), 'LinguaFlow Admin'),
      h('h1', {}, 'Admin panelga kirish'), h('p', { class: 'sub' }, 'Faqat administratorlar uchun.'),
      h('form', {
        onsubmit: async (e) => {
          e.preventDefault(); err.textContent = '';
          try {
            const res = await api('POST', '/api/auth/login', { email: email.value, password: pass.value });
            if (res.token) LS.set('lf_token', res.token);
            boot();
          } catch (ex) { err.textContent = ex.message; }
        },
      }, h('label', { class: 'field' }, h('span', {}, 'Email'), email), h('label', { class: 'field' }, h('span', {}, 'Parol'), pass), err, h('button', { class: 'btn btn-main btn-block', type: 'submit' }, 'Kirish')),
      h('div', { class: 'auth-switch' }, h('a', { href: '/app' }, '← Ilovaga qaytish')))));
  }

  // ---------- shell & router ----------
  const NAV = [['/dashboard', '📊', 'Boshqaruv'], ['/users', '👥', 'Foydalanuvchilar'], ['/content', '📚', 'Kontent'], ['/settings', '📢', "E'lon"], ['/audit', '🧾', 'Audit jurnali']];
  function shell(active, ...content) {
    const side = h('aside', { class: 'side' },
      h('a', { href: '#/dashboard', class: 'logo' }, h('span', { class: 'logo-mark' }, 'L'), 'Admin'),
      NAV.map(([p, ic, l]) => h('a', { href: '#' + p, class: 'nav-item' + (active === p ? ' on' : '') }, h('span', { class: 'ic' }, ic), l)),
      h('div', { style: { flex: 1 } }),
      h('a', { href: '/app#/learn', class: 'nav-item' }, h('span', { class: 'ic' }, '↩️'), 'Ilovaga qaytish'));
    const top = h('header', { class: 'topbar' }, h('div', { class: 'logo-sm' }, h('span', { class: 'logo-mark' }, 'L'), ' Admin'),
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('span', { class: 'chip' }, '🛡️ ', S.me.name),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => { await api('POST', '/api/auth/logout', {}); S.me = null; renderLogin(); } }, 'Chiqish')));
    const tabs = h('nav', { class: 'tabbar' }, NAV.map(([p, ic, l]) => h('a', { href: '#' + p, class: 'tab' + (active === p ? ' on' : '') }, h('span', { class: 'ic' }, ic), l.split(' ')[0])));
    mount(h('div', { class: 'shell' }, side, h('div', { class: 'main' }, top, h('main', { class: 'adm-page' }, content)), tabs));
  }

  const pages = { '/dashboard': pageDashboard, '/users': pageUsers, '/content': pageContent, '/settings': pageSettings, '/audit': pageAudit };
  async function route() {
    if (!S.me) return;
    const path = (location.hash.slice(1) || '/dashboard').split('?')[0];
    try { await (pages[path] || pageDashboard)(path in pages ? path : '/dashboard'); } catch (e) {
      if (e.status === 401 || e.status === 403) { S.me = null; return renderLogin(e.message); }
      toast(e.message);
    }
  }
  addEventListener('hashchange', route);

  // ---------- charts ----------
  function barChart(data, key, color) {
    const W = 360, H = 150, padB = 18, padT = 14;
    const max = Math.max(1, ...data.map((d) => d[key]));
    const bw = W / data.length;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Grafik' });
    data.forEach((d, i) => {
      const hh = Math.max(d[key] ? 2 : 0, (d[key] / max) * (H - padB - padT));
      const x = i * bw + bw * 0.18, w = bw * 0.64, y = H - padB - hh;
      svg.append(svgEl('rect', { x, y, width: w, height: hh, rx: 3, fill: color, opacity: i === data.length - 1 ? 1 : 0.75 }));
      if (d[key]) svg.append(svgEl('text', { x: x + w / 2, y: y - 3, 'text-anchor': 'middle', class: 'val' }, num(d[key])));
      if (i % 2 === 0) svg.append(svgEl('text', { x: i === 0 ? 2 : x + w / 2, y: H - 4, 'text-anchor': i === 0 ? 'start' : 'middle' }, d.day));
    });
    return svg;
  }
  const chartCard = (title, data, key, color) => h('div', { class: 'chart-card' }, h('h3', {}, title), barChart(data, key, color));
  const kpi = (label, value, sub) => h('div', { class: 'kpi' }, h('small', {}, label), h('b', {}, value), sub ? h('span', {}, sub) : null);

  // ---------- dashboard ----------
  async function pageDashboard(active) {
    const { totals: t, series, byLang, games } = await api('GET', '/api/admin/stats');
    const maxL = Math.max(1, ...byLang.map((x) => x.n));
    const maxG = Math.max(1, ...games.map((x) => x.n));
    const GN = { memory: 'Xotira', blitz: 'Blitz', scramble: "So'z tuzish", builder: 'Jumla quruvchi' };
    shell(active,
      h('h1', {}, 'Boshqaruv paneli'), h('p', { class: 'lead' }, "Platformaning umumiy holati"),
      h('div', { class: 'kpis' },
        kpi('Foydalanuvchilar', num(t.users), `${t.admins} admin · ${t.banned} bloklangan`),
        kpi('Bugun faol', num(t.activeToday), `7 kunda: ${num(t.active7d)}`),
        kpi("Yangi (bugun)", num(t.newToday), `7 kunda: ${num(t.new7d)}`),
        kpi('Tugatilgan darslar', num(t.lessonsDone)),
        kpi('Jami XP', num(t.xpTotal), `7 kunda: ${num(t.xp7d)}`),
        kpi("O'yinlar (7 kun)", num(t.games7d)),
        kpi('Mavzular', num(t.units), `${num(t.concepts)} so'z · ${num(t.sentences)} jumla`)),
      h('div', { class: 'charts' },
        chartCard("Ro'yxatdan o'tganlar (14 kun)", series, 'signups', '#7c5cff'),
        chartCard('Faol foydalanuvchilar (14 kun)', series, 'active', '#00d4ff'),
        chartCard('XP (14 kun)', series, 'xp', '#ffc94d')),
      h('div', { class: 'two' },
        h('div', { class: 'card' }, h('h3', {}, 'Tillar bo\'yicha tugatilgan darslar'),
          byLang.length ? byLang.map((x) => h('div', { class: 'hbar' }, h('span', {}, x.lang.toUpperCase()), h('i', { style: { width: `${(x.n / maxL) * 100}%` } }), h('b', {}, num(x.n)))) : h('p', { class: 'muted' }, "Hali ma'lumot yo'q")),
        h('div', { class: 'card' }, h('h3', {}, "O'yinlar (so'nggi 7 kun)"),
          games.length ? games.map((x) => h('div', { class: 'hbar' }, h('span', {}, GN[x.game] || x.game), h('i', { style: { width: `${(x.n / maxG) * 100}%` } }), h('b', {}, num(x.n)))) : h('p', { class: 'muted' }, "Hali o'ynalmagan"))));
  }

  // ---------- users ----------
  const usersState = { q: '', sort: 'new', page: 1 };
  async function pageUsers(active) {
    const qs = new URLSearchParams({ q: usersState.q, sort: usersState.sort, page: usersState.page });
    const data = await api('GET', `/api/admin/users?${qs}`);
    const search = h('input', { type: 'search', class: 't-input', placeholder: 'Ism yoki email qidiring…', value: usersState.q, 'aria-label': 'Qidiruv' });
    let timer;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { usersState.q = search.value; usersState.page = 1; pageUsers(active); }, 350); });
    const sort = h('select', { class: 'sel', 'aria-label': 'Saralash', onchange: (e) => { usersState.sort = e.target.value; usersState.page = 1; pageUsers(active); } },
      [['new', "Yangilari avval"], ['xp', "Eng ko'p XP"], ['active', 'Oxirgi faollik']].map(([v, l]) => h('option', { value: v, selected: usersState.sort === v }, l)));
    const rows = data.users.map((u) => h('tr', { class: 'click', onclick: () => openUser(u.id) },
      h('td', {}, h('b', {}, u.name), ' ', u.role === 'admin' ? h('span', { class: 'tag admin' }, 'admin') : null, u.banned ? h('span', { class: 'tag ban' }, 'bloklangan') : null),
      h('td', {}, u.email), h('td', {}, num(u.xp)), h('td', {}, u.streak), h('td', {}, fmtDate(u.created_at)), h('td', {}, fmtDay(u.last_active))));
    shell(active, h('h1', {}, 'Foydalanuvchilar'), h('p', { class: 'lead' }, `Jami: ${num(data.total)}`),
      h('div', { class: 'toolbar' }, search, sort),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['Ism', 'Email', 'XP', 'Seriya', "Ro'yxatdan o'tgan", 'Oxirgi faollik'].map((x) => h('th', {}, x)))),
        h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: 6, class: 'center muted', style: { padding: '30px' } }, 'Topilmadi'))))),
      h('div', { class: 'pager' },
        h('button', { class: 'btn btn-ghost btn-sm', disabled: data.page <= 1, onclick: () => { usersState.page--; pageUsers(active); } }, '← Oldingi'),
        h('span', {}, `${data.page} / ${data.pages}`),
        h('button', { class: 'btn btn-ghost btn-sm', disabled: data.page >= data.pages, onclick: () => { usersState.page++; pageUsers(active); } }, 'Keyingi →')));
    if (document.activeElement !== search && usersState.q) search.focus();
  }

  function modal(...kids) {
    const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) bg.remove(); } }, h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', style: { maxWidth: '640px' } }, kids));
    document.body.append(bg);
    return { close: () => bg.remove(), el: bg };
  }

  const openUser = guard(async (id) => {
    const d = await api('GET', `/api/admin/users/${id}`);
    const u = d.user;
    const self = u.id === S.me.id;
    const m = modal();
    const act = (label, cls, fn) => h('button', { class: `btn btn-sm ${cls}`, onclick: guard(async () => { await fn(); m.close(); toast('Bajarildi ✓'); route(); }) }, label);
    m.el.firstChild.replaceChildren(
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '14px' } }, h('div', { class: 'avatar', style: { width: '54px', height: '54px', fontSize: '1.4rem' } }, u.name[0].toUpperCase()),
        h('div', {}, h('h2', { style: { marginBottom: 0 } }, u.name, ' ', u.isAdmin ? h('span', { class: 'tag admin' }, 'admin') : null, u.banned ? h('span', { class: 'tag ban' }, 'bloklangan') : null), h('div', { class: 'muted' }, u.email))),
      h('div', { class: 'detail-grid' },
        h('div', { class: 'stat-tile' }, h('b', {}, u.level), h('span', {}, 'Daraja')), h('div', { class: 'stat-tile' }, h('b', {}, num(u.xp)), h('span', {}, 'XP')),
        h('div', { class: 'stat-tile' }, h('b', {}, u.streak), h('span', {}, 'Seriya')), h('div', { class: 'stat-tile' }, h('b', {}, d.words), h('span', {}, "So'zlar"))),
      h('p', { class: 'muted' }, `Ro'yxatdan o'tgan: ${fmtDate(u.createdAt)} · Oxirgi faollik: ${fmtDay(u.lastActive)}`),
      h('h3', { class: 'sub' }, 'Tillar bo\'yicha progress'),
      d.progress.length ? h('div', { class: 'mini-list' }, d.progress.map((p) => h('div', {}, `${p.lang.toUpperCase()}: ${p.lessons} dars, ${p.tests} test`))) : h('p', { class: 'muted' }, "Hali darslar yo'q"),
      h('h3', { class: 'sub' }, 'Nishonlar'), d.badges.length ? h('div', {}, d.badges.map((b) => h('span', { class: 'tag ok', style: { margin: '2px' } }, `${b.emoji} ${b.title}`))) : h('p', { class: 'muted' }, "Yo'q"),
      h('h3', { class: 'sub' }, "So'nggi XP"),
      d.recent.length ? h('div', { class: 'mini-list' }, d.recent.map((r) => h('div', {}, `+${r.amount} XP · ${r.source} · ${(r.lang || '').toUpperCase()} · ${fmtDate(r.created_at)}`))) : h('p', { class: 'muted' }, "Yo'q"),
      h('h3', { class: 'sub' }, 'Amallar'),
      h('div', { class: 'row-actions' },
        !self ? act(u.isAdmin ? 'Adminlikni olib tashlash' : 'Admin qilish', 'btn-ghost', () => api('PATCH', `/api/admin/users/${u.id}`, { role: u.isAdmin ? 'user' : 'admin' })) : null,
        !self && !u.isAdmin ? act(u.banned ? 'Blokdan chiqarish' : 'Bloklash', 'btn-ghost', () => api('PATCH', `/api/admin/users/${u.id}`, { banned: !u.banned })) : null,
        act('Progressni tozalash', 'btn-ghost', async () => { await api('POST', `/api/admin/users/${u.id}/reset`, { what: 'progress' }); }),
        act('XP va nishonlarni tozalash', 'btn-ghost', async () => { await api('POST', `/api/admin/users/${u.id}/reset`, { what: 'xp' }); }),
        !self && !u.isAdmin ? act("Hisobni o'chirish", 'btn-danger', async () => { await api('DELETE', `/api/admin/users/${u.id}`); }) : null),
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '12px' } },
        h('input', { id: 'adminNewPass', type: 'password', placeholder: 'Yangi parol (kamida 8 belgi)', class: 't-input', style: { flex: 1, padding: '8px 12px', fontSize: '.9rem' } }),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: guard(async () => {
          const inp = $('#adminNewPass');
          if (!inp || inp.value.length < 8) throw new Error("Parol kamida 8 ta belgidan iborat bo'lsin");
          await api('POST', `/api/admin/users/${u.id}/password`, { password: inp.value });
          inp.value = ''; toast('Parol yangilandi ✓');
        }) }, "Parolni o'zgartirish")),
      h('button', { class: 'btn btn-ghost btn-block', style: { marginTop: '16px' }, onclick: m.close }, 'Yopish'));
  });

  // ---------- content ----------
  const ED = { unit: null, data: null };
  async function pageContent(active) {
    ED.data = await api('GET', '/api/admin/content');
    if (!ED.unit || !ED.data.units.some((u) => u.key === ED.unit)) ED.unit = ED.data.units[0] ? ED.data.units[0].key : null;
    drawContent(active);
  }

  function langModal(l) {
    const isNew = !l;
    const f = (name, label, val, attrs = {}) => h('label', { class: 'field' }, h('span', {}, label), h('input', { name, value: val ?? '', ...attrs }));
    const form = h('form', { class: 'form-grid' },
      f('code', 'Kod (masalan: it)', l ? l.code : '', { maxlength: 3, required: true, disabled: !isNew, pattern: '[a-z]{2,3}' }), f('name', "Nomi (o'zbekcha)", l ? l.name : '', { required: true, maxlength: 40 }),
      f('native', 'Mahalliy nomi', l ? l.native : '', { required: true, maxlength: 40 }), f('flag', 'Bayroq emoji', l ? l.flag : '', { required: true, maxlength: 8 }),
      f('tts', 'Ovoz kodi (en-GB, it-IT…)', l ? l.tts : '', { required: true, maxlength: 12 }), f('color', 'Rang', l ? l.color : '#7c5cff', { type: 'color' }),
      h('label', { class: 'field' }, h('span', {}, "Yozuv yo'nalishi"), h('select', { name: 'dir', class: 'sel' }, [['ltr', 'Chapdan o\'ngga'], ['rtl', 'O\'ngdan chapga (arab, fors…)']].map(([v, t]) => h('option', { value: v, selected: l && l.dir === v }, t)))),
      h('label', { class: 'switch', style: { alignSelf: 'end', paddingBottom: '14px' } }, h('input', { type: 'checkbox', name: 'enabled', checked: l ? l.enabled : true }), 'Faol'));
    const m = modal(h('h2', {}, isNew ? "Til qo'shish" : `${l.flag} ${l.name}`), form,
      isNew ? h('p', { class: 'muted' }, "Yangi til qo'shilgach, Kontent bo'limida so'zlarga tarjima kiriting. Kamida 3 ta so'z tarjimasi bo'lsa til foydalanuvchilarga ko'rinadi.") : null,
      h('div', { style: { display: 'flex', gap: '10px', marginTop: '14px' } }, h('button', {
        class: 'btn btn-main', onclick: guard(async () => {
          const fd = new FormData(form);
          const code = isNew ? String(fd.get('code')).trim().toLowerCase() : l.code;
          await api('PUT', `/api/admin/languages/${code}`, { name: fd.get('name'), native: fd.get('native'), flag: fd.get('flag'), tts: fd.get('tts'), color: fd.get('color'), dir: fd.get('dir'), enabled: form.elements.enabled.checked });
          m.close(); toast('Saqlandi ✓'); route();
        }),
      }, 'Saqlash'), h('button', { class: 'btn btn-ghost', onclick: () => m.close() }, 'Bekor qilish')));
  }

  function unitModal(u) {
    const isNew = !u;
    const key = h('input', { value: u ? u.key : '', disabled: !isNew, required: true, maxlength: 20, placeholder: 'sports', pattern: '[a-z0-9]{2,20}' });
    const title = h('input', { value: u ? u.title : '', required: true, maxlength: 60, placeholder: 'Sport' });
    const emoji = h('input', { value: u ? u.emoji : '📘', maxlength: 8 });
    const m = modal(h('h2', {}, isNew ? "Yangi mavzu" : 'Mavzuni tahrirlash'),
      h('label', { class: 'field' }, h('span', {}, 'Kalit (lotin harf/raqam)'), key), h('label', { class: 'field' }, h('span', {}, 'Sarlavha'), title), h('label', { class: 'field' }, h('span', {}, 'Emoji'), emoji),
      h('div', { style: { display: 'flex', gap: '10px' } }, h('button', {
        class: 'btn btn-main', onclick: guard(async () => {
          if (isNew) { await api('POST', '/api/admin/units', { key: key.value.trim(), title: title.value, emoji: emoji.value }); ED.unit = key.value.trim(); }
          else await api('PATCH', `/api/admin/units/${u.key}`, { title: title.value, emoji: emoji.value });
          m.close(); toast('Saqlandi ✓'); route();
        }),
      }, 'Saqlash'), h('button', { class: 'btn btn-ghost', onclick: () => m.close() }, 'Bekor qilish')));
  }

  function drawContent(active) {
    const { languages, units, totals } = ED.data;
    const unit = units.find((u) => u.key === ED.unit);
    const langsAll = languages;

    const langTable = h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, ['Til', 'Kod', "So'zlar", 'Jumlalar', 'Holat', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, langsAll.map((l) => h('tr', {},
        h('td', {}, `${l.flag} ${l.name}`, ' ', h('span', { class: 'muted' }, l.native)), h('td', {}, l.code),
        h('td', {}, h('div', { class: 'cov' }, h('i', { style: { width: `${(l.concepts / Math.max(1, totals.concepts)) * 100}%` } })), h('span', { class: 'muted' }, `${l.concepts}/${totals.concepts}`)),
        h('td', {}, `${l.sentences}/${totals.sentences}`),
        h('td', {}, l.playable && l.enabled ? h('span', { class: 'tag ok' }, 'faol') : l.enabled ? h('span', { class: 'tag' }, 'tarjima yetarli emas') : h('span', { class: 'tag ban' }, "o'chirilgan")),
        h('td', {}, h('button', { class: 'btn btn-ghost btn-sm', onclick: () => langModal(l) }, 'Tahrirlash')))))));

    const unitList = h('div', { class: 'unit-list' },
      units.map((u) => h('button', { class: 'unit-item' + (u.key === ED.unit ? ' on' : '') + (u.enabled ? '' : ' off'), onclick: () => { ED.unit = u.key; drawContent(active); } }, h('span', {}, u.emoji), h('span', {}, u.title), h('small', {}, `${u.concepts.length}`))),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: () => unitModal(null) }, "+ Yangi mavzu"));

    shell(active, h('h1', {}, 'Kontent'), h('p', { class: 'lead' }, `${units.length} mavzu · ${totals.concepts} so'z · ${totals.sentences} jumla. O'zgarishlar darhol saytda ko'rinadi.`),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn btn-ghost btn-sm', onclick: () => langModal(null) }, "+ Til qo'shish"),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: guard(exportContent) }, '⬇ JSON eksport')),
      langTable, h('h3', { class: 'sub' }, 'Mavzular'),
      h('div', { class: 'ed-layout' }, unitList, unit ? unitEditor(unit, langsAll, active) : h('div', { class: 'empty' }, "Mavzu yo'q")));
  }

  async function exportContent() {
    const data = await api('GET', '/api/admin/export');
    const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: `linguaflow-content-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
  }

  // Auto-saving cell: PATCHes on change, flashes green/red.
  function cell(value, { dir, cls = '', placeholder = '' }, save) {
    const inp = h('input', { class: `cell ${cls}`, value: value ?? '', dir: dir || null, placeholder, maxlength: 200 });
    inp.addEventListener('change', async () => {
      try { await save(inp.value.trim()); inp.classList.remove('err'); inp.classList.add('saved'); setTimeout(() => inp.classList.remove('saved'), 900); }
      catch (e) { inp.classList.add('err'); toast(e.message); }
    });
    return inp;
  }

  function unitEditor(unit, langs, active) {
    const rtl = langs.filter((l) => l.dir === 'rtl');
    const reload = () => route();
    const mv = (url, dir) => guard(async () => { await api('POST', url, { dir }); reload(); });
    const head = h('div', { class: 'ed-head' }, h('h2', {}, `${unit.emoji} ${unit.title}`),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: unit.enabled, onchange: guard(async (e) => { await api('PATCH', `/api/admin/units/${unit.key}`, { enabled: e.target.checked }); toast(e.target.checked ? 'Faollashtirildi' : "O'chirildi"); reload(); }) }), 'Faol'),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: mv(`/api/admin/units/${unit.key}/move`, 'up'), title: 'Yuqoriga' }, '↑'),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: mv(`/api/admin/units/${unit.key}/move`, 'down'), title: 'Pastga' }, '↓'),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: () => unitModal(unit) }, '✏️ Tahrirlash'),
      h('button', { class: 'btn btn-danger btn-sm', onclick: guard(async () => { if (!confirm(`"${unit.title}" mavzusi va uning barcha so'z/jumlalari o'chiriladi. Davom etasizmi?`)) return; await api('DELETE', `/api/admin/units/${unit.key}`); ED.unit = null; reload(); }) }, "O'chirish"));

    // concepts table
    const cHead = h('tr', {}, h('th', {}, '#'), h('th', {}, "O'zbekcha"), langs.map((l) => h('th', {}, `${l.flag} ${l.code.toUpperCase()}`)), rtl.map((l) => h('th', {}, `${l.code.toUpperCase()} translit`)), h('th', {}, ''));
    const cRows = unit.concepts.map((c, i) => h('tr', {},
      h('td', { class: 'muted' }, i + 1),
      h('td', {}, cell(c.uz, {}, (v) => api('PATCH', `/api/admin/concepts/${c.id}`, { uz: v }))),
      langs.map((l) => h('td', {}, cell(c.t[l.code], { dir: l.dir, placeholder: '—' }, (v) => api('PATCH', `/api/admin/concepts/${c.id}`, { t: { [l.code]: v } })))),
      rtl.map((l) => h('td', {}, cell((c.tr || {})[l.code], { cls: 'tr', placeholder: '—' }, (v) => api('PATCH', `/api/admin/concepts/${c.id}`, { tr: { [l.code]: v } })))),
      h('td', {}, h('div', { class: 'row-actions' },
        h('button', { class: 'btn btn-ghost btn-sm', onclick: mv(`/api/admin/concepts/${c.id}/move`, 'up') }, '↑'), h('button', { class: 'btn btn-ghost btn-sm', onclick: mv(`/api/admin/concepts/${c.id}/move`, 'down') }, '↓'),
        h('button', { class: 'btn btn-danger btn-sm', onclick: guard(async () => { if (!confirm(`"${c.uz}" o'chirilsinmi?`)) return; await api('DELETE', `/api/admin/concepts/${c.id}`); reload(); }) }, '✕')))));

    const nu = h('input', { class: 'cell', placeholder: "Yangi so'z (o'zbekcha)", maxlength: 120 });
    const nt = Object.fromEntries(langs.map((l) => [l.code, h('input', { class: 'cell', dir: l.dir, placeholder: l.code, maxlength: 120 })]));
    const ntr = Object.fromEntries(rtl.map((l) => [l.code, h('input', { class: 'cell tr', placeholder: 'translit', maxlength: 120 })]));
    const add = guard(async () => {
      await api('POST', `/api/admin/units/${unit.key}/concepts`, { uz: nu.value, t: Object.fromEntries(Object.entries(nt).map(([k, i]) => [k, i.value])), tr: Object.fromEntries(Object.entries(ntr).map(([k, i]) => [k, i.value])) });
      toast("So'z qo'shildi ✓"); reload();
    });
    const cNew = h('tr', { class: 'new-row' }, h('td', {}, '+'), h('td', {}, nu), langs.map((l) => h('td', {}, nt[l.code])), rtl.map((l) => h('td', {}, ntr[l.code])), h('td', {}, h('button', { class: 'btn btn-main btn-sm', onclick: add }, "Qo'shish")));

    // sentences table
    const sHead = h('tr', {}, h('th', {}, '#'), h('th', {}, "O'zbekcha"), langs.map((l) => h('th', {}, `${l.flag} ${l.code.toUpperCase()}`)), h('th', {}, ''));
    const sRows = unit.sentences.map((s, i) => h('tr', {}, h('td', { class: 'muted' }, i + 1), h('td', {}, cell(s.uz, {}, (v) => api('PATCH', `/api/admin/sentences/${s.id}`, { uz: v }))),
      langs.map((l) => h('td', {}, cell(s.t[l.code], { dir: l.dir, placeholder: '—' }, (v) => api('PATCH', `/api/admin/sentences/${s.id}`, { t: { [l.code]: v } })))),
      h('td', {}, h('button', { class: 'btn btn-danger btn-sm', onclick: guard(async () => { if (!confirm("Jumla o'chirilsinmi?")) return; await api('DELETE', `/api/admin/sentences/${s.id}`); reload(); }) }, '✕'))));
    const su = h('input', { class: 'cell', placeholder: "Yangi jumla (o'zbekcha)", maxlength: 200 });
    const st = Object.fromEntries(langs.map((l) => [l.code, h('input', { class: 'cell', dir: l.dir, placeholder: l.code, maxlength: 200 })]));
    const sNew = h('tr', { class: 'new-row' }, h('td', {}, '+'), h('td', {}, su), langs.map((l) => h('td', {}, st[l.code])),
      h('td', {}, h('button', { class: 'btn btn-main btn-sm', onclick: guard(async () => { await api('POST', `/api/admin/units/${unit.key}/sentences`, { uz: su.value, t: Object.fromEntries(Object.entries(st).map(([k, i]) => [k, i.value])) }); toast("Jumla qo'shildi ✓"); reload(); }) }, "Qo'shish")));

    return h('div', {}, head,
      h('p', { class: 'muted' }, "Katakni tahrirlang va boshqa joyga bosing — avtomatik saqlanadi. Bo'sh qoldirilgan tarjima o'sha tilda so'zni yashiradi. Har 5 ta so'z bitta dars bo'ladi."),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', {}, cHead), h('tbody', {}, cRows, cNew))),
      h('h3', { class: 'sub' }, `Jumlalar (${unit.sentences.length}) — "Jumla tuzish" mashqi va o'yini uchun, 2–9 so'z`),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', {}, sHead), h('tbody', {}, sRows, sNew))));
  }

  // ---------- settings & audit ----------
  async function pageSettings(active) {
    const { announcement: a } = await api('GET', '/api/admin/settings');
    const en = h('input', { type: 'checkbox', checked: a.enabled });
    const text = h('textarea', { class: 't-input', rows: 3, maxlength: 240, placeholder: "Masalan: Yangi darslar qo'shildi! 🎉", style: { width: '100%', fontSize: '1rem' } }, a.text || '');
    const level = h('select', { class: 'sel' }, [['info', "Oddiy (ko'k)"], ['warn', 'Muhim (sariq)']].map(([v, t]) => h('option', { value: v, selected: a.level === v }, t)));
    shell(active, h('h1', {}, "E'lon"), h('p', { class: 'lead' }, "Foydalanuvchilarga ilovaning yuqorisida ko'rsatiladi."),
      h('div', { class: 'card', style: { display: 'grid', gap: '14px', maxWidth: '640px' } },
        h('label', { class: 'switch' }, en, "E'lon faol"), h('label', { class: 'field' }, h('span', {}, 'Matn (240 belgigacha)'), text), h('label', { class: 'field' }, h('span', {}, 'Turi'), level),
        h('div', {}, h('button', { class: 'btn btn-main', onclick: guard(async () => { await api('PUT', '/api/admin/settings', { announcement: { enabled: en.checked, text: text.value, level: level.value } }); toast('Saqlandi ✓'); }) }, 'Saqlash'))));
  }

  async function pageAudit(active) {
    const { rows } = await api('GET', '/api/admin/audit?limit=100');
    shell(active, h('h1', {}, 'Audit jurnali'), h('p', { class: 'lead' }, "Adminlar bajargan so'nggi amallar"),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['Vaqt', 'Admin', 'Amal', 'Tafsilot'].map((x) => h('th', {}, x)))),
        h('tbody', {}, rows.length ? rows.map((r) => h('tr', {}, h('td', {}, fmtDate(r.created_at)), h('td', {}, r.admin || '—'), h('td', {}, h('span', { class: 'tag' }, r.action)), h('td', {}, r.detail || ''))) : h('tr', {}, h('td', { colspan: 4, class: 'center muted', style: { padding: '30px' } }, 'Hali amallar yo\'q'))))));
  }

  // ---------- boot ----------
  async function boot() {
    try { S.me = (await api('GET', '/api/me')).user; } catch { S.me = null; LS.remove('lf_token'); }
    if (!S.me) return renderLogin();
    if (!S.me.isAdmin) {
      return mount(h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' }, h('h1', {}, 'Ruxsat yo\'q'), h('p', { class: 'sub' }, `${S.me.email} hisobi admin emas.`),
        h('a', { class: 'btn btn-main btn-block', href: '/app' }, 'Ilovaga qaytish'), h('button', { class: 'btn btn-ghost btn-block', style: { marginTop: '10px' }, onclick: async () => { LS.remove('lf_token'); try { await api('POST', '/api/auth/logout', {}); } catch {} renderLogin(); } }, 'Boshqa hisob bilan kirish'))));
    }
    if (!location.hash) location.hash = '#/dashboard';
    route();
  }
  boot();
})();
