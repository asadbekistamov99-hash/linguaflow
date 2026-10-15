# Google orqali kirish

Foydalanuvchi "Google bilan davom etish" tugmasini bosadi, Google emailni tasdiqlaydi, ilova hisobni o'zi yaratadi (parol kerak emas).
Email/parol bilan kirish ham ishlayveradi. Google sozlanmagan bo'lsa, tugma ko'rinmaydi.

> Google kirish **progress saqlanishini hal qilmaydi**: hisob va natijalar baribir ilovaning bazasida turadi.
> Baza yo'qoladigan hostingda (masalan, Vercel demo) Google bilan kirsangiz ham profil bo'sh bo'lib qoladi.

## Sozlash (bir marta, bepul, karta kerak emas)
1. https://console.cloud.google.com ga Google hisobingiz bilan kiring. **Yangi loyiha** yarating (nomi: LinguaFlow).
2. **APIs & Services → OAuth consent screen**: User type **External** → app name `LinguaFlow`, support email va developer email (o'zingizniki) → Save.
   Scopes: `openid`, `email`, `profile` (standart). Holat "Testing" bo'lsa, faqat **Test users** ro'yxatidagilar kira oladi:
   hamma kira olishi uchun **Publish app** (In production) bosing. Faqat shu 3 ta scope bo'lgani uchun Google tekshiruvi odatda talab qilinmaydi.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → Application type **Web application**.
   **Authorized JavaScript origins** ga saytingiz manzilini qo'shing, masalan `https://linguaflow-ecru.vercel.app` (va keyin domeningizni). Redirect URI kerak emas.
4. Yaratilgan **Client ID** ni (`...apps.googleusercontent.com`) nusxalang.
5. Hosting muhit o'zgaruvchisi: `GOOGLE_CLIENT_ID=<Client ID>` (Vercel: Settings → Environment Variables; Render/VPS: `.env`). Client ID maxfiy emas, lekin `GOOGLE_CLIENT_SECRET` kerak emas.
6. Qayta joylashtiring (redeploy).

## Xavfsizlik
- Token Google'ning `tokeninfo` xizmatida tekshiriladi: `aud` sizning Client ID ingiz, `iss` Google, email tasdiqlangan va muddati o'tmagan bo'lishi shart.
- Hisob email bo'yicha topiladi/yaratiladi. `ADMIN_EMAILS` dagi email Google orqali kirsa, admin bo'ladi (Google emailni tasdiqlagani uchun xavfsiz).
- Bloklangan hisoblar kira olmaydi. Google orqali yaratilgan hisobda parol yo'q; keyin parol kerak bo'lsa, "Parolni unutdingizmi?" / admin orqali o'rnatiladi.
