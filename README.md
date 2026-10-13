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
| `AI_PROVIDER`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `TUTOR_MODEL` | AI ustoz (kalit bo'lmasa o'chiq) |
| `ADMIN_EMAILS`, `FIRST_USER_ADMIN` | admin tayinlash |

## Imkoniyatlar

**O'quvchi uchun**
- 6 til × 20 mavzu × 200 so'z/ibora, 120 jumla; har tilda 40 dars + 20 mavzu testi
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
