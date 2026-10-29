// glossary.js — plain data, ES module (background.js service worker "type":"module"
// import karta hai). Koi coding jaane bina bhi yahan word add/remove kar sakte ho:
// bas ek naya "key": "value" jodo neeche wale objects me, same pattern follow karo.
//
// Yeh sab Google Translate ke ROMANIZED Hindi output (dt=rm) pe kaam karta hai,
// Devanagari pe nahi. Saari keys lowercase honi chahiye (matching case-insensitive hoti hai).

// Pass 1 — purane/formal phrases hatao (Gen-Z log yeh nahi bolte). Phrase-level
// isliye pehle chalta hai, single-word passes se pehle (warna "kiya jata hai" ke
// individual words alag-alag badal ke phrase tut jayegi).
export const FORMAL_PHRASES = {
  "kiya jata hai": "hota hai",
  "ki jati hai": "hoti hai",
  "kiye jate hain": "hote hain",
  "upyog kiya jata hai": "use hota hai",
  "prayog kiya jata hai": "use hota hai",
  "upyog karte hain": "use karte hain",
  "ke dwara": "se",
  "ke karan": "ki wajah se",
  "is prakar": "is tarah",
  "us prakar": "us tarah",
  "prati din": "roz",
  "pratidin": "roz",
};

// Pass 2 — formal single words -> casual
export const FORMAL_WORDS = {
  dwara: "se",
  tatha: "aur",
  evam: "aur",
  parantu: "lekin",
  kintu: "lekin",
  atah: "isliye",
  atyadhik: "bohot",
  ati: "bohot",
  sakriya: "active",
  nishkriya: "inactive",
  avashyak: "zaroori",
  sambhav: "possible",
  asambhav: "impossible",
  uddeshya: "goal",
  vishesh: "khaas",
  vishist: "khaas",
  sthiti: "situation",
  paristhiti: "situation",
  vyakti: "insaan",
  vyaktiyon: "logon",
  varnan: "explain",
  spashtikaran: "explanation",
  nirdesh: "instructions",
  suchit: "batana",
  soochit: "batana",
  pratikriya: "reaction",
  anurodh: "request",
  swikriti: "approval",
  anumati: "permission",
  yadi: "agar",
  kripya: "please",
  ve: "wo",
};

// Pass 3 — Gen-Z / WhatsApp-style spelling. Sirf wahi entries jo asal me kuch
// badalti hain (identity mappings ka koi fayda nahi).
export const SPELLING_FIXES = {
  yah: "yeh",
  vah: "woh",
  vahan: "wahan",
  nahin: "nahi",
  kyonki: "kyunki",
  bahut: "bohot",
  unhen: "unhe",
  unhonne: "unhone",
  han: "hain", // Google ka roman kabhi chandrabindu drop kar deta hai ("karte han")
};

// Pass 4 — English words wapas laao. Formal Sanskrit-Hindi -> common English
// (jo Gen-Z log waise hi bolte hain). Key: romanized Hindi word (lowercase),
// Value: English word jo use hoga.
export const ENGLISH_GLOSSARY = {
  // Tech / internet
  upyog: "use",
  prayog: "use",
  nihshulk: "free",
  muft: "free",
  praudyogiki: "technology",
  takneek: "technology",
  taknik: "technology",
  upyogkarta: "user",
  upyogkartaon: "users",
  upyogkartaom: "users",
  anuprayog: "app",
  sanskaran: "version",
  suvidha: "feature",
  suvidhaen: "features",
  pranali: "system",
  pranaliyon: "systems",
  softweyar: "software",
  hardveyar: "hardware",
  antarjaal: "internet",
  jaalsthal: "website",
  vebsait: "website",
  sanket: "signal",
  gyapan: "notification",
  suchna: "information",
  jaankari: "information",
  aankdon: "data",
  vishleshan: "analysis",

  // Business / general
  kampani: "company",
  sanstha: "company",
  vivaran: "details",
  navinatam: "latest",
  avtaran: "download",
  upalabdh: "available",
  seva: "service",
  sevaon: "services",
  utpad: "product",
  utpadon: "products",
  grahak: "customer",
  grahakon: "customers",
  bazaar: "market",
  vipanan: "marketing",
  vigyapan: "ad",
  mulya: "price",
  shulk: "fee",

  // Money / insurance / claims (bahut common, pehle glossary me nahi the)
  beema: "insurance",
  bheema: "insurance",
  bhugtan: "payment",
  anumodan: "approval",
  kataar: "queue",
  anya: "other",
  kshatigrast: "damaged",
  kshati: "damage",
  pratiksha: "wait",
  saptah: "week",
  bhandaran: "storage",
  bhagon: "parts",
  raashi: "amount",
  bakaya: "due",
  jamaraashi: "deposit",
  nivesh: "investment",
  bachat: "savings",
  karobar: "business",

  // Email / account / security (Gmail newsletters me bahut aate hain)
  prayas: "koshish",
  pushti: "confirm",
  nimnalikhit: "yeh",
  surakshit: "secure",
  khate: "account",
  khata: "account",
  pehchan: "identity",
  sandesh: "message",
  praapt: "receive",
  bhejna: "send",

  // Writing / content / AI articles
  adhikansh: "zyadatar",
  prashn: "question",
  prashno: "questions",
  uttar: "answer",
  khoj: "search",
  sanrachna: "structure",
  shaili: "style",
  gahrai: "depth",
  swar: "tone",
  niyantrit: "control",
  baatcheet: "conversation",
  antarnihit: "hidden",
  sheeghra: "quick",
  upsarg: "prefix",
  shuruaat: "start",
  irada: "intention",
  dridhta: "strongly",
  pratikriyaen: "reactions",
  shabd: "word",
  shabdon: "words",
  lekh: "article",
  lekhon: "articles",
  udaharan: "example",
  vikalp: "option",
  vikalpon: "options",
  parinaam: "result",
  parinaamon: "results",
};

// Combine all lookup tables for the hinglishify pipeline to iterate over, in order.
export const ALL_PASSES = [
  { table: FORMAL_PHRASES, phraseLevel: true },
  { table: FORMAL_WORDS, phraseLevel: false },
  { table: SPELLING_FIXES, phraseLevel: false },
  { table: ENGLISH_GLOSSARY, phraseLevel: false },
];
