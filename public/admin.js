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
    headers['x-client-session'] = '1';
    const tok = LS.get('lf_session_token') || LS.get('lf_token');
    if (tok) headers['authorization'] = `Bearer ${tok}`;
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
    const totpInp = h('input', { type: 'text', placeholder: '000 000 yoki zaxira kodi', autocomplete: 'one-time-code', style: { letterSpacing: '4px', textAlign: 'center', fontSize: '1.2rem', fontWeight: 'bold' } });
    const totpField = h('label', { class: 'field', style: { display: 'none' } }, h('span', {}, 'Google Authenticator kodi'), totpInp);
    const passField = h('label', { class: 'field' }, h('span', {}, 'Parol'), pass);
    const emailField = h('label', { class: 'field' }, h('span', {}, 'Email'), email);
    const submitBtn = h('button', { class: 'btn btn-main btn-block', type: 'submit' }, 'Kirish');
    let tempToken = null;

    mount(h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' },
      h('div', { class: 'logo' }, h('span', { class: 'logo-mark' }, 'L'), 'LinguaFlow Admin'),
      h('h1', {}, 'Admin panelga kirish'), h('p', { class: 'sub' }, 'Faqat administratorlar uchun.'),
      h('form', {
        onsubmit: async (e) => {
          e.preventDefault(); err.textContent = '';
          submitBtn.disabled = true;
          try {
            if (tempToken) {
              await api('POST', '/api/auth/login-2fa', { tempToken, code: totpInp.value.trim() });
              boot();
              return;
            }
            const res = await api('POST', '/api/auth/login', { email: email.value, password: pass.value });
            if (res && res.token) {
              LS.set('lf_session_token', res.token);
              LS.set('lf_token', res.token);
            }
            if (res.require2fa) {
              tempToken = res.tempToken;
              passField.style.display = 'none';
              emailField.style.display = 'none';
              totpField.style.display = 'block';
              submitBtn.textContent = 'Kodni tasdiqlash';
              totpInp.focus();
              return;
            }
            boot();
          } catch (ex) {
            err.textContent = ex.message;
          } finally {
            submitBtn.disabled = false;
          }
        },
      }, emailField, passField, totpField, err, submitBtn),
      h('div', { class: 'auth-switch' }, h('a', { href: '/app' }, '← Ilovaga qaytish')))));
  }

  // ---------- shell & router ----------
  const NAV_ADMIN = [['/dashboard', '📊', 'Boshqaruv'], ['/users', '👥', 'Foydalanuvchilar'], ['/content', '📚', 'Kontent'], ['/items', '🗂️', 'Savollar banki'], ['/settings', '⚙️', 'Sozlamalar'], ['/audit', '🧾', 'Audit jurnali']];
  const NAV_REVIEWER = [['/items', '🗂️', 'Savollar banki']];
  const navItems = () => (S.me && S.me.isAdmin ? NAV_ADMIN : NAV_REVIEWER);
  function shell(active, ...content) {
    const side = h('aside', { class: 'side' },
      h('a', { href: '#/dashboard', class: 'logo' }, h('span', { class: 'logo-mark' }, 'L'), 'Admin'),
      navItems().map(([p, ic, l]) => h('a', { href: '#' + p, class: 'nav-item' + (active === p ? ' on' : '') }, h('span', { class: 'ic' }, ic), l)),
      h('div', { style: { flex: 1 } }),
      h('a', { href: '/app#/learn', class: 'nav-item' }, h('span', { class: 'ic' }, '↩️'), 'Ilovaga qaytish'));
    const top = h('header', { class: 'topbar' }, h('div', { class: 'logo-sm' }, h('span', { class: 'logo-mark' }, 'L'), ' Admin'),
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('span', { class: 'chip' }, '🛡️ ', S.me.name),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => { await api('POST', '/api/auth/logout', {}); S.me = null; renderLogin(); } }, 'Chiqish')));
    const tabs = h('nav', { class: 'tabbar' }, navItems().map(([p, ic, l]) => h('a', { href: '#' + p, class: 'tab' + (active === p ? ' on' : '') }, h('span', { class: 'ic' }, ic), l.split(' ')[0])));
    mount(h('div', { class: 'shell' }, side, h('div', { class: 'main' }, top, h('main', { class: 'adm-page' }, content)), tabs));
  }

  const pages = { '/dashboard': pageDashboard, '/users': pageUsers, '/content': pageContent, '/items': pageItems, '/settings': pageSettings, '/audit': pageAudit };
  async function route() {
    if (!S.me) return;
    const home = S.me.isAdmin ? '/dashboard' : '/items';
    const path = (location.hash.slice(1) || home).split('?')[0];
    // reviewers only get the item bank; everything else is admin-only (and enforced by the server too)
    const allowed = S.me.isAdmin ? pages : { '/items': pageItems };
    const target = path in allowed ? path : home;
    try { await allowed[target](target); } catch (e) {
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
      h('td', {}, h('b', {}, u.name), ' ', u.role === 'admin' ? h('span', { class: 'tag admin' }, 'admin') : null, u.role === 'reviewer' ? h('span', { class: 'tag review' }, 'tekshiruvchi') : null, u.banned ? h('span', { class: 'tag ban' }, 'bloklangan') : null),
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
        h('div', {}, h('h2', { style: { marginBottom: 0 } }, u.name, ' ', u.isAdmin ? h('span', { class: 'tag admin' }, 'admin') : null, u.role === 'reviewer' ? h('span', { class: 'tag review' }, 'tekshiruvchi ' + (u.reviewerLangs || []).join('/').toUpperCase()) : null, u.banned ? h('span', { class: 'tag ban' }, 'bloklangan') : null, u.twoFactorEnabled ? h('span', { class: 'tag ok' }, '🔐 2FA') : null), h('div', { class: 'muted' }, u.email))),
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
        !self && !u.isAdmin ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { m.close(); reviewerModal(u); } }, u.role === 'reviewer' ? 'Tekshiruvchi tillarini o\'zgartirish' : 'Tekshiruvchi qilish') : null,
        !self && u.role === 'reviewer' ? act('Tekshiruvchilikni olib tashlash', 'btn-ghost', () => api('PATCH', `/api/admin/users/${u.id}`, { role: 'user' })) : null,
        !self && !u.isAdmin ? act(u.banned ? 'Blokdan chiqarish' : 'Bloklash', 'btn-ghost', () => api('PATCH', `/api/admin/users/${u.id}`, { banned: !u.banned })) : null,
        u.twoFactorEnabled ? act("2FA ni o'chirish (reset)", 'btn-ghost', () => api('POST', `/api/admin/users/${u.id}/reset-2fa`)) : null,
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
      units.map((u) => h('button', { class: 'unit-item' + (u.key === ED.unit ? ' on' : '') + (u.enabled ? '' : ' off'), onclick: () => { ED.unit = u.key; drawContent(active); } }, h('span', {}, u.emoji), h('span', {}, u.title), h('small', {}, `${u.level} · ${u.concepts.length}`))),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: () => unitModal(null) }, "+ Yangi mavzu"));

    shell(active, h('h1', {}, 'Kontent'), h('p', { class: 'lead' }, `${units.length} mavzu · ${totals.concepts} so'z · ${totals.sentences} jumla. O'zgarishlar darhol saytda ko'rinadi.`),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn btn-ghost btn-sm', onclick: () => langModal(null) }, "+ Til qo'shish"),
        ...['A1', 'A2', 'B1'].flatMap((lv) => [true, false].map((on) => {
          const n = units.filter((u) => u.level === lv).length;
          return h('button', { class: 'btn btn-ghost btn-sm', disabled: !n, title: `${lv} darajadagi ${n} ta mavzu`, onclick: guard(async () => {
            if (!confirm(`${lv} darajadagi ${n} ta mavzuni ${on ? 'FAOL qilish' : "O'CHIRISH"}? ${on ? "Faqat tekshiruvchilar tasdiqlagan kontent uchun!" : ''}`)) return;
            const r = await api('POST', `/api/admin/units-level/${lv}`, { enabled: on }); toast(`${r.changed} ta mavzu yangilandi`); route();
          }) }, `${lv}: ${on ? 'hammasini yoqish' : "hammasini o'chirish"}`);
        })),
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
    const [{ announcement: a }, lim, sys] = await Promise.all([api('GET', '/api/admin/settings'), api('GET', '/api/admin/limits'), api('GET', '/api/admin/system')]);
    const en = h('input', { type: 'checkbox', checked: a.enabled });
    const text = h('textarea', { class: 't-input', rows: 3, maxlength: 240, placeholder: "Masalan: Yangi darslar qo'shildi! 🎉", style: { width: '100%', fontSize: '1rem' } }, a.text || '');
    const level = h('select', { class: 'sel' }, [['info', "Oddiy (ko'k)"], ['warn', 'Muhim (sariq)']].map(([v, t]) => h('option', { value: v, selected: a.level === v }, t)));
    const FEATURE = { tutor: ['AI ustoz (suhbat)', 'Kuniga har bir foydalanuvchi uchun xabarlar soni'], writing: ['Yozishni tekshirish', 'IELTS Writing va insho tekshiruvi'], speaking: ['Gapirish / talaffuz', 'Ovozli ustoz, Speaking va talaffuz mashqlari'] };
    const inputs = Object.fromEntries(Object.keys(FEATURE).map((k) => [k, h('input', { type: 'number', min: 0, max: 100000, class: 't-input', value: lim.limits[k], style: { padding: '8px 12px', maxWidth: '140px' } })]));
    const limitsCard = h('div', { class: 'card', style: { display: 'grid', gap: '14px', maxWidth: '640px', marginTop: '18px' } },
      h('h3', { style: { margin: 0 } }, 'AI limitlari (bepul rejim)'), h('p', { class: 'muted', style: { margin: 0 } }, "Har bir foydalanuvchi uchun kunlik chegara. 0 = imkoniyat o'chirilgan. Adminlarga limit qo'llanmaydi. Foydalanuvchilar ko'payganda shu yerdan pullik rejaga o'tish uchun qiymatlarni kamaytirasiz yoki xizmat kalitini almashtirasiz."),
      Object.entries(FEATURE).map(([k, [t, d]]) => h('label', { class: 'field', style: { margin: 0 } }, h('span', {}, `${t} — ${d}`), inputs[k])),
      h('div', {}, h('button', { class: 'btn btn-main', onclick: guard(async () => { await api('PUT', '/api/admin/limits', { limits: Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, Number(el.value)])) }); toast('Limitlar saqlandi ✓'); route(); }) }, 'Saqlash')),
      h('h3', { class: 'sub', style: { margin: '6px 0 0' } }, 'Bugungi foydalanish'),
      lim.features.length ? h('div', { class: 'mini-list' }, lim.features.map((f) => h('div', {}, `${(FEATURE[f.feature] || [f.feature])[0]}: ${f.calls} ta so'rov, ${f.users} ta foydalanuvchi`))) : h('p', { class: 'muted', style: { margin: 0 } }, "Bugun hali foydalanilmagan"),
      lim.top.length ? h('div', { class: 'mini-list' }, h('b', {}, 'Eng faol:'), lim.top.map((u) => h('div', {}, `${u.name} (${u.email}): ${u.calls} ta`))) : null);
    const fmtSize = (b) => (b == null ? '—' : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
    const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${m} daqiqa oldin` : m < 2880 ? `${Math.round(m / 60)} soat oldin` : `${Math.round(m / 1440)} kun oldin`; };
    const lb = sys.lastBackup;
    const itemTxt = sys.items.length ? sys.items.map((i) => `${i.status}: ${i.n}`).join(', ') : 'savollar yo\'q';
    const sysCard = h('div', { class: 'card', style: { display: 'grid', gap: '6px', maxWidth: '640px', marginBottom: '18px' } },
      h('h3', { style: { margin: 0 } }, 'Tizim holati'),
      h('div', { class: 'mini-list' },
        h('div', {}, `AI: ${sys.aiProvider ? '✅ ' + sys.aiProvider : "❌ o'chiq (API kalit sozlanmagan)"}`),
        h('div', {}, `Zaxira nusxa: ${lb ? `✅ ${ago(lb.at)} (${fmtSize(lb.size)})` : "⚠️ hali olinmagan (ishga tushgandan 30 soniya keyin olinadi)"}`),
        h('div', {}, `Baza hajmi: ${fmtSize(sys.dbSize)} · foydalanuvchilar: ${sys.users} · bugun faol: ${sys.activeToday}`),
        h('div', {}, `Savollar bankida: ${itemTxt}`),
        h('div', {}, `Server ishlagan vaqt: ${Math.round(sys.uptimeSec / 3600)} soat · Node ${sys.node}`)));
    shell(active, h('h1', {}, 'Sozlamalar'), h('p', { class: 'lead' }, "Tizim holati, e'lon banneri va AI limitlari."), sysCard,
      h('div', { class: 'card', style: { display: 'grid', gap: '14px', maxWidth: '640px' } },
        h('label', { class: 'switch' }, en, "E'lon faol"), h('label', { class: 'field' }, h('span', {}, 'Matn (240 belgigacha)'), text), h('label', { class: 'field' }, h('span', {}, 'Turi'), level),
        h('div', {}, h('button', { class: 'btn btn-main', onclick: guard(async () => { await api('PUT', '/api/admin/settings', { announcement: { enabled: en.checked, text: text.value, level: level.value } }); toast('Saqlandi ✓'); }) }, 'Saqlash'))),
      limitsCard);
  }

  async function pageAudit(active) {
    const { rows } = await api('GET', '/api/admin/audit?limit=100');
    shell(active, h('h1', {}, 'Audit jurnali'), h('p', { class: 'lead' }, "Adminlar bajargan so'nggi amallar"),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['Vaqt', 'Admin', 'Amal', 'Tafsilot'].map((x) => h('th', {}, x)))),
        h('tbody', {}, rows.length ? rows.map((r) => h('tr', {}, h('td', {}, fmtDate(r.created_at)), h('td', {}, r.admin || '—'), h('td', {}, h('span', { class: 'tag' }, r.action)), h('td', {}, r.detail || ''))) : h('tr', {}, h('td', { colspan: 4, class: 'center muted', style: { padding: '30px' } }, 'Hali amallar yo\'q'))))));
  }

  // ---------- boot ----------
  // ---------- reviewers ----------
  async function reviewerModal(u) {
    const meta = await api('GET', '/api/admin/items/meta');
    const picked = new Set(u.reviewerLangs || []);
    const boxes = meta.languages.map((l) => h('label', { class: 'switch', style: { display: 'flex', margin: '6px 0' } },
      h('input', { type: 'checkbox', checked: picked.has(l.code), onchange: (e) => { if (e.target.checked) picked.add(l.code); else picked.delete(l.code); } }), `${l.flag} ${l.name}`));
    const m = modal(h('h2', {}, `${u.name}: tekshiruvchi`), h('p', { class: 'muted' }, 'Tekshiruvchi faqat tanlangan tillardagi savollarni ko\'radi, tahrirlaydi va tasdiqlaydi. O\'z savolini o\'zi tasdiqlay olmaydi.'), boxes,
      h('div', { style: { display: 'flex', gap: '10px', marginTop: '14px' } },
        h('button', { class: 'btn btn-main', onclick: guard(async () => { await api('PATCH', `/api/admin/users/${u.id}`, { role: 'reviewer', reviewerLangs: [...picked] }); m.close(); toast('Saqlandi ✓'); route(); }) }, 'Saqlash'),
        h('button', { class: 'btn btn-ghost', onclick: () => m.close() }, 'Bekor qilish')));
  }

  // ---------- item bank ----------
  const IT = { meta: null, f: { lang: '', level: '', skill: '', status: '', q: '', page: 1 } };
  const STATUS_LABEL = { draft: 'qoralama', review: 'tekshiruvda', approved: 'tasdiqlangan', rejected: 'rad etilgan' };
  const SKILL_LABEL = { vocab: "Lug'at", grammar: 'Grammatika', reading: "O'qish", listening: 'Eshitish', writing: 'Yozish', speaking: 'Gapirish' };
  const statusTag = (st) => h('span', { class: `tag ${st}` }, STATUS_LABEL[st] || st);
  const snippet = (it) => { const p = it.payload; return String(p.question || p.statement || p.text || p.prompt || (p.pairs && p.pairs.map((x) => x.l).join(', ')) || '').slice(0, 90); };
  const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);

  async function pageItems(active) {
    IT.meta = IT.meta || await api('GET', '/api/admin/items/meta');
    const meta = IT.meta;
    const qs = new URLSearchParams(Object.entries(IT.f).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, String(v)]));
    const [sum, data] = await Promise.all([api('GET', '/api/admin/items/summary'), api('GET', `/api/admin/items?${qs}`)]);
    const cell = (lang, level) => {
      const rows = sum.rows.filter((r) => r.lang === lang.code && r.level === level);
      const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
      const total = rows.reduce((a, r) => a + r.n, 0), ok = by.approved || 0;
      const beyond = sum.levels.indexOf(level) > sum.levels.indexOf(lang.target);
      return h('td', { class: `cov-cell ${beyond ? 'beyond' : total ? (ok ? 'ok' : 'some') : 'empty'}`, title: `qoralama ${by.draft || 0} · tekshiruvda ${by.review || 0} · tasdiqlangan ${ok} · rad ${by.rejected || 0}`,
        onclick: () => { IT.f = { ...IT.f, lang: lang.code, level, page: 1 }; pageItems(active); } }, total ? `${ok}/${total}` : '—');
    };
    const matrix = h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl covmx' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Til (maqsad)'), sum.levels.map((l) => h('th', {}, l)))),
      h('tbody', {}, sum.langs.map((l) => h('tr', {}, h('td', {}, `${l.flag} ${l.name} → ${l.target}`), sum.levels.map((lv) => cell(l, lv)))))));

    const sel = (key, label, opts) => h('select', { class: 'sel', 'aria-label': label, onchange: (e) => { IT.f[key] = e.target.value; IT.f.page = 1; pageItems(active); } },
      h('option', { value: '' }, label), opts.map(([v, t]) => h('option', { value: v, selected: IT.f[key] === v }, t)));
    const search = h('input', { type: 'search', class: 't-input', placeholder: 'Savol matnidan qidirish…', value: IT.f.q, 'aria-label': 'Qidiruv' });
    let timer; search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { IT.f.q = search.value; IT.f.page = 1; pageItems(active); }, 350); });

    const rows = data.items.map((it) => h('tr', { class: 'click', onclick: () => itemModal(it, active) },
      h('td', { class: 'muted' }, `#${it.id}`), h('td', {}, it.lang.toUpperCase()), h('td', {}, h('span', { class: 'tag' }, it.level)), h('td', {}, SKILL_LABEL[it.skill] || it.skill),
      h('td', { class: 'muted' }, it.type), h('td', {}, statusTag(it.status), it.reports ? h('span', { class: 'tag ban', title: "O'quvchilar xato haqida xabar bergan", style: { marginLeft: '6px' } }, `⚑ ${it.reports}`) : null), h('td', {}, snippet(it)), h('td', { class: 'muted' }, it.author || '—')));

    shell(active, h('h1', {}, 'Savollar banki'),
      h('p', { class: 'lead' }, "Imtihon formatidagi savollar: qoralama → tekshiruv → tasdiqlash. Faqat tasdiqlangan savollar o'quvchilarga chiqariladi (keyingi sprintlarda). Maqsad: ingliz tili C2 gacha, qolganlari B2 gacha."),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn btn-main btn-sm', onclick: () => itemModal(null, active) }, '+ Savol qo\'shish'), h('button', { class: 'btn btn-ghost btn-sm', onclick: () => importModal(active) }, '⬆ Ommaviy import (JSON)'), S.me.isAdmin ? h('button', { class: 'btn btn-ghost btn-sm', onclick: guard(() => bundledModal()) }, '📦 Tayyor kontentni yuklash') : null),
      matrix, h('p', { class: 'muted' }, "Katakdagi son: tasdiqlangan/jami. Bosib shu til va daraja bo'yicha filtrlang."),
      h('div', { class: 'toolbar', style: { marginTop: '16px' } }, search,
        sel('lang', 'Til', meta.languages.map((l) => [l.code, `${l.flag} ${l.name}`])), sel('level', 'Daraja', meta.levels.map((x) => [x, x])),
        sel('skill', "Ko'nikma", meta.skills.map((x) => [x, SKILL_LABEL[x]])), sel('status', 'Holat', meta.statuses.map((x) => [x, STATUS_LABEL[x]])), sel('reported', 'Xabarlar', [['1', '⚑ Xato haqida xabar berilgan']]),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { IT.f = { lang: '', level: '', skill: '', status: '', q: '', page: 1 }; pageItems(active); } }, 'Tozalash')),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['ID', 'Til', 'Daraja', "Ko'nikma", 'Tur', 'Holat', 'Savol', 'Muallif'].map((x) => h('th', {}, x)))),
        h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: 8, class: 'center muted', style: { padding: '30px' } }, `Savollar yo'q (jami ${data.total})`))))),
      h('div', { class: 'pager' }, h('button', { class: 'btn btn-ghost btn-sm', disabled: data.page <= 1, onclick: () => { IT.f.page--; pageItems(active); } }, '← Oldingi'),
        h('span', {}, `${data.page} / ${data.pages} · jami ${data.total}`), h('button', { class: 'btn btn-ghost btn-sm', disabled: data.page >= data.pages, onclick: () => { IT.f.page++; pageItems(active); } }, 'Keyingi →')));
  }

  function itemModal(it, active) {
    const meta = IT.meta, isNew = !it;
    const m = modal();
    m.el.firstChild.style.maxWidth = '860px';
    const field = (label, el) => h('label', { class: 'field' }, h('span', {}, label), el);
    const select = (opts, value) => h('select', { class: 'sel', style: { width: '100%' } }, opts.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));
    const area = (value, rows = 3, ph = '') => h('textarea', { class: 't-input', rows, placeholder: ph, style: { width: '100%', fontSize: '.95rem', padding: '10px 12px' } }, value || '');
    const lang = select(meta.languages.map((l) => [l.code, `${l.flag} ${l.name}`]), it ? it.lang : (IT.f.lang || meta.languages[0].code));
    const level = select(meta.levels.map((x) => [x, x]), it ? it.level : (IT.f.level || 'B2'));
    const skill = select(meta.skills.map((x) => [x, SKILL_LABEL[x]]), it ? it.skill : (IT.f.skill || 'reading'));
    const exam = select(meta.exams.map((x) => [x, x]), it ? it.exam : 'general');
    const type = select([], '');
    const P = (it && it.payload) || {};
    const box = h('div');
    const fx = {};

    const typesFor = () => (skill.value === 'writing' ? ['essay_prompt'] : skill.value === 'speaking' ? ['speaking_prompt'] : meta.closedTypes);
    const refreshTypes = () => { const cur = it && typesFor().includes(it.type) && !type.dataset.touched ? it.type : type.value; type.replaceChildren(...typesFor().map((v) => h('option', { value: v, selected: v === cur }, v))); renderPayload(); };
    function renderPayload() {
      box.replaceChildren(); for (const k of Object.keys(fx)) delete fx[k];
      const t = type.value, g = (k, el) => { fx[k] = el; return el; };
      const parts = [];
      if (t === 'mcq') parts.push(field('Savol', g('question', area(P.question))), field('Variantlar (har qatorda bittadan, 2-6 ta)', g('options', area((P.options || []).join('\n'), 5))), field("To'g'ri javob raqami (1 dan boshlab)", g('answer', h('input', { type: 'number', min: 1, max: 6, class: 't-input', value: P.answer != null ? P.answer + 1 : 1, style: { padding: '8px 12px' } }))));
      if (t === 'gap') parts.push(field("Matn (bo'sh joy: ___)", g('text', area(P.text))), field("To'g'ri javob(lar) (har qatorda bittadan)", g('answers', area((P.answers || []).join('\n'), 2))));
      if (t === 'tf_ng') parts.push(field('Gap (tasdiq)', g('statement', area(P.statement, 2))), field('Javob', g('answer', select([['true', 'True'], ['false', 'False'], ['not_given', 'Not given']], P.answer || 'true'))));
      if (t === 'matching') parts.push(field("Juftliklar (har qatorda: chap | o'ng)", g('pairs', area((P.pairs || []).map((x) => `${x.l} | ${x.r}`).join('\n'), 5))));
      if (t === 'short') parts.push(field('Savol', g('question', area(P.question))), field("Qabul qilinadigan javob(lar) (har qatorda bittadan)", g('answers', area((P.answers || []).join('\n'), 2))));
      if (t === 'essay_prompt') parts.push(field('Topshiriq matni', g('prompt', area(P.prompt, 4))), field("Eng kam so'z soni", g('min_words', h('input', { type: 'number', min: 20, max: 1000, class: 't-input', value: P.min_words || 150, style: { padding: '8px 12px' } }))), field('Task (IELTS)', g('task', select([['', '—'], ['task1', 'Task 1'], ['task2', 'Task 2']], P.task || ''))));
      if (t === 'speaking_prompt') parts.push(field('Savol / topshiriq', g('prompt', area(P.prompt, 3))), field('Part (IELTS)', g('part', select([['', '—'], ['1', 'Part 1'], ['2', 'Part 2'], ['3', 'Part 3']], P.part ? String(P.part) : ''))), field('Tayyorlanish vaqti (soniya)', g('prep_seconds', h('input', { type: 'number', min: 0, max: 300, class: 't-input', value: P.prep_seconds != null ? P.prep_seconds : '', style: { padding: '8px 12px' } }))));
      parts.push(field("Matn / parcha (o'qish uchun, ixtiyoriy)", g('passage', area(P.passage, 4))), field('Eshitish matni (transcript, ixtiyoriy)', g('transcript', area(P.transcript, 3))),
        field('Audio havola (https://… yoki /audio/…)', g('audio_url', h('input', { class: 't-input', value: P.audio_url || '', style: { padding: '8px 12px' } }))), field("Tushuntirish (o'zbekcha, ixtiyoriy)", g('explanation_uz', area(P.explanation_uz, 2))));
      box.append(...parts);
    }
    function readPayload() {
      const t = type.value, v = (k) => fx[k].value, p = {};
      if (t === 'mcq') { p.question = v('question'); p.options = lines(v('options')); p.answer = Number(v('answer')) - 1; }
      if (t === 'gap') { p.text = v('text'); p.answers = lines(v('answers')); }
      if (t === 'tf_ng') { p.statement = v('statement'); p.answer = v('answer'); }
      if (t === 'matching') p.pairs = lines(v('pairs')).map((x) => { const [l, ...r] = x.split('|'); return { l: (l || '').trim(), r: r.join('|').trim() }; });
      if (t === 'short') { p.question = v('question'); p.answers = lines(v('answers')); }
      if (t === 'essay_prompt') { p.prompt = v('prompt'); p.min_words = Number(v('min_words')) || 150; if (v('task')) p.task = v('task'); }
      if (t === 'speaking_prompt') { p.prompt = v('prompt'); if (v('part')) p.part = Number(v('part')); if (v('prep_seconds') !== '') p.prep_seconds = Number(v('prep_seconds')); }
      for (const k of ['passage', 'transcript', 'audio_url', 'explanation_uz']) if (v(k).trim()) p[k] = v(k).trim();
      return p;
    }
    type.addEventListener('change', () => { type.dataset.touched = '1'; renderPayload(); });
    skill.addEventListener('change', () => { type.dataset.touched = ''; refreshTypes(); });
    refreshTypes();
    if (it) type.value = it.type;

    const done = (msg) => { m.close(); toast(msg || 'Saqlandi ✓'); route(); };
    const save = guard(async () => {
      const body = { lang: lang.value, level: level.value, skill: skill.value, exam: exam.value, type: type.value, payload: readPayload() };
      if (isNew) await api('POST', '/api/admin/items', body); else await api('PATCH', `/api/admin/items/${it.id}`, body);
      done();
    });
    const note = h('input', { class: 't-input', placeholder: 'Izoh (rad etishda majburiy)', value: it && it.reviewNote ? it.reviewNote : '', style: { padding: '8px 12px', flex: 1, minWidth: '180px' } });
    const move = (to, label, cls = 'btn-ghost') => h('button', { class: `btn btn-sm ${cls}`, onclick: guard(async () => { await api('POST', `/api/admin/items/${it.id}/status`, { status: to, note: note.value }); done('Holat yangilandi ✓'); }) }, label);
    const own = it && IT.meta.role === 'reviewer' && it.authorId === S.me.id;
    const flow = !it ? null : h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } }, h('b', {}, 'Holat:'), statusTag(it.status), it.reviewNote ? h('span', { class: 'muted' }, `Izoh: ${it.reviewNote}`) : null),
      h('div', { class: 'row-actions', style: { marginTop: '10px', alignItems: 'center' } }, note,
        it.status === 'draft' ? move('review', 'Tekshiruvga yuborish', 'btn-main') : null,
        it.status === 'review' && !own ? move('approved', '✓ Tasdiqlash', 'btn-main') : null,
        it.status === 'review' && !own ? move('rejected', '✕ Rad etish', 'btn-danger') : null,
        it.status === 'review' ? move('draft', 'Qoralamaga qaytarish') : null,
        it.status === 'approved' ? move('draft', 'Qoralamaga qaytarish') : null,
        it.status === 'rejected' ? move('review', 'Qayta tekshiruvga') : null,
        it.status === 'rejected' ? move('draft', 'Qoralamaga qaytarish') : null),
      own && it.status === 'review' ? h('p', { class: 'muted' }, "Bu sizning savolingiz: uni boshqa tekshiruvchi yoki admin tasdiqlaydi.") : null);

    const reportsBox = h('div');
    m.el.firstChild.replaceChildren(h('h2', {}, isNew ? 'Yangi savol' : `Savol #${it.id}`),
      h('div', { class: 'form-grid' }, field('Til', lang), field('Daraja (CEFR)', level), field("Ko'nikma", skill), field('Imtihon formati', exam)),
      field('Savol turi', type), box,
      it && it.status === 'approved' ? h('p', { class: 'muted' }, "Diqqat: tasdiqlangan savolni tahrirlasangiz, u qoralamaga qaytadi va qayta tekshiriladi.") : null,
      h('div', { style: { display: 'flex', gap: '10px', marginTop: '10px', flexWrap: 'wrap' } }, h('button', { class: 'btn btn-main', onclick: save }, 'Saqlash'),
        !isNew ? h('button', { class: 'btn btn-danger', onclick: guard(async () => { if (!confirm(`#${it.id} savol o'chirilsinmi?`)) return; await api('DELETE', `/api/admin/items/${it.id}`); done("O'chirildi"); }) }, "O'chirish") : null,
        h('button', { class: 'btn btn-ghost', onclick: () => m.close() }, 'Yopish')),
      flow,
      reportsBox);
    if (it && it.reports) {
      api('GET', `/api/admin/items/${it.id}`).then((d) => {
        const REASON = { wrong_answer: "Javob noto'g'ri", unclear: 'Savol tushunarsiz', typo: 'Imlo/grammatika xatosi', other: 'Boshqa' };
        const open = d.reports.filter((r) => r.status === 'open');
        reportsBox.replaceChildren(h('h3', { style: { margin: '0 0 8px' } }, `⚑ O'quvchilar xabarlari (${open.length})`),
          d.reports.map((r) => h('div', { style: { padding: '8px 10px', borderRadius: '10px', background: 'var(--soft)', margin: '6px 0', opacity: r.status === 'open' ? 1 : 0.5 } },
            h('b', {}, REASON[r.reason] || r.reason), r.note ? ` — ${r.note}` : '', h('span', { class: 'muted' }, ` · ${r.by} · ${new Date(r.createdAt).toLocaleDateString()}${r.status === 'open' ? '' : ' (yopilgan)'}`))),
          open.length ? h('button', { class: 'btn btn-ghost btn-sm', onclick: guard(async () => { await api('POST', `/api/admin/items/${it.id}/reports/resolve`, {}); toast('Xabarlar yopildi'); m.close(); route(); }) }, '✓ Hammasini ko\'rib chiqdim') : null);
        reportsBox.className = 'card'; reportsBox.style.marginTop = '14px';
      }).catch(() => {});
    }
  }

  async function bundledModal() {
    const info = await api('GET', '/api/admin/items/bundled');
    const m = modal();
    m.el.firstChild.style.maxWidth = '720px';
    const p = info.preview;
    const run = guard(async () => {
      const r = await api('POST', '/api/admin/items/import-bundled', {});
      toast(`${r.created} ta qoralama qo'shildi`); m.close(); route();
    });
    m.el.firstChild.replaceChildren(h('h2', {}, '📦 Tayyor kontent (AI qoralamalari)'),
      h('p', { class: 'muted' }, "Ilova bilan birga kelgan savollar qoralama holatida qo'shiladi. Ular AI yozgan va tekshirgan: ona tilida so'zlashuvchi tekshiruvchi tasdiqlamaguncha o'quvchilarga ko'rinmaydi. Qayta bosish xavfsiz (takrorlar o'tkazib yuboriladi)."),
      p ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, ['Fayl', 'Yangi', 'Takror', 'Xato'].map((x) => h('th', {}, x)))),
        h('tbody', {}, p.files.map((f) => h('tr', {}, h('td', {}, f.file), h('td', {}, f.created), h('td', {}, f.duplicates), h('td', {}, f.failed)))))) : h('p', {}, 'Fayllar topilmadi.'),
      p ? h('p', {}, h('b', {}, `Jami yangi: ${p.created}`), ` · takror: ${p.duplicates} · xato: ${p.failed}`) : null,
      h('div', { style: { display: 'flex', gap: '10px', marginTop: '12px' } },
        h('button', { class: 'btn btn-main', disabled: !p || !p.created, onclick: run }, `${p ? p.created : 0} ta qoralamani qo'shish`),
        h('button', { class: 'btn btn-ghost', onclick: () => m.close() }, 'Yopish')));
  }

  function importModal(active) {
    const meta = IT.meta;
    const m = modal();
    m.el.firstChild.style.maxWidth = '860px';
    const sel = (opts, def) => h('select', { class: 'sel', style: { width: '100%' } }, h('option', { value: '' }, def), opts.map(([v, t]) => h('option', { value: v }, t)));
    const lang = sel(meta.languages.map((l) => [l.code, `${l.flag} ${l.name}`]), 'Til (hammasi uchun)');
    const level = sel(meta.levels.map((x) => [x, x]), 'Daraja (hammasi uchun)');
    const skill = sel(meta.skills.map((x) => [x, SKILL_LABEL[x]]), "Ko'nikma (hammasi uchun)");
    const type = sel(meta.types.map((x) => [x, x]), 'Tur (hammasi uchun)');
    const exam = sel(meta.exams.map((x) => [x, x]), 'Imtihon (hammasi uchun)');
    const text = h('textarea', { class: 't-input', rows: 12, placeholder: '[ { "payload": { "question": "...", "options": ["A","B","C"], "answer": 1 } }, … ]', style: { width: '100%', fontFamily: 'monospace', fontSize: '.85rem', padding: '10px 12px' } });
    const out = h('div');
    const sample = () => { text.value = JSON.stringify([
      { lang: 'en', skill: 'reading', level: 'B2', exam: 'ielts', type: 'mcq', payload: { question: 'What is the writer\'s main purpose?', options: ['To inform', 'To persuade', 'To entertain'], answer: 1, passage: 'Paste the passage here…', explanation_uz: 'Muallif o\'quvchini ishontirmoqchi.' } },
      { lang: 'en', skill: 'grammar', level: 'B1', type: 'gap', payload: { text: 'If I ___ rich, I would travel more.', answers: ['were', 'was'] } },
    ], null, 2); };
    const run = (dryRun) => guard(async () => {
      let items; try { items = JSON.parse(text.value); } catch { throw new Error("JSON noto'g'ri: massiv [ … ] kerak"); }
      const defaults = Object.fromEntries([['lang', lang], ['level', level], ['skill', skill], ['type', type], ['exam', exam]].filter(([, el]) => el.value).map(([k, el]) => [k, el.value]));
      const r = await api('POST', '/api/admin/items/import', { items, defaults, dryRun });
      out.replaceChildren(h('div', { class: 'card', style: { marginTop: '12px' } },
        h('b', {}, dryRun ? `Tekshiruv: ${r.valid} ta to'g'ri, ${r.failed} ta xato` : `Import: ${r.created} ta qoralama qo'shildi, ${r.failed} ta xato`),
        r.errors.length ? h('div', { class: 'mini-list' }, r.errors.map((e) => h('div', {}, `#${e.index + 1}: ${e.error}`))) : null));
      if (!dryRun && r.created) { toast('Import tugadi ✓'); route(); }
    });
    m.el.firstChild.replaceChildren(h('h2', {}, 'Ommaviy import (JSON)'),
      h('p', { class: 'muted' }, "Savollar qoralama holatida qo'shiladi va tekshiruvchi tasdiqlagandan keyingina ishlatiladi. Bir martada 500 tagacha. Yuqoridagi tanlovlar har bir savoldagi bo'sh maydonlarni to'ldiradi."),
      h('div', { class: 'form-grid' }, lang, level, skill, type, exam), h('div', { style: { height: '10px' } }), text, out,
      h('div', { style: { display: 'flex', gap: '10px', marginTop: '12px', flexWrap: 'wrap' } }, h('button', { class: 'btn btn-ghost', onclick: sample }, 'Namuna'), h('button', { class: 'btn btn-ghost', onclick: run(true) }, 'Tekshirish'), h('button', { class: 'btn btn-main', onclick: run(false) }, 'Import qilish'), h('button', { class: 'btn btn-ghost', onclick: () => m.close() }, 'Yopish')));
  }

  async function boot() {
    try { S.me = (await api('GET', '/api/me')).user; } catch { S.me = null; LS.remove('lf_token'); }
    if (!S.me) return renderLogin();
    if (!S.me.isStaff) {
      return mount(h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' }, h('h1', {}, 'Ruxsat yo\'q'), h('p', { class: 'sub' }, `${S.me.email} hisobi admin yoki tekshiruvchi emas.`),
        h('a', { class: 'btn btn-main btn-block', href: '/app' }, 'Ilovaga qaytish'), h('button', { class: 'btn btn-ghost btn-block', style: { marginTop: '10px' }, onclick: async () => { LS.remove('lf_token'); try { await api('POST', '/api/auth/logout', {}); } catch {} renderLogin(); } }, 'Boshqa hisob bilan kirish'))));
    }
    if (!location.hash) location.hash = S.me.isAdmin ? '#/dashboard' : '#/items';
    route();
  }
  boot();
})();
