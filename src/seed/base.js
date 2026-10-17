'use strict';
const LANGS = {
  en: { code: 'en', name: 'Ingliz tili', native: 'English', flag: 'EN', tts: 'en-US', dir: 'ltr', color: '#7c5cff' },
  ru: { code: 'ru', name: 'Rus tili', native: 'Русский', flag: '🇷🇺', tts: 'ru-RU', dir: 'ltr', color: '#00d4ff' },
  de: { code: 'de', name: 'Nemis tili', native: 'Deutsch', flag: '🇩🇪', tts: 'de-DE', dir: 'ltr', color: '#ffc94d' },
  fr: { code: 'fr', name: 'Fransuz tili', native: 'Français', flag: '🇫🇷', tts: 'fr-FR', dir: 'ltr', color: '#4f8bff' },
  es: { code: 'es', name: 'Ispan tili', native: 'Español', flag: '🇪🇸', tts: 'es-ES', dir: 'ltr', color: '#ff4fa3' },
  ar: { code: 'ar', name: 'Arab tili', native: 'العربية', flag: '🇸🇦', tts: 'ar-SA', dir: 'rtl', color: '#22d39a' },
};

const RAW_UNITS = [
  {
    key: 'greetings', title: 'Salomlashish', emoji: '👋',
    rows: [
      ['Salom', 'Hello', 'Привет', 'Hallo', 'Salut', 'Hola', 'مرحبا', 'marhaba'],
      ['Xayrli tong', 'Good morning', 'Доброе утро', 'Guten Morgen', 'Bonjour', 'Buenos días', 'صباح الخير', 'sabah al-khayr'],
      ['Xayrli kech', 'Good evening', 'Добрый вечер', 'Guten Abend', 'Bonsoir', 'Buenas tardes', 'مساء الخير', "masa' al-khayr"],
      ["Xayr, ko'rishguncha", 'Goodbye', 'До свидания', 'Auf Wiedersehen', 'Au revoir', 'Adiós', 'مع السلامة', "ma'a as-salama"],
      ['Rahmat', 'Thank you', 'Спасибо', 'Danke', 'Merci', 'Gracias', 'شكرا', 'shukran'],
      ['Iltimos', 'Please', 'Пожалуйста', 'Bitte', "S'il vous plaît", 'Por favor', 'من فضلك', 'min fadlik'],
      ['Kechirasiz', 'Sorry', 'Извините', 'Entschuldigung', 'Excusez-moi', 'Perdón', 'آسف', 'asif'],
      ['Ha', 'Yes', 'Да', 'Ja', 'Oui', 'Sí', 'نعم', "na'am"],
      ["Yo'q", 'No', 'Нет', 'Nein', 'Non', 'No', 'لا', 'la'],
      ['Mening ismim', 'My name is', 'Меня зовут', 'Ich heiße', "Je m'appelle", 'Me llamo', 'اسمي', 'ismi'],
    ],
  },
  {
    key: 'numbers', title: 'Raqamlar 1–10', emoji: '🔢',
    rows: [
      ['Bir', 'One', 'Один', 'Eins', 'Un', 'Uno', 'واحد', 'wahid'],
      ['Ikki', 'Two', 'Два', 'Zwei', 'Deux', 'Dos', 'اثنان', 'ithnan'],
      ['Uch', 'Three', 'Три', 'Drei', 'Trois', 'Tres', 'ثلاثة', 'thalatha'],
      ["To'rt", 'Four', 'Четыре', 'Vier', 'Quatre', 'Cuatro', 'أربعة', "arba'a"],
      ['Besh', 'Five', 'Пять', 'Fünf', 'Cinq', 'Cinco', 'خمسة', 'khamsa'],
      ['Olti', 'Six', 'Шесть', 'Sechs', 'Six', 'Seis', 'ستة', 'sitta'],
      ['Yetti', 'Seven', 'Семь', 'Sieben', 'Sept', 'Siete', 'سبعة', "sab'a"],
      ['Sakkiz', 'Eight', 'Восемь', 'Acht', 'Huit', 'Ocho', 'ثمانية', 'thamaniya'],
      ["To'qqiz", 'Nine', 'Девять', 'Neun', 'Neuf', 'Nueve', 'تسعة', "tis'a"],
      ["O'n", 'Ten', 'Десять', 'Zehn', 'Dix', 'Diez', 'عشرة', "'ashara"],
    ],
  },
  {
    key: 'family', title: 'Oila', emoji: '👨‍👩‍👧',
    rows: [
      ['Ona', 'Mother', 'Мама', 'Mutter', 'Mère', 'Madre', 'أم', 'umm'],
      ['Ota', 'Father', 'Папа', 'Vater', 'Père', 'Padre', 'أب', 'ab'],
      ['Aka, uka', 'Brother', 'Брат', 'Bruder', 'Frère', 'Hermano', 'أخ', 'akh'],
      ['Opa, singil', 'Sister', 'Сестра', 'Schwester', 'Sœur', 'Hermana', 'أخت', 'ukht'],
      ['Bobo', 'Grandfather', 'Дедушка', 'Großvater', 'Grand-père', 'Abuelo', 'جد', 'jadd'],
      ['Buvi', 'Grandmother', 'Бабушка', 'Großmutter', 'Grand-mère', 'Abuela', 'جدة', 'jadda'],
      ["O'g'il", 'Son', 'Сын', 'Sohn', 'Fils', 'Hijo', 'ابن', 'ibn'],
      ['Qiz', 'Daughter', 'Дочь', 'Tochter', 'Fille', 'Hija', 'ابنة', 'ibna'],
      ["Do'st", 'Friend', 'Друг', 'Freund', 'Ami', 'Amigo', 'صديق', 'sadiq'],
      ['Oila', 'Family', 'Семья', 'Familie', 'Famille', 'Familia', 'عائلة', "'a'ila"],
    ],
  },
  {
    key: 'food', title: 'Ovqat va ichimlik', emoji: '🍽️',
    rows: [
      ['Suv', 'Water', 'Вода', 'Wasser', 'Eau', 'Agua', 'ماء', "ma'"],
      ['Non', 'Bread', 'Хлеб', 'Brot', 'Pain', 'Pan', 'خبز', 'khubz'],
      ['Sut', 'Milk', 'Молоко', 'Milch', 'Lait', 'Leche', 'حليب', 'halib'],
      ['Choy', 'Tea', 'Чай', 'Tee', 'Thé', 'Té', 'شاي', 'shay'],
      ['Olma', 'Apple', 'Яблоко', 'Apfel', 'Pomme', 'Manzana', 'تفاحة', 'tuffaha'],
      ["Go'sht", 'Meat', 'Мясо', 'Fleisch', 'Viande', 'Carne', 'لحم', 'lahm'],
      ['Tuxum', 'Egg', 'Яйцо', 'Ei', 'Œuf', 'Huevo', 'بيضة', 'bayda'],
      ['Guruch', 'Rice', 'Рис', 'Reis', 'Riz', 'Arroz', 'أرز', 'aruzz'],
      ['Baliq', 'Fish', 'Рыба', 'Fisch', 'Poisson', 'Pescado', 'سمك', 'samak'],
      ['Qahva', 'Coffee', 'Кофе', 'Kaffee', 'Café', 'Café', 'قهوة', 'qahwa'],
    ],
  },
  {
    key: 'travel', title: 'Sayohat', emoji: '✈️',
    rows: [
      ['Qayerda?', 'Where?', 'Где?', 'Wo?', 'Où ?', '¿Dónde?', 'أين', 'ayna'],
      ['Qancha turadi?', 'How much?', 'Сколько стоит?', 'Wie viel kostet das?', 'Combien ça coûte ?', '¿Cuánto cuesta?', 'بكم', 'bikam'],
      ['Men tushunmayapman', "I don't understand", 'Я не понимаю', 'Ich verstehe nicht', 'Je ne comprends pas', 'No entiendo', 'لا أفهم', 'la afham'],
      ['Yordam bering!', 'Help!', 'Помогите!', 'Hilfe!', 'Au secours !', '¡Ayuda!', 'النجدة', 'an-najda'],
      ['Mehmonxona', 'Hotel', 'Гостиница', 'Hotel', 'Hôtel', 'Hotel', 'فندق', 'funduq'],
      ['Aeroport', 'Airport', 'Аэропорт', 'Flughafen', 'Aéroport', 'Aeropuerto', 'مطار', 'matar'],
      ['Chipta', 'Ticket', 'Билет', 'Fahrkarte', 'Billet', 'Billete', 'تذكرة', 'tadhkira'],
      ['Chapga', 'Left', 'Налево', 'Links', 'À gauche', 'A la izquierda', 'يسار', 'yasar'],
      ["O'ngga", 'Right', 'Направо', 'Rechts', 'À droite', 'A la derecha', 'يمين', 'yamin'],
      ['Restoran', 'Restaurant', 'Ресторан', 'Restaurant', 'Restaurant', 'Restaurante', 'مطعم', "mat'am"],
    ],
  },
];


module.exports = { LANGS, RAW_UNITS };
