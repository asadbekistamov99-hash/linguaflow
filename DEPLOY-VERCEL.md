# Vercel'da ishga tushirish (DEMO rejimi)

> **Muhim:** Vercel'da doimiy disk yo'q. Bu rejim saytni **ko'rsatish va sinash** uchun. Ro'yxatdan o'tgan foydalanuvchilar va progress
> server qayta ishga tushganda (har deploydan keyin, noaktivlikdan keyin yoki boshqa nusxaga o'tganda) **yo'qolishi mumkin**.
> Haqiqiy o'quvchilar uchun `DEPLOY.md` (Render yoki VPS) ni ishlating.

## Sozlash
1. Vercel → loyiha → **Settings → General → Node.js Version = 22.x** (node:sqlite uchun 22.5+ kerak).
2. **Framework Preset = Other**, Build Command va Output Directory bo'sh qoldiring.
3. **Settings → Environment Variables** (hammasi Production uchun):

| O'zgaruvchi | Qiymat |
|---|---|
| `SESSION_SECRET` | **Majburiy.** Tasodifiy 32+ belgi (masalan, parol generatoridan). Bo'lmasa, kirish nusxalar orasida buziladi. |
| `ADMIN_EMAILS` | O'zingizning emailingiz. Shu email bilan ro'yxatdan o'tsangiz, admin bo'lasiz (`/admin`). |
| `GEMINI_API_KEY` | Ixtiyoriy: haqiqiy AI baholashni sinash uchun. **Yangi** kalit, hech kimga yubormang. |
| `AI_PROVIDER` | `gemini` |
| `CONTACT_EMAIL` | Maxfiylik sahifasida ko'rinadigan email |
| `DEMO_MODE` | Bo'sh qoldiring (yoqilgan). `0` qo'ysangiz demo kontent yuklanmaydi. |

4. **Deployments → Redeploy** (yoki `main` ga yangi commit push qiling).

## Nima ishlaydi
- Demo kontent avtomatik yuklanadi: 80 mavzu va ~1500 savol tasdiqlangan holda, hamma mashq ekrani sinab ko'riladi.
- Ilova tepasida "Demo rejimi" ogohlantirishi chiqadi.
- Birinchi ro'yxatdan o'tgan odam admin **bo'lmaydi** (adminlik AI limitlarini chetlab o'tadi): faqat `ADMIN_EMAILS` dagilar.

## Cheklovlar
- Ma'lumot yo'qolishi (yuqoriga qarang). Kirgan foydalanuvchi keyingi so'rovda chiqib ketgan bo'lishi mumkin: shunda qayta kiring.
- Zaxira nusxa ishlamaydi.
- Har "sovuq ishga tushish"da baza qayta yaratiladi (~1 soniya).
