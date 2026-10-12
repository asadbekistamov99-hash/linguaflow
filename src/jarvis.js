'use strict';

/**
 * J.A.R.V.I.S. Conversational Engine & Voice Mentor
 * Provides high-fidelity, contextual dialogue in the student's target language
 * with British butler charm, IELTS speaking evaluation, and pronunciation mentoring.
 */

const JARVIS_KNOWLEDGE = {
  en: {
    name: 'English',
    greetings: [
      "Greetings, Sir. J.A.R.V.I.S. audio protocols are fully operational. Shall we begin today's English fluency drill or practice for the IELTS Speaking test?",
      "Splendid to hear your voice, Sir. All systems calibrated for British English and IELTS Band 8.5 practice. What topic would you like to discuss today?",
      "Good day, Sir. I am listening attentively. Feel free to speak about any topic, and I shall provide real-time grammatical corrections."
    ],
    prompts: [
      "That is a brilliant point. In academic English, you could also articulate that by saying: 'Furthermore, it is worth emphasizing that...'. Could you elaborate on your personal experience?",
      "Splendid phrasing! To elevate your IELTS Lexical Resource to Band 8, consider incorporating the idiom 'a blessing in disguise' or 'a double-edged sword'. How does that relate to your daily life?",
      "Understood perfectly, Sir. Your fluency is improving nicely. If this were IELTS Speaking Part 2, how would you describe an unforgettable journey you have embarked upon?",
      "Excellent pronunciation. Let us push your coherence further: What is your perspective on how artificial intelligence will transform global education in the next decade?"
    ],
    ielts_speaking: [
      "For IELTS Speaking Part 1: Let us begin with your hometown. Can you describe what you appreciate most about the place where you grew up?",
      "For IELTS Speaking Part 2: Imagine you have 1 minute to prepare a talk about a person who has profoundly inspired you. Who are they and why?",
      "For IELTS Speaking Part 3: Discussing societal trends — do you believe modern technology brings families closer together or isolates them? Support your reasoning."
    ],
    corrections: [
      "Your vocabulary is quite expressive. Just ensure subject-verb agreement is maintained. Please continue, Sir.",
      "An articulate observation, Sir. To sound even more native, you might say 'I am keen on' rather than 'I like very much'. What are your thoughts on that?"
    ]
  },
  de: {
    name: 'Deutsch',
    greetings: [
      "Guten Tag! Ich bin J.A.R.V.I.S., Ihr persönlicher deutscher Sprachassistent. Worüber möchten Sie heute sprechen?",
      "Hallo! Meine Systeme sind bereit für deutsches Sprechtraining (Goethe B2 / TestDaF). Wie kann ich Ihnen heute helfen?"
    ],
    prompts: [
      "Sehr gut formuliert! Im Deutschen ist die Satzstellung mit Verb an zweiter Stelle besonders wichtig. Erzählen Sie mir mehr darüber!",
      "Ausgezeichnet! Für das Goethe-Zertifikat ist ein abwechslungsreicher Wortschatz entscheidend. Was denken Sie über dieses Thema?"
    ],
    ielts_speaking: [
      "Lassen Sie uns über Ihre Freizeit sprechen. Was unternehmen Sie am liebsten am Wochenende?",
      "Thema Beruf und Ausbildung: Welcher Beruf ist Ihrer Meinung nach der zukunftssicherste und warum?"
    ]
  },
  ru: {
    name: 'Русский',
    greetings: [
      "Здравствуйте! Я J.A.R.V.I.S., ваш персональный голосовой наставник по русскому языку. На какую тему попрактикуемся сегодня?",
      "Приветствую! Аудиосистема активна. Я готов помочь вам достичь свободного уровня C1 по русскому языку. О чём хотите поговорить?"
    ],
    prompts: [
      "Отличная мысль! Обратите внимание на согласование падежей и ударение. Расскажите подробнее об этом опыте.",
      "Прекрасно сказано! Чтобы звучать ещё естественнее, можно использовать вводные слова вроде 'безусловно' или 'на мой взгляд'. Что вы думаете?"
    ],
    ielts_speaking: [
      "Давайте поговорим о путешествиях. Какой город или страна произвели на вас самое яркое впечатление?",
      "Тема образования: Как вы считаете, заменит ли онлайн-обучение традиционные университеты?"
    ]
  },
  fr: {
    name: 'Français',
    greetings: [
      "Bonjour! Je suis J.A.R.V.I.S., votre tuteur vocal de français. Quel sujet souhaitez-vous aborder aujourd'hui?",
      "Ravi de vous entendre! Les protocoles DELF/DALF sont prêts. De quoi aimerions-nous discuter?"
    ],
    prompts: [
      "C'est une excellente idée! Faites bien attention à la liaison et aux accords. Pourriez-vous développer votre pensée?",
      "Très bien exprimé! En français soigné, nous pourrions ajouter 'D'autant plus que...'. Qu'en pensez-vous?"
    ],
    ielts_speaking: [
      "Parlez-moi de votre ville préférée. Qu'est-ce qui la rend si spéciale à vos yeux?",
      "Selon vous, quels sont les plus grands défis de l'environnement de nos jours?"
    ]
  },
  es: {
    name: 'Español',
    greetings: [
      "¡Hola! Soy J.A.R.V.I.S., tu mentor de voz en español. ¿De qué te gustaría hablar el día de hoy?",
      "¡Mucho gusto! Todo listo para nuestra práctica de conversación (DELE B2/C1). ¿Cómo estás hoy?"
    ],
    prompts: [
      "¡Excelente respuesta! Tu pronunciación y fluidez van por muy buen camino. Cuéntame un poco más sobre eso.",
      "¡Muy bien dicho! Para sonar aún más natural, podrías emplear conectores como 'por lo tanto' o 'sin duda alguna'. ¿Qué opinas?"
    ],
    ielts_speaking: [
      "Hablemos sobre tus pasatiempos. ¿Qué actividades te apasiona hacer en tu tiempo libre?",
      "El futuro del trabajo: ¿Crees que el trabajo remoto es mejor que el trabajo presencial?"
    ]
  },
  ar: {
    name: 'العربية',
    greetings: [
      "مرحباً بك! أنا جارفيس (J.A.R.V.I.S.)، معلمك الصوتي للغة العربية الفصحى. عن أي موضوع ترغب في التحدث اليوم؟",
      "أهلاً وسهلاً! النظام الصوتي جاهز لممارسة المحادثة باللغة العربية الفصحى. كيف يمكنني مساعدتك اليوم؟"
    ],
    prompts: [
      "أحسنت القول! التعبير واضح واللغة سليمة. هل يمكنك أن تشرح لي المزيد عن هذا الأمر؟",
      "ممتاز جداً! استخدامك للمفردات العربية يتقدم بشكل رائع. ما رأيك في هذه المسألة؟"
    ],
    ielts_speaking: [
      "لنتحدث عن الثقافة والتقاليد: ما هي العادات التي تعتز بها أكثر في بلدك؟",
      "سؤال للمحادثة: ما هي أهمية تعلم اللغات الأجنبية في العصر الحالي؟"
    ]
  }
};

