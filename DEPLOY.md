# Internetga chiqarish

Sayt Node.js 22.5+ serveri (SQLite bazasi bilan) — GitHub Pages / Netlify / Vercel (statik) mos emas.
Baza `DATA_DIR` papkasida saqlanadi, shuning uchun u **doimiy diskda** bo'lishi shart.

## Variant 1: Render (eng oson)
1. render.com → New → **Blueprint** → shu reponi tanlang (`render.yaml` o'qiladi).
2. `ADMIN_EMAILS` ga o'z emailingizni yozing, AI ustoz kerak bo'lsa `GEMINI_API_KEY` ni qo'shing.
3. Deploy tugagach, **birinchi bo'lib** o'sha email bilan ro'yxatdan o'ting — siz admin bo'lasiz. Admin panelga kirish: saytda **Ctrl+Shift+A** ni bosing (yoki `/admin` manziliga o'ting).
> Render'ning bepul rejasida disk doimiy emas (har yangilashda baza o'chadi). `starter` rejada 1 GB disk biriktirilgan.

## Variant 2: Railway
1. New Project → Deploy from GitHub repo (`Dockerfile` avtomatik topiladi).
2. Variables: `ADMIN_EMAILS`, `GEMINI_API_KEY`, `SESSION_SECRET` (uzun tasodifiy matn), `DATA_DIR=/data`.
3. Volume qo'shing va `/data` ga ulang. Domain: Settings → Networking → Generate Domain.

## Variant 3: o'z serveri (VPS)
```bash
docker build -t linguaflow .
docker run -d --name linguaflow -p 3000:3000 -v linguaflow-data:/data \
  -e SESSION_SECRET=$(openssl rand -hex 32) -e ADMIN_EMAILS=siz@example.com \
  -e GEMINI_API_KEY=... --restart unless-stopped linguaflow
```
Oldiga HTTPS beradigan proksi (Caddy/nginx) qo'ying. `TRUST_PROXY=1` shunda to'g'ri IP ni ko'radi.

## Tekshiruv ro'yxati
- [ ] `ADMIN_EMAILS` o'rnatilgan va birinchi hisobni o'zingiz yaratdingiz
- [ ] Baza doimiy diskda (`DATA_DIR`), zaxira nusxasi rejalashtirilgan (`linguaflow.db` + `.secret`)
- [ ] HTTPS yoqilgan (cookie `Secure` bo'lishi uchun proksi `X-Forwarded-Proto: https` yuborishi kerak)
- [ ] `RECOVERY_KEY` o'rnatilgan (parol tiklash uchun maxfiy kalit, kamida 12 belgi) va xavfsiz joyda saqlanadi
- [ ] **AI Studio'ning "GitHub'ga commit" tugmasini `main` ga ishlatmang**: u kodni (xavfsizlik tuzatishlarini ham) o'zining nusxasi bilan ustidan yozib yuboradi. O'zgarishlarni alohida branchga yuboring va PR orqali ko'rib chiqing
- [ ] Parol unutilsa: admin panel → foydalanuvchi → yangi parol (yoki `npm run reset-password -- email yangiparol`)
