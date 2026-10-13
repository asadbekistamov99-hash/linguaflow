'use strict';

// Comprehensive Curriculum & International Certification Blueprint (CEFR A1-C1 & IELTS Band 4.0 - 8.5+)
const STAGES = [
  {
    key: 'a1',
    level: 'A1',
    stage: 1,
    ieltsBand: '3.0 - 4.0',
    title: "A1: Boshlang'ich Fundament (Beginner)",
    subtitle: "Tilning poydevori va asosiy muloqot",
    desc: "Kundalik eng zarur so'zlar, to'g'ri talaffuz va oddiy gap tuzilmalari.",
    unitsRange: '1 - 4-mavzular (20 ta dars)',
    targetWords: '500+ faol so\'z',
    certTarget: 'CEFR A1 Sertifikati · IELTS 3.5 Foundation',
    equivalents: {
      en: 'IELTS 3.0 - 4.0 · Cambridge A1',
      de: 'Goethe-Zertifikat A1: Start Deutsch 1',
      ru: 'ТРКИ ТЭУ (Элементарный)',
      fr: 'DELF A1',
      es: 'DELE A1',
      ar: 'ALPT A1 Asosiy',
    },
    grammarTopics: [
      'To be fe\'li (am, is, are) va shaxs olmoshlari',
      'Present Simple: Kundalik odatlar va faktlar',
      'Artikllar (a, an, the) va ularning to\'g\'ri qo\'llanishi',
      'Ko\'rsatish olmoshlari (this, that, these, those)',
      'Egalik olmoshlari va egalik qo\'shimchalari (\'s)',
      'Sanoqli va sanoqsiz otlar (some, any, much, many)',
    ],
    skills: {
      listening: 'Shaxsiy ma\'lumotlar, ismlar, telefon raqamlari, narxlar va yo\'nalishlarni aniq eshitib anglash (IELTS Listening Part 1 shakli).',
      reading: 'Qisqa xabarlar, belgilar, oddiy e\'lonlar va qisqa shaxsiy tavsiflarni o\'qib tushunish.',
      writing: 'To\'g\'ri harflar va imlo bilan 20-40 so\'zlik oddiy gaplar va shaxsiy anketalarni to\'ldirish.',
      speaking: 'O\'zini tanishtirish, salomlashish, qayerdaligini va nima yoqishini 1-2 jumlada ifodalash.',
    },
    examTips: [
      'Raqamlar va harflarni eshitganda chalkashtirmaslik (b/d, p/b, 13/30).',
      'Fe\'lning hozirgi zamon shaklida III shaxs birlik -s qo\'shimchasini unutmang (He works, She lives).',
      'Oddiy gaplarda so\'z tartibi: Ega + Kesim + To\'ldiruvchi (SVO) qat\'iy bo\'lishi shart.',
    ],
  },
  {
    key: 'a2',
    level: 'A2',
    stage: 2,
    ieltsBand: '4.0 - 5.0',
    title: "A2: Elementar Muloqot (Elementary)",
    subtitle: "Erkin sayohat va kundalik amaliy muloqot",
    desc: "O'tmishdagi voqealar, kelajak rejalari va atrof-muhit haqida gapirish.",
    unitsRange: '5 - 8-mavzular (20 ta dars)',
    targetWords: '1,200+ faol so\'z',
    certTarget: 'CEFR A2 · IELTS 4.0 - 4.5 · KET',
    equivalents: {
      en: 'IELTS 4.0 - 5.0 · Cambridge A2 Key (KET)',
      de: 'Goethe-Zertifikat A2: Start Deutsch 2',
      ru: 'ТРКИ ТБУ (Базовый)',
      fr: 'DELF A2',
      es: 'DELE A2',
      ar: 'ALPT A2',
    },
    grammarTopics: [
      'Past Simple: O\'tgan zamon (to\'g\'ri va noto\'g\'ri fe\'llar ro\'yxati)',
      'Future Simple (will) va To be going to (rejalashtirilgan ishlar)',
      'Qiyosiy va orttirma sifatlar (bigger, the biggest, more interesting)',
      'Modal fe\'llar (can, could, must, should, have to)',
      'Vaqt va makon predloglari (at, on, in, into, next to)',
      'Sanoq va tartib sonlar, vaqtni ifodalash',
    ],
    skills: {
      listening: 'Sayohat jadvallari, e\'lonlar, qisqa do\'kon yoki aeroport dialoglarini to\'liq tushunish.',
      reading: 'Skimming (umumiy ma\'no) va Scanning (aniq raqam/fakt izlash) usullari bilan qisqa matnlarni tahlil qilish.',
      writing: 'Qisqa shaxsiy xat yoki email (60-80 so\'z), sayohat yoki kechagi kun haqida hikoya yozish.',
      speaking: 'Rejalar, oila va kasblar haqida 3-4 jumla bilan to\'xtalmasdan fikr bildirish.',
    },
    examTips: [
      'IELTS Listeningda predloglar va kalit so\'zlarni (keywords) oldindan belgilab oling.',
      'Noto\'g\'ri fe\'llarning II shaklini (went, bought, saw, took) puxta yod oling.',
      'So\'zlarning to\'g\'ri talaffuz urg\'usiga e\'tibor bering.',
    ],
  },
  {
    key: 'b1',
    level: 'B1',
    stage: 3,
    ieltsBand: '5.0 - 5.5',
    title: "B1: Mustaqil O'rta Daraja (Intermediate)",
    subtitle: "IELTS 5.5 va mustaqil yashash darajasi",
    desc: "Shaxsiy fikrni dalillash, sabab-oqibatni tushuntirish va matnlarni chuqur tahlil qilish.",
    unitsRange: '9 - 12-mavzular (20 ta dars)',
    targetWords: '2,500+ faol so\'z',
    certTarget: 'CEFR B1 · IELTS 5.0 - 5.5 · PET',
    equivalents: {
      en: 'IELTS 5.0 - 5.5 · Cambridge B1 Preliminary (PET)',
      de: 'Goethe-Zertifikat B1 (Zertifikat Deutsch)',
      ru: 'ТРКИ-I (Первый сертификационный)',
      fr: 'DELF B1',
      es: 'DELE B1',
      ar: 'ALPT B1 Mustaqil',
    },
    grammarTopics: [
      'Present Perfect vs Past Simple (tajriba va tugallangan ishlar)',
      'Past Continuous vs Past Simple (o\'tgan zamonda davomli hodisalar)',
      'Shart ergash gaplar: Zero va First Conditional (If + Present, will...)',
      'Bog\'lovchilar (Relative clauses: who, which, that, whose, where)',
      'Modal verbs of deduction (might, must, can\'t be)',
      'Bog\'lovchi so\'zlar (however, although, therefore, because, in order to)',
    ],
    skills: {
      listening: 'IELTS Listening Part 2 va Part 3: Suhbatdoshlarning munosabati va fikrini ilg\'ab olish.',
      reading: 'True / False / Not Given savollari bilan ishlash, matndagi parafrazalarni (sinonimlarni) topish.',
      writing: 'IELTS General Task 1 (Formal & Informal xatlar) va kirish inshosi (120-150 so\'z).',
      speaking: 'IELTS Speaking Part 2 (Cue Card): 1 daqiqalik tayyorgarlik bilan 2 daqiqa to\'xtovsiz ravon gapirish.',
    },
    examTips: [
      'IELTS Readingda matndan aynan so\'z qidirmang — sinonim va parafrazalarga tayanadi.',
      'Insho yozganda kirish (Introduction), asosiy qism (Body) va xulosa (Conclusion) tuzilmasiga qat\'iy rioya qiling.',
      'Speakingda "Yes/No" bilan cheklanmang; har doim "Because..." deb sabab va misol keltiring.',
    ],
  },
  {
    key: 'b2',
    level: 'B2',
    stage: 4,
    ieltsBand: '6.0 - 6.5',
    title: "B2: O'rtadan Yuqori Professional (Upper-Intermediate)",
    subtitle: "IELTS 6.5 — Chet el universitetlari va vizalar talabi",
    desc: "Akademik tahlil, majhul nisbat, murakkab insholar va ilmiy ma'ruzalarni tushunish.",
    unitsRange: '13 - 16-mavzular (20 ta dars)',
    targetWords: '4,000+ faol so\'z',
    certTarget: 'CEFR B2 · IELTS 6.0 - 6.5 · FCE',
    equivalents: {
      en: 'IELTS 6.0 - 6.5 · Cambridge B2 First (FCE) · TOEFL 75-90',
      de: 'Goethe-Zertifikat B2 · TestDaF TDN 3',
      ru: 'ТРКИ-II (Второй сертификационный)',
      fr: 'DELF B2',
      es: 'DELE B2',
      ar: 'ALPT B2 Professional',
    },
    grammarTopics: [
      'Passive Voice (Majhul nisbat - barcha zamonlarda; IELTS Task 1 hisobotlari uchun o\'ta muhim)',
      'Second & Third Conditionals (xayoliy va o\'tmishdagi afsuslar)',
      'Reported Speech: O\'zlashtirma gap va zamonlar moslashuvi',
      'Gerund vs Infinitive (murakkab fe\'llar birikmasi)',
      'Akademik bog\'lovchilar (Furthermore, Moreover, Consequently, On the contrary, In contrast)',
      'Phrasal verbs (frazali fe\'llar) va Collocations (mustahkam iboralar)',
    ],
    skills: {
      listening: 'IELTS Listening Part 3 & 4: Universitet darslari, ilmiy bahslar va tez nutqni konspekt qilish.',
      reading: 'Matching Headings, Summary Completion va ilmiy maqolalarning asosiy g\'oyalarini tez ilg\'ash.',
      writing: 'IELTS Academic Task 1 (Grafik, jadval va trendlar tasviri - 150+ so\'z) va IELTS Task 2 (250+ so\'zlik daliliy insho).',
      speaking: 'IELTS Speaking Part 3: Global muammolar, texnologiya, ta\'lim va jamiyat haqida chuqur tahliliy fikr yuritish.',
    },
    examTips: [
      'IELTS Writing Task 2 da 4 mezonni unutmang: Task Response, Coherence & Cohesion, Lexical Resource, Grammar.',
      'Bir xil so\'zlarni takrorlamang; sinonimlar va mavzuga oid boy terminologiyadan foydalaning.',
      'Listeningda savol qog\'ozida berilgan so\'z chegarasiga (NO MORE THAN TWO WORDS) qat\'iy e\'tibor bering.',
    ],
  },
  {
    key: 'c1',
    level: 'C1',
    stage: 5,
    ieltsBand: '7.0 - 8.5+',
    title: "C1: Ilg'or & Akademik Mukammallik (Advanced)",
    subtitle: "IELTS 7.5 - 8.5+ · Magistratura, Doktorantura va Xalqaro Karyera",
    desc: "Nuanslar, badiiy va ilmiy matnlar, yashirin tagma'nolar va ona tilidek erkin ifodalash.",
    unitsRange: '17 - 20-mavzular (20 ta dars)',
    targetWords: '6,000+ so\'z (Academic Word List)',
    certTarget: 'CEFR C1 · IELTS 7.5 - 8.5 · CAE',
    equivalents: {
      en: 'IELTS 7.0 - 8.5+ · Cambridge C1 Advanced (CAE) · TOEFL 100-115',
      de: 'Goethe-Zertifikat C1 · TestDaF TDN 4-5',
      ru: 'ТРКИ-III (Третий сертификационный)',
      fr: 'DALF C1',
      es: 'DELE C1',
      ar: 'ALPT C1 Mukammal',
    },
    grammarTopics: [
      'Inversion (Had I known, Never before have I seen..., Seldom do we...)',
      'Mixed Conditionals (Aralash shart mayllari)',
      'Subjunctive mood (I suggest that he be present...)',
      'Cleft Sentences (What strikes me most is..., It was not until...)',
      'Advanced Participle Clauses (Having analyzed the data, Having been informed...)',
      'High-level Idiomatic Expressions & Academic Collocations',
    ],
    skills: {
      listening: 'IELTS Listening Part 4: Tez aytilgan ilmiy terminlar, nozik kinoya va murakkab sintaksisni bir martada ilg\'ash.',
      reading: 'Murakkab akademik adabiyot, muallif pozitsiyasidagi yashirin nuanslar va ilmiy gipotezalarni tezkor tahlil qilish.',
      writing: 'Band 8.0+ insholar: Yuqori darajadagi mantiqiy zanjir, boy akademik lug\'at (AWL) va benuqson grammatika.',
      speaking: 'IELTS Speaking da har qanday mavzuda erkin, tabiiy, idomatik iboralar bilan to\'xtovsiz va ishonchli suhbat.',
    },
    examTips: [
      'IELTS Band 8.0+ olish uchun grammatik xatolarga mutlaqo yo\'l qo\'ymaslik va tabiiy bog\'lovchilardan foydalanish kerak.',
      'Oddiy so\'zlar o\'rniga akademik sinonimlarni qo\'llang (masalan, "good" o\'rniga "exemplary, beneficial, advantageous").',
      'Speakingda fikr bildirayotganda turli tomonlama ko\'rib chiqing: "From an economic perspective..., while culturally...".',
    ],
  },
];