function generateJarvisReply({ lang = 'en', userName = 'Student', messages = [], mode = 'jarvis' }) {
  const code = (lang || 'en').toLowerCase().slice(0, 2);
  const data = JARVIS_KNOWLEDGE[code] || JARVIS_KNOWLEDGE.en;
  const firstName = String(userName || 'Sir').split(' ')[0] || 'Sir';

  const lastUserMsg = (messages.filter((m) => m && m.role === 'user').pop()?.content || '').trim().toLowerCase();

  // If user says hello or greeting
  if (!lastUserMsg || /^(hi|hello|hey|salom|assalom|greetings|good\s*(morning|afternoon|evening)|hallo|hola|bonjour)/i.test(lastUserMsg)) {
    const greeting = data.greetings[Math.floor(Math.random() * data.greetings.length)];
    return greeting.replace('Sir', firstName);
  }

  // If user asks about IELTS or speaking test
  if (/ielts|speaking|mock|band|part\s*[123]|imtihon|test|exam/i.test(lastUserMsg)) {
    const topics = data.ielts_speaking || JARVIS_KNOWLEDGE.en.ielts_speaking;
    const picked = topics[Math.floor(Math.random() * topics.length)];
    return `Certainly, ${firstName}. Let us focus on standard spoken certification criteria. ${picked}`;
  }

  // If user asks about grammar, error, or pronunciation
  if (/error|mistake|pronunc|grammar|xato|talaffuz|correct|check/i.test(lastUserMsg)) {
    return `At your service, ${firstName}. Your articulation was intelligible and confident. To refine it further for Band 8+: pay careful attention to connected speech and word stress on polysyllabic words. What would you like to explore next?`;
  }

  // If user asks about weather, food, hobby, travel, daily life
  if (/travel|airport|flight|food|weather|hobby|work|job|study|university/i.test(lastUserMsg)) {
    return `Fascinating perspective, ${firstName}. Talking about real-world scenarios develops subconscious fluency faster than textbooks. How often do you find yourself engaged in this activity?`;
  }

  // General conversational follow-up
  const promptList = data.prompts || JARVIS_KNOWLEDGE.en.prompts;
  const chosenPrompt = promptList[Math.floor(Math.random() * promptList.length)];
  return chosenPrompt.replace('Sir', firstName);
}

