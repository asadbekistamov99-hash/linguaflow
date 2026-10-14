# Pilot (sinov) rejasi

Maqsad: 10–30 haqiqiy o'quvchi bilan 2–3 hafta sinash va xatolar/qiyinliklarni topish.

## 0. Tayyorgarlik (bir marta)
- [ ] Hosting: Render (starter + disk) yoki VPS. `DEPLOY.md` ga qarang. Disk/doimiy xotira bo'lishi shart.
- [ ] Muhit: `RECOVERY_KEY` (12+ belgi), `ADMIN_EMAILS`, `CONTACT_EMAIL`, `GEMINI_API_KEY` (yangi kalit!), `AI_PROVIDER=gemini`.
- [ ] Birinchi bo'lib o'zingiz ro'yxatdan o'ting (admin bo'lasiz). `/api/health` → `ok`.
- [ ] Admin → Savollar banki → "📦 Tayyor kontentni yuklash".
- [ ] Har til uchun ona tilida so'zlashuvchi tekshiruvchi: rol "reviewer" + til biriktirish.
- [ ] Tekshiruvchilar kamida A2/B1 lug'at mavzularini va ~100 ta savolni ko'rib tasdiqlaydi; so'ng Kontent → daraja bo'yicha yoqish.
- [ ] Admin → Sozlamalar → "Tizim holati": AI ✅, zaxira nusxa ✅ (30 soniyadan keyin).

## 1. Birinchi kun sinovi (o'zingiz, telefonda)
- [ ] Ro'yxatdan o'tish → til tanlash → birinchi dars → test → takrorlash.
- [ ] Eshitish mashqi: ovoz chiqyaptimi? (har til uchun, Android va iPhone'da). Ovoz bo'lmasa ogohlantirish chiqishi kerak.
- [ ] Mashq → Yozish: bitta insho yuboring. Baho mantiqiymi? (haqiqiy AI sinovi)
- [ ] Mashq → Gapirish: mikrofonga ruxsat, matnga aylanishi, baho.
- [ ] Mock imtihon: boshlash → topshirish → natija.
- [ ] Profil → Hisobni o'chirish (sinov hisobida).

## 2. Pilot o'quvchilar
- 10–30 kishi, turli telefonlar. Havola + qisqa tushuntirish: "bu sinov, xatolarni yozing".
- Har kuni: Admin → Sozlamalar (faol foydalanuvchilar, AI sarfi), Dashboard.
- Savol: nima tushunarsiz? qaysi mashq qiyin/oson? qayerda xato bor? Tekshiruvchilar bilan xato savollarni tuzating (admin paneldan tahrirlash).

## 3. Qaror nuqtalari
- AI limitlari: sarf juda katta bo'lsa Sozlamalar → AI limitlarini kamaytiring.
- Kontent: tekshiruvchilar rad etgan savollar soni va sabablari.
- Pilotdan keyin: domen, VPS, ommaviy e'lon.