// Authentic Exam Questions generator for mock tests
function buildMockExam(langCode, levelCode, contentHelper) {
  const level = String(levelCode || 'B2').toUpperCase();
  const lang = contentHelper.lang(langCode) || contentHelper.lang('en');

  // Select pool of words & sentences from the language
  const allUnits = contentHelper.units().filter((u) => u.enabled);
  const concepts = allUnits.flatMap((u) => u.concepts.filter((c) => c.t[lang.code]));
  const sentences = allUnits.flatMap((u) => u.sentences.filter((s) => s.t[lang.code]));

  // Pick target words
  const pool = [...concepts].sort(() => 0.5 - Math.random());
  const selectedWords = pool.slice(0, 8);

  const stageMeta = STAGES.find((s) => s.level === level) || STAGES[3];

  // 1. Listening Comprehension section (4 items)
  const listening = [
    {
      id: 'l1',
      type: 'listening',
      audioText: selectedWords[0]?.t[lang.code] || 'University',
      question: `Audioni tinglang va aytilgan so'zning to'g'ri o'zbekcha tarjimasini tanlang:`,
      options: [
        selectedWords[0]?.uz || 'Universitet',
        selectedWords[1]?.uz || 'Maktab',
        selectedWords[2]?.uz || 'Kutubxona',
        selectedWords[3]?.uz || 'Imtihon',
      ].sort(() => 0.5 - Math.random()),
      correctAnswer: selectedWords[0]?.uz || 'Universitet',
      tip: "Tinglashda harflar va oxirgi tovushlarga diqqat qiling.",
    },
    {
      id: 'l2',
      type: 'listening',
      audioText: selectedWords[1]?.t[lang.code] || 'Education',
      question: `Audioni tinglang. Qaysi xalqaro so'z talaffuz qilindi?`,
      options: [
        selectedWords[1]?.t[lang.code] || 'Education',
        selectedWords[2]?.t[lang.code] || 'Family',
        selectedWords[3]?.t[lang.code] || 'Friend',
        selectedWords[0]?.t[lang.code] || 'Water',
      ].sort(() => 0.5 - Math.random()),
      correctAnswer: selectedWords[1]?.t[lang.code] || 'Education',
      tip: "Urg'u va unli tovushlar cho'ziqligini anglang.",
    },
    {
      id: 'l3',
      type: 'listening',
      audioText: sentences[0]?.t[lang.code] || 'I want to study at university.',
      question: `Audioni tinglang va to'liq gapning to'g'ri yozilishini toping:`,
      options: [
        sentences[0]?.t[lang.code] || 'I want to study at university.',
        sentences[1]?.t[lang.code] || 'This is a big house.',
        sentences[2]?.t[lang.code] || 'My car is very fast.',
        sentences[3]?.t[lang.code] || 'Today the weather is cold.',
      ].sort(() => 0.5 - Math.random()),
      correctAnswer: sentences[0]?.t[lang.code] || 'I want to study at university.',
      tip: "Gapdagi barcha so'zlarning ketma-ketligini tinglang.",
    },
  ];

  // 2. Reading Comprehension & Context (3 items)
  const reading = [
    {
      id: 'r1',
      type: 'reading',
      passage: lang.code === 'en'
        ? "Global education has expanded dramatically in the 21st century. Learning foreign languages enables individuals to access prestigious international universities and excel in multinational careers. Research shows that bilingual people demonstrate superior cognitive flexibility and problem-solving skills."
        : `O'rganilayotgan til (${lang.name}) dunyo miqyosida muhim o'ringa ega. Ushbu tilni yuqori darajada bilish xalqaro sertifikatlar olish va jahonning nufuzli ta'lim muassasalarida o'qish imkonini beradi.`,
      question: lang.code === 'en'
        ? "According to the passage, what cognitive benefit do bilingual people possess?"
        : `Matnga ko'ra, chet tillarini o'rganishning eng katta afzalligi nima?`,
      options: lang.code === 'en'
        ? [
            "Superior cognitive flexibility and problem-solving skills",
            "Guaranteed immediate wealth",
            "Ability to travel without tickets",
            "Decreased interest in local languages",
          ]
        : [
            "Xalqaro sertifikatlar va nufuzli oliygohlarda o'qish imkoniyati",
            "Hech qanday imtihonsiz diplom olish",
            "Yozish qobiliyatining pasayishi",
            "Kundalik muloqotdan butunlay voz kechish",
          ],
      correctAnswer: lang.code === 'en'
        ? "Superior cognitive flexibility and problem-solving skills"
        : "Xalqaro sertifikatlar va nufuzli oliygohlarda o'qish imkoniyati",
      tip: "Matndagi kalit so'zlarni (keywords) izlang.",
    },
    {
      id: 'r2',
      type: 'reading',
      passage: lang.code === 'en'
        ? "IELTS candidates must allocate sufficient time for Task 2 essays, which contribute twice as much to the Writing band score as Task 1. Clear paragraphing and coherent argumentation are decisive factors for achieving Band 7.5 or higher."
        : "Imtihon topshiruvchilar har bir savolga ajratilgan vaqtni to'g'ri taqsimlashi lozim. Mantiqiy bog'liqlik va grammatik aniqlik yuqori ball olishning hal qiluvchi mezonidir.",
      question: lang.code === 'en'
        ? "What is a decisive factor for achieving a high band in the writing section?"
        : "Imtihonda yuqori ball olishning eng muhim omili nima?",
      options: lang.code === 'en'
        ? [
            "Clear paragraphing and coherent argumentation",
            "Writing in very small font",
            "Copying words exactly from the prompt",
            "Finishing in less than 5 minutes",
          ]
        : [
            "Mantiqiy bog'liqlik va grammatik aniqlik",
            "Faqat bitta so'zdan foydalanish",
            "Vaqt tugashini kutib o'tirish",
            "Savollarni o'qimasdan tavakkal qilish",
          ],
      correctAnswer: lang.code === 'en'
        ? "Clear paragraphing and coherent argumentation"
        : "Mantiqiy bog'liqlik va grammatik aniqlik",
      tip: "IELTS mezonlari: Task Response va Coherence & Cohesion.",
    },
  ];

  // 3. Grammar & Academic Vocabulary (4 items)
  const grammar = [
    {
      id: 'g1',
      type: 'grammar',
      question: lang.code === 'en'
        ? "Choose the correct academic linker: 'The experiment produced promising results; __________, further trials are necessary to verify the hypothesis.'"
        : `'Mening maqsadim - xalqaro sertifikat olish' jumlasining to'g'ri tarjimasi qaysi?`,
      options: lang.code === 'en'
        ? ['nevertheless', 'because of', 'such as', 'due to']
        : [
            `${selectedWords[0]?.t[lang.code] || 'Target'} is important`,
            `I want to achieve a certificate`,
            `Language learning is fun`,
            `Today is cold`,
          ],
      correctAnswer: lang.code === 'en' ? 'nevertheless' : 'I want to achieve a certificate',
      tip: "Qarama-qarshilikni ko'rsatuvchi rasmiy bog'lovchi kerak.",
    },
    {
      id: 'g2',
      type: 'grammar',
      question: lang.code === 'en'
        ? "Complete the sentence with the correct conditional structure: 'If governments invested more in renewable energy, greenhouse emissions __________ significantly.'"
        : `'Biz har kuni yangi so'zlarni o'rganamiz' jumlasidagi fe'l qaysi zamonda bo'lishi kerak?`,
      options: lang.code === 'en'
        ? ['would decrease', 'will decrease', 'would have decreased', 'decreases']
        : [
            'Hozirgi oddiy zamon (Present Simple)',
            'O\'tgan tugallangan zamon (Past Perfect)',
            'Kelasi davomli zamon (Future Continuous)',
            'Majhul nisbat (Passive Voice)',
          ],
      correctAnswer: lang.code === 'en' ? 'would decrease' : 'Hozirgi oddiy zamon (Present Simple)',
      tip: "Second Conditional: If + Past Simple, would + Verb.",
    },
    {
      id: 'g3',
      type: 'grammar',
      question: lang.code === 'en'
        ? "Identify the sentence written in correct Passive Voice (essential for IELTS Task 1 reports):"
        : `Qaysi gapda xalqaro grammatika qoidasi to'g'ri qo'llangan?`,
      options: lang.code === 'en'
        ? [
            "The data was collected by independent researchers over a three-year period.",
            "Independent researchers collects the data over a three-year period.",
            "The data having been collect by researchers yesterday.",
            "Collecting data was researchers over three years.",
          ]
        : [
            selectedWords[2] ? `${selectedWords[2].t[lang.code]} juda muhim ahamiyatga ega.` : 'To\'g\'ri variant',
            'Xato variant 1',
            'Xato variant 2',
            'Xato variant 3',
          ],
      correctAnswer: lang.code === 'en'
        ? "The data was collected by independent researchers over a three-year period."
        : (selectedWords[2] ? `${selectedWords[2].t[lang.code]} juda muhim ahamiyatga ega.` : 'To\'g\'ri variant'),
      tip: "Passive: Subject + was/were + Past Participle (V3).",
    },
  ];

  // 4. Speaking & Writing Evaluation Prompt (1 prompt)
  const writingPrompt = {
    id: 'w1',
    type: 'writing_speaking',
    title: `IELTS & Xalqaro Imtihon Amaliy Sinovi (${stageMeta.level} Daraja)`,
    topic: lang.code === 'en'
      ? "Topic: 'Some people argue that technological development improves quality of life, while others believe it causes social isolation. Discuss both views and give your own opinion.'"
      : `Mavzu: 'Chet tillarini erta yoshdan o'rganish inson tafakkurini rivojlantiradimi? O'z fikringizni dalillar bilan bayon qiling.'`,
    guidelines: [
      "Kamida 3 ta dalil va misol keltiring.",
      "Bog'lovchi so'zlardan (Firstly, Furthermore, However, In conclusion) to'g'ri foydalaning.",
      "Grammatik xilma-xillik va boy so'z boyligini namoyish eting.",
    ],
  };

  const allGradedQuestions = [...listening, ...reading, ...grammar];

  return {
    meta: {
      lang: { code: lang.code, name: lang.name, native: lang.native, flag: lang.flag, tts: lang.tts },
      level,
      ieltsBand: stageMeta.ieltsBand,
      examTitle: lang.code === 'en' ? `${level} tayyorgarlik imtihoni · IELTS taxminiy ${stageMeta.ieltsBand.split('-')[1]?.trim() || '7.5'}` : `${lang.name} ${level} tayyorgarlik imtihoni`,
      timeLimitMinutes: 20,
      totalQuestions: allGradedQuestions.length,
      passThresholdPercent: 70,
    },
    stageMeta,
    listening,
    reading,
    grammar,
    writingPrompt,
    gradedQuestions: allGradedQuestions,
  };
}

module.exports = {
  STAGES,
  buildMockExam,
};
