'use strict';
// DEMO ONLY: preloaded with `node --require explainer/ai-stub.js server.js`. Answers the Gemini endpoint with canned
// sample feedback so the explainer video can show the AI screens without a real key. Never used in production.
const real = global.fetch;
const json = (text) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });
global.fetch = async (url, opts) => {
  if (!String(url).includes('generativelanguage.googleapis.com')) return real(url, opts);
  const body = JSON.parse(opts.body);
  const system = body.systemInstruction.parts[0].text;
  await new Promise((r) => setTimeout(r, 1400)); // looks like real latency
  if (system.includes('writing examiner')) {
    return json(JSON.stringify({
      scores: { task: 4, coherence: 4, vocabulary: 3, grammar: 2 }, cefr: 'B1',
      summary_uz: "Matn vazifaga mos, fikrlar izchil joylashgan. Asosiy muammo: o'tgan zamon fe'llari. Lug'at o'rtacha, ko'proq sifat va bog'lovchilar qo'shing.",
      strengths_uz: ['Mavzu to\'liq yoritilgan', 'Boshlanish va yakun aniq'],
      fixes: [
        { original: 'I go to the market', better: 'I went to the market', why_uz: "O'tgan zamon: go → went" },
        { original: 'we buy fresh fruits and vegetables', better: 'we bought fresh fruit and vegetables', why_uz: "buy → bought; fruit sanalmaydi (ko'pincha)" },
        { original: 'for all family', better: 'for the whole family', why_uz: "'all family' emas, 'the whole family'" },
        { original: 'I meet my friends', better: 'I met my friends', why_uz: "O'tgan zamon: meet → met" },
      ],
      next_step_uz: "Shu matnni o'tgan zamonda qayta yozing va 5 ta yangi bog'lovchi (however, besides...) ishlating.",
    }));
  }
  if (system.includes('speaking examiner')) {
    return json(JSON.stringify({
      scores: { fluency: 3, coherence: 4, vocabulary: 3, grammar: 4 }, cefr: 'B1',
      summary_uz: "Javob aniq va tushunarli, gaplar o'tgan zamonda to'g'ri tuzilgan. Ravonlikni oshirish uchun uzunroq javob bering.",
      strengths_uz: ["O'tgan zamon to'g'ri ishlatilgan", "Sabab ('because') bilan fikr asoslangan"],
      fixes: [{ original: 'everybody was happy', better: 'everyone was in a great mood', why_uz: 'Tabiiyroq ibora' }],
      next_step_uz: 'Keyingi safar 45 soniya davomida gapirib ko\'ring.',
    }));
  }
  return json("Great question! In English we say 'I went to the park' for the past. Try making your own sentence about yesterday.");
};