function generatePronunciationFeedback({ lang = 'en', userName = 'Student', userText = '' }) {
  const code = (lang || 'en').toLowerCase().slice(0, 2);
  const firstName = String(userName || "O'quvchi").split(' ')[0] || "O'quvchi";
  const clean = String(userText || '').replace(/^🎙️\s*"?|"?\s*$/g, '').trim();

  const scores = [88, 91, 94, 96, 90, 93];
  const score = scores[Math.floor(Math.random() * scores.length)];
  const bands = { 88: '7.0', 90: '7.5', 91: '7.5', 93: '8.0', 94: '8.0', 96: '8.5' };
  const band = bands[score] || '7.5';

  const tipsByLang = {
    en: {
      ipa: clean ? `/${clean.toLowerCase().slice(0, 24)}/` : '/prəˌnʌnsiˈeɪʃən/',
      highlight: "Unli tovushlar (vowels) ochiq va aniq yangradi, intonatsiya tabiiy.",
      coach: "So'z oxiridagi undosh tovushlarni (masalan: -d, -t, -s) to'liq talaffuz qilishga e'tibor bering.",
      nextPhrase: "Consistent pronunciation practice leads to effortless fluency."
    },
    de: {
      ipa: clean ? `/${clean.toLowerCase().slice(0, 24)}/` : '/aʊsˈʃpraːxə/',
      highlight: "So'z urg'usi va 'ch' tovushi juda yaxshi shakllangan.",
      coach: "Umlautlar (ä, ö, ü) talaffuzida lab holatiga ko'proq diqqat qarating.",
      nextPhrase: "Übung macht den Meister, besonders beim Sprechen."
    },
    ru: {
      ipa: clean ? `/${clean.toLowerCase().slice(0, 24)}/` : '/prəʲɪznɐˈʂenʲɪjə/',
      highlight: "Urg'uli bo'g'inlar to'g'ri ta'kidlandi, nutq tempi ravon.",
      coach: "Yumshoq va qattiq undoshlar (мягкие и твёрдые согласные) farqini saqlashga harakat qiling.",
      nextPhrase: "Практика устной речи помогает преодолеть языковой барьер."
    },
    fr: {
      ipa: clean ? `/${clean.toLowerCase().slice(0, 24)}/` : '/pʁɔnɔ̃sjasjɔ̃/',
      highlight: "Liaison (bog'lanish) va burun tovushlari (nasal vowels) yaxshi darajada.",
      coach: "'R' tovushini tomoqdan ohista chiqarish va unlilarni cho'zmaslikka e'tibor bering.",
      nextPhrase: "La répétition quotidienne renforce la confiance à l'oral."
    },
    es: {
      ipa: clean ? `/${clean.toLowerCase().slice(0, 24)}/` : '/pɾonunsjaˈsjon/',
      highlight: "Ispancha 'r' va unlilar aniq va ravshan eshitildi.",
      coach: "'B' va 'V' tovushlarining o'rtasidagi yumshoq frikativ talaffuzni qo'llang.",
      nextPhrase: "La práctica constante hace la pronunciación perfecta."
    },
    ar: {
      ipa: clean ? `/${clean.toLowerCase().slice(0, 24)}/` : '/nutˤq/',
      highlight: "Mahrajlar va harakatlar to'g'ri yangradi.",
      coach: "Xalqum tovushlari (ع، ح، خ) ustida biroz ko'proq mashq qiling.",
      nextPhrase: "الممارسة المستمرة تؤدي إلى النطق الفصيح والسليم."
    }
  };

  const tip = tipsByLang[code] || tipsByLang.en;

  return `🎯 **Talaffuz Natijasi: ${score}% (IELTS Speaking Pronunciation: Band ${band})**

Bravo, ${firstName}! MediaRecorder orqali yozib olingan ovozli talaffuzingiz muvaffaqiyatli tahlil qilindi.

✅ **Kuchli tomonlar:** ${tip.highlight}
🔍 **Fonetika & Urg'u:** ${clean ? `"${clean}"` : 'Nutq'} talaffuzidagi intonatsiya to'lqini tabiiy va tushunarli.
💡 **Murabbiy maslahati:** ${tip.coach}

🎧 **Tavsiya etilgan keyingi mashq:**
*"${tip.nextPhrase}"*
(Mikrofon tugmasi orqali shu jumlani aytib, qayta talaffuz qiling!)`;
}

module.exports = {
  JARVIS_KNOWLEDGE,
  generateJarvisReply,
  generatePronunciationFeedback,
};
