# LinguaFlow

Ingliz, rus, nemis, fransuz, ispan va arab tillarini o'rgatuvchi platforma (interfeys o'zbek tilida).
**Tashqi paketlarsiz**: faqat Node.js 22.5+ (`http`, `node:sqlite`, `crypto`).

## Ishga tushirish

```bash
cp .env.example .env     # ixtiyoriy: AI kalitlari, admin emaillari
npm start                # http://localhost:3000
npm test                 # backend testlari
```

- Sayt: `http://localhost:3000` · Ilova: `/app` · **Admin panel: `/admin`**
- **Birinchi ro'yxatdan o'tgan hisob avtomatik admin bo'ladi** (yangi o'rnatishda). O'chirish: `FIRST_USER_ADMIN=0`.
- Boshqa odamni admin qilish: `.env` da `ADMIN_EMAILS=a@x.uz,b@y.uz` yoki
  `npm run make-admin -- user@example.com` (olib tashlash: `--remove`).

## Sozlamalar (env / `.env`)

| O'zgaruvchi | Tavsif |
|---|---|
| `PORT`, `DATA_DIR` | port; baza va maxfiy kalit saqlanadigan papka (standart `./data`) |
| `SESSION_SECRET` | cookie imzosi uchun (bo'lmasa `data/.secret` yaratiladi) |
| `TZ_OFFSET_HOURS` | kun chegarasi (standart 5 = O'zbekiston) |
| `AI_PROVIDER`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `TUTOR_MODEL` | AI ustoz (kalit bo'lmasa o'chiq) |
| `ADMIN_EMAILS`, `FIRST_USER_ADMIN` | admin tayinlash |
| `GOOGLE_CLIENT_ID` | Google orqali kirish (`GOOGLE-LOGIN.md`) |
| `CONTACT_EMAIL` | `/privacy` va `/terms` sahifalarida ko'rsatiladigan aloqa emaili |
| `BACKUP_ENABLED` (`0` = o'chirish), `BACKUP_EVERY_HOURS` (24), `BACKUP_KEEP` (7) | kunlik zaxira nusxa: `DATA_DIR/backups/` |

## Imkoniyatlar

**O'quvchi uchun**
- 6 til × 20 faol mavzu (A1) × 200 so'z/ibora, 120 jumla; har tilda 40 dars + 20 mavzu testi. Qo'shimcha **40 ta A2/B1 mavzu** (har tilda 400 so'z, 240 jumla) tayyor, lekin tekshiruvchilar tasdiqlamaguncha **yashirin**
- Mashqlar kontentdan avtomatik yaratiladi: tanishtiruv, test, eshitib topish (brauzer ovozi), yozish, juftlarni topish, **jumla tuzish**
- **Mavzu testlari** (80% dan o'tish, toj), **daraja testi** (biladigan mavzularni o'tkazib yuborish)
- **4 ta o'yin**: Xotira, Blitz, So'z tuzish, Jumla quruvchi (kunlik XP limiti, haftalik reyting)
- Aqlli takrorlash (SM-2 ga o'xshash), lug'at (qidiruv, ovoz, mustahkamlik ko'rsatkichi)
- XP, daraja, kunlik seriya, kunlik maqsad, 15 ta nishon, haftalik reyting
- AI ustoz, tungi/kunduzgi tema, PWA (telefonga o'rnatish mumkin)

**Admin panel (`/admin`)**
- Boshqaruv: foydalanuvchilar, faollik, XP, ro'yxatdan o'tish grafiklari (14 kun), tillar va o'yinlar statistikasi
- Foydalanuvchilar: qidiruv, saralash, tafsilot, admin qilish, bloklash, progress/XP tozalash, o'chirish
- **Kontent muharriri**: mavzu/so'z/jumla qo'shish, tahrirlash, tartiblash, o'chirish; yangi til qo'shish;
  jadvalda katakni o'zgartirsangiz avtomatik saqlanadi va darhol saytda ko'rinadi; JSON eksport
- E'lon banneri (ilova tepasida), audit jurnali

## Tuzilma

```
server.js            kirish nuqtasi (.env ni o'qiydi)
src/app.js           API: auth, darslar, sessiyalar, testlar, takrorlash, lug'at, statik fayllar
src/games.js         o'yinlar API (natijani tekshirish, XP limiti, reyting)
src/admin.js         admin API
src/content.js       kontent (bazadan) va darslar tuzilishi
src/exercises.js     mashq generatori va tekshiruvchi
src/srs.js           takrorlash rejalashtiruvchisi
src/tutor.js         AI ustoz (Gemini / OpenAI / Claude)
src/db.js, auth.js   SQLite sxemasi + boshlang'ich kontent, autentifikatsiya
src/seed/            boshlang'ich kontent (birinchi ishga tushishda bazaga yoziladi)
public/              landing, ilova (app.*), admin (admin.*)
scripts/             make-admin, validate-seed
test/                API testlari
```

Kontent birinchi ishga tushganda `src/seed/` dan bazaga ko'chadi, shundan keyin **admin paneldan** boshqariladi
(seed fayllarini o'zgartirish mavjud bazaga ta'sir qilmaydi).

## Xavfsizlik eslatmalari

- Parollar scrypt bilan, sessiya imzolangan `httpOnly` cookie; barcha POST/PATCH/DELETE faqat JSON qabul qiladi (CSRF himoyasi)
- To'g'ri javoblar mijozga yuborilmaydi; o'yin natijalari server tomonda tekshiriladi va XP cheklangan
- Productionda HTTPS orqasida ishlating (proksi `X-Forwarded-Proto: https` yuborsa cookie `Secure` bo'ladi)
- `data/` papkasini zaxiralang (baza + `.secret`)

## Sertifikatlar haqida (muhim)

LinguaFlow bergan sertifikat **ichki tayyorgarlik sertifikati**: u rasmiy IELTS, TOEFL, CEFR, Goethe, DELF, DELE, TORFL va boshqa
xalqaro imtihon sertifikati emas. Ballar (masalan "IELTS taxminiy 6.5") faqat taxminiy ko'rsatkich. Ilovadagi barcha matnlar shunga mos yozilgan.

## Savollar banki, tekshiruvchilar va AI limitlari (admin panel)

- **Savollar banki** (`/admin` → Savollar banki): imtihon formatidagi savollar til, CEFR darajasi (A1–C2), ko'nikma
  (lug'at, grammatika, o'qish, eshitish, yozish, gapirish) va imtihon formati bo'yicha belgilanadi.
  Turlar: `mcq`, `gap`, `tf_ng`, `matching`, `short`, `essay_prompt`, `speaking_prompt`. Qamrov jadvali maqsadga nisbatan
  nima yetishmayotganini ko'rsatadi (ingliz tili C2 gacha, qolgan tillar B2 gacha).
- **Tekshiruv oqimi:** qoralama → tekshiruvda → tasdiqlangan / rad etilgan. Tasdiqlangan savol tahrirlansa, qayta qoralamaga qaytadi.
  Tekshiruvchi o'z savolini o'zi tasdiqlay olmaydi. **Tekshiruvchi** rolini admin Foydalanuvchilar bo'limida beradi va tillarni tanlaydi;
  tekshiruvchi faqat o'sha tillardagi savollarni ko'radi (boshqa admin sahifalariga kira olmaydi).
- **Ommaviy import:** JSON massiv (bir martada 500 tagacha), avval "Tekshirish" (dry run), so'ng "Import qilish". Hammasi qoralama bo'lib tushadi.
- **AI limitlari (bepul rejim):** Sozlamalar → AI limitlari. Har foydalanuvchiga kunlik chegara: AI ustoz, yozishni tekshirish, gapirish
  (0 = o'chirilgan; adminlarga qo'llanmaydi). Bugungi foydalanish va eng faol foydalanuvchilar ko'rinadi.

## A2–B1 kontent va grammatika (Sprint 2)

- **Mavzular darajasi:** har mavzuning `level` maydoni bor (A1/A2/B1...). Yangi (A2/B1) mavzular bazaga **o'chirilgan holda** qo'shiladi;
  mavjud bazalar ham ishga tushganda avtomatik yangilanadi (`settings.seed_units_applied`), admin o'chirgan mavzu qayta tiklanmaydi.
- **Nashr qilish:** Admin → Kontent → "A2: hammasini yoqish" (yoki mavzuni alohida yoqish). Avval ona tilida so'zlashuvchi tekshiruvchi
  tarjimalarni ko'rib chiqishi kerak: kontentning AI qoralamasi, tekshirilmagan.
- **Grammatika savollari:** `content/items/<til>_<daraja>_grammar.json` (har fayl ~40 ta `gap`/`mcq`, `explanation_uz` bilan).
  Bazaga qoralama sifatida yuklash: `npm run import-items -- --dry-run content/items/*.json`, so'ng `--dry-run`siz.
  Qayta ishga tushirish xavfsiz (takrorlar o'tkazib yuboriladi). Savollar **Savollar banki**da tekshiruvchi tasdiqlashini kutadi.
- Kontent tekshiruvi: `npm run validate-seed`.

## Imtihon mashqlari (Sprint 3)

- **Mashq** bo'limi (`/app#/practice`): o'qish, eshitish, grammatika, lug'at. Faqat Savollar bankida **tasdiqlangan** (`approved`) savollar
  ko'rsatiladi; to'g'ri javob javob berilgandan keyingina serverdan keladi. Eshitish matni brauzer ovozi bilan o'qiladi.
  Kuniga mashqdan 60 XP gacha (`practice:*`).
- API: `GET /api/practice/summary`, `POST /api/practice/start`, `POST /api/practice/:sid/answer`, `POST /api/practice/:sid/finish`.
- Kontent qoralamalari: `content/items/<til>_B1B2_reading_listening.json` (har tilda 56 ta o'qish/eshitish savoli, B1 va B2).
  `npm run import-items` bilan yuklang, so'ng tekshiruvchi tasdiqlaydi.

## Yozish, gapirish va mock imtihon (Sprint 4)

- **Yozish** (`#/writing`) va **Gapirish** (`#/speaking`): AI ustoz 4 mezon bo'yicha 0–5 ball, taxminiy CEFR darajasi va tuzatishlar beradi
  (`src/grading.js`; AI javobi qat'iy JSON sifatida tekshiriladi va chegaralanadi). Mavzular Savollar bankidagi **tasdiqlangan**
  `essay_prompt` / `speaking_prompt` savollaridan, yoki o'quvchi o'z mavzusini yozadi. Kunlik AI limiti (`writing`, `speaking`) qo'llanadi;
  kalit sozlanmagan bo'lsa 503 qaytadi va limit sarflanmaydi.
- Gapirishda ovoz brauzerda matnga aylantiriladi (Web Speech API; brauzer ovozni tashqi xizmatga yuborishi mumkin). **Talaffuz baholanmaydi**,
  faqat matn (ravonlik, bog'liqlik, lug'at, grammatika). Natijalar `skill_submissions` jadvalida, tarix: `GET /api/skills/history`.
- **Mock imtihon** (`#/mock`): tanlangan daraja uchun tasdiqlangan grammatika/o'qish/eshitish savollaridan vaqtli imtihon, server tomonda baholanadi
  (70%+ "tayyor", 50%+ "yaqin"). Natijalar `mock_results`. Barcha ballar taxminiy, rasmiy imtihon natijasi emas.
- Kontent qoralamalari: `content/items/<til>_writing_speaking.json` (A2/B1/B2, har tilda 24 ta).

## Ingliz tili C1–C2 (Sprint 5)

- `content/items/en_C1_*.json`, `en_C2_*.json`, `en_C1C2_writing_speaking.json`: grammatika, lug'at (kontekstda), o'qish, eshitish, yozish (IELTS Task 2 uslubi) va gapirish
  (Part 1–3) savollari, jami 304 ta. Mustaqil AI tekshiruvidan o'tgan, lekin **ona tilida so'zlashuvchi tekshiruvchi tasdiqlashi shart**.
- Mock imtihon endi C2 darajasini ham, lug'at bo'limini ham qamraydi. Ingliz tilida B2+ darajada natijaga **taxminiy IELTS-uslubidagi ball**
  (0–9) qo'shiladi (IELTS Listening/Reading jadvaliga o'xshash, rasmiy emas).

## Tayyor kontentni admin paneldan yuklash (Sprint 6)

Serverga kirib `npm run import-items` ishlatish shart emas: **Admin → Savollar banki → "📦 Tayyor kontentni yuklash"**
`content/items/*.json` dagi barcha qoralamalarni (hozir ~1500 ta savol) ko'rsatadi va bir tugma bilan qo'shadi.
Faqat adminlar uchun; hammasi `draft` (manba `ai`) bo'lib tushadi; qayta bosish xavfsiz. Dockerfile `content/` papkasini ham nusxalaydi.

## Ishga tushirishga tayyorgarlik (Sprint 7)

- **Zaxira nusxa:** server har 24 soatda `DATA_DIR/backups/` ga SQLite nusxasini oladi (oxirgi 7 tasi saqlanadi). Qo'lda: `npm run backup`.
  Nusxani serverdan tashqariga ham ko'chirib turing (masalan, haftada bir marta o'z kompyuteringizga). Tiklash: serverni to'xtatib, nusxani `linguaflow.db` o'rniga qo'ying.
- **Tizim holati:** Admin → Sozlamalar (AI yoqilganmi, oxirgi zaxira nusxa, baza hajmi, foydalanuvchilar soni).
- **Maxfiylik:** `/privacy` va `/terms` sahifalari (namuna: yurist ko'rib chiqsin), foydalanuvchi hisobini o'zi o'chira oladi (Profil), sessiya faqat httpOnly cookie'da.
- **Landing** sahifasi haqiqiy imkoniyatlarga moslab yozilgan (6 til, bepul, rasmiy sertifikat emas).
- **B2 kontent:** 20 ta B2 lug'at mavzusi (yashirin, A2/B1 kabi yoqiladi) va 6 tilda B2 grammatika qoralamalari.
- Pilot ro'yxati: `PILOT.md`.
