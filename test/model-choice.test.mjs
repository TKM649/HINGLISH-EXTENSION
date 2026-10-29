// test/model-choice.test.mjs — model selection ka test.
//
// Yeh wahi bug tha jiski wajah se pehli hi request pe "limit khatam" aa raha tha:
// purana code ListModels se jo bhi pehla "flash-lite" milta tha wahi utha leta tha,
// aur wo aksar koi preview/experimental model hota hai jiska FREE QUOTA ZERO hota hai.
//   node test/model-choice.test.mjs

import { chooseModelName, rankModels } from "../background.js";

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  if (actual === expected) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL (${name}):\n  expected: ${expected}\n  actual:   ${actual}`);
  }
}

const gen = ["generateContent"];
const m = (name, methods = gen) => ({ name, supportedGenerationMethods: methods });

// Asli bug: preview model pehle aata hai list me, purana code usse chun leta tha
check(
  "preview models skip hote hain, stable flash-lite chunta hai",
  chooseModelName([
    m("models/gemini-3.5-flash-lite-preview-11-2025"),
    m("models/gemini-2.5-flash-lite"),
  ]),
  "models/gemini-2.5-flash-lite"
);

check(
  "experimental/exp models skip hote hain",
  chooseModelName([m("models/gemini-2.0-flash-exp"), m("models/gemini-2.5-flash")]),
  "models/gemini-2.5-flash"
);

check(
  "thinking variants skip hote hain",
  chooseModelName([m("models/gemini-2.5-flash-thinking"), m("models/gemini-2.5-flash")]),
  "models/gemini-2.5-flash"
);

check(
  "image/audio/tts/embedding models kabhi nahi chunte",
  chooseModelName([
    m("models/gemini-2.5-flash-image"),
    m("models/text-embedding-004"),
    m("models/gemini-2.5-flash-tts"),
    m("models/gemini-2.5-flash"),
  ]),
  "models/gemini-2.5-flash"
);

check(
  "flash-lite ko flash se pehle preference milti hai (zyada free quota)",
  chooseModelName([m("models/gemini-2.5-flash"), m("models/gemini-2.5-flash-lite")]),
  "models/gemini-2.5-flash-lite"
);

check(
  "pro models ko flash se upar kabhi nahi chunte (free quota bahut kam)",
  chooseModelName([m("models/gemini-2.5-pro"), m("models/gemini-2.5-flash")]),
  "models/gemini-2.5-flash"
);

check(
  "generateContent support na karne wale models filter hote hain",
  chooseModelName([m("models/gemini-2.5-flash-lite", ["embedContent"]), m("models/gemini-2.5-flash")]),
  "models/gemini-2.5-flash"
);

check("khaali list pe null", chooseModelName([]), null);
check("null input pe null", chooseModelName(null), null);

check(
  "sirf pro available ho to wahi chun lo (kuch na hone se behtar)",
  chooseModelName([m("models/gemini-2.5-pro")]),
  "models/gemini-2.5-pro"
);

// ---- ASLI USER CASE ----
// Yeh exact list user ke account pe available thi. Purana code
// "models/gemini-2.0-flash-lite-001" chunta tha, jiska free quota LITERALLY 0 hai
// (Google ka error: "limit: 0, model: gemini-2.0-flash-lite") — isliye pehli hi
// request pe 429 aata tha.
const REAL_USER_MODELS = [
  m("models/gemini-2.5-flash"),
  m("models/gemini-2.5-pro"),
  m("models/gemini-2.0-flash"),
  m("models/gemini-2.0-flash-001"),
  m("models/gemini-2.0-flash-lite-001"),
  m("models/gemini-2.0-flash-lite"),
  m("models/gemini-2.5-flash-preview-tts"),
  m("models/gemini-2.5-pro-preview-tts"),
];

// 23 Oct 2026 se rule badla: TYPE pehle (lite > flash > pro), phir version.
// Is purani list pe ab dead 2.0-flash-lite pehle aata hai — callGemini() usse
// runtime pe skip karta hai (429 / 404 / timeout -> agla model). Yahan sirf
// order check hota hai, taaki fallback sahi model pe jaaye.
check(
  "REAL USER CASE (Jul): same type me naya version pehle (2.5-flash > 2.0-flash)",
  rankModels(REAL_USER_MODELS).indexOf("models/gemini-2.5-flash") <
    rankModels(REAL_USER_MODELS).indexOf("models/gemini-2.0-flash"),
  true
);

check(
  "REAL USER CASE (Jul): saare flash, pro se pehle (pro last fallback)",
  rankModels(REAL_USER_MODELS).at(-1),
  "models/gemini-2.5-pro"
);

// ---- ASLI USER CASE (23 Oct 2026) ----
// Yeh list ek asli free key pe live mili. Purana "version pehle" rule
// gemini-3.8-flash chunta tha: "minimal" thinking pe 400, aur bina thinking
// 20 segments me 86s. gemini-3.5-flash-lite ne wahi kaam 3.2s me kiya.
const OCT_USER_MODELS = [
  m("models/gemini-2.5-flash"),
  m("models/gemini-3.8-flash"),
  m("models/gemini-3.7-flash"),
  m("models/gemini-3.6-flash"),
  m("models/gemini-3.5-flash-lite"),
  m("models/gemini-3.5-flash"),
  m("models/gemini-2.5-flash-lite"),
];

check(
  "REAL USER CASE (Oct): gemini-3.5-flash-lite chunta hai, slow 3.8-flash nahi",
  chooseModelName(OCT_USER_MODELS),
  "models/gemini-3.5-flash-lite"
);

check(
  "REAL USER CASE (Oct): lite ke baad sabse naya flash fallback hai",
  rankModels(OCT_USER_MODELS).slice(0, 3).join(","),
  "models/gemini-3.5-flash-lite,models/gemini-2.5-flash-lite,models/gemini-3.8-flash"
);

check(
  "plain naam numbered variant se upar (gemini-2.0-flash > gemini-2.0-flash-001)",
  rankModels([m("models/gemini-2.0-flash-001"), m("models/gemini-2.0-flash")])[0],
  "models/gemini-2.0-flash"
);

check(
  "ranked list me tts/preview kabhi nahi aate",
  rankModels(REAL_USER_MODELS).some((n) => /tts|preview/.test(n)),
  false
);

console.log(`\n${pass}/${pass + fail} passed.`);
if (fail > 0) process.exit(1);
