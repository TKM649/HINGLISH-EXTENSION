// test/google-parser.test.mjs — Google Translate ke asli (live-captured) responses
// ke against parser test karta hai. Yeh responses `translate.googleapis.com` se
// live curl karke capture kiye gaye the — agar Google format badal de, yeh test
// fail ho jayega aur humein pata chal jayega.
//   node test/google-parser.test.mjs

import { extractRomanization, stripLinkMarkers } from "../background.js";

const cases = [
  {
    name: "single sentence",
    data: [[["इस तकनीक का उपयोग प्रतिदिन लाखों उपयोगकर्ता करते हैं।","This technology is used by millions of users every day.",null,null,3,null,null,[[]],[[["458941ec00fd20f22c6168237a5d2eaa","en_hi_2023q1.md"]]]],[null,null,"is takneek ka upyog pratidin lakhon upyogkarta karte han."]],null,"en",null,null,null,1,[],[["en"],null,[1],["en"]]],
    expected: "is takneek ka upyog pratidin lakhon upyogkarta karte han.",
  },
  {
    name: "multi-sentence with marker",
    data: [[["प्रौद्योगिकी और उपयोगकर्ताओं के बारे में पहला पैराग्राफ। ","First paragraph about technology and users. ",null,null,3,null,null,[[]],[[["458941ec00fd20f22c6168237a5d2eaa","en_hi_2023q1.md"]]]],["zzsplitzz ऐप डाउनलोड करने के बारे में दूसरा पैराग्राफ। ","zzsplitzz Second paragraph about downloading the app. ",null,null,3,null,null,[[]],[[["458941ec00fd20f22c6168237a5d2eaa","en_hi_2023q1.md"]]]],["zzsplitzz तीसरा अच्छा काम करने वाले उपकरणों के बारे में।","zzsplitzz Third one about devices working well.",null,null,3,null,null,[[]],[[["458941ec00fd20f22c6168237a5d2eaa","en_hi_2023q1.md"]]]],[null,null,"praudyogiki aur upyogkartaon ke baare mein pehla paragraf. zzsplitzz app download karne ke baare mein dusra paragraf. zzsplitzz teesra acha kaam karne wale upkaranon ke baare men."]],null,"en",null,null,null,1,[],[["en"],null,[1],["en"]]],
    expected: "praudyogiki aur upyogkartaon ke baare mein pehla paragraf. zzsplitzz app download karne ke baare mein dusra paragraf. zzsplitzz teesra acha kaam karne wale upkaranon ke baare men.",
  },
  { name: "empty/malformed input", data: null, expected: "" },
  { name: "missing data[1]", data: [[["a"]], null], expected: "" },
  { name: "empty array", data: [], expected: "" },
];

let pass = 0;
let fail = 0;

for (const { name, data, expected } of cases) {
  const actual = extractRomanization(data);
  if (actual === expected) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL (${name}):\n  expected: ${expected}\n  actual:   ${actual}\n`);
  }
}

// ---- stripLinkMarkers: Mode A ko <0>...</0> jaise link markers Google ko
// bhejne se pehle plain text me strip karna chahiye (Google unhe samajhta
// nahi — bhejne se translation garbled aata). Mode A me isliye links plain
// text ban jaate hain (documented trade-off, Mode B/Gemini unhe preserve
// karta hai — dekho content.js/rebuildWithLinks). ----
const stripCases = [
  ["Click <0>here</0> to download.", "Click here to download."],
  ["No markers at all here.", "No markers at all here."],
  ["<0>Start</0> and <1>end</1> both links.", "Start and end both links."],
  ["", ""],
];
let stripPass = 0;
for (const [input, expected] of stripCases) {
  const actual = stripLinkMarkers(input);
  if (actual === expected) {
    stripPass++;
  } else {
    fail++;
    console.log(`FAIL (stripLinkMarkers "${input}"):\n  expected: ${expected}\n  actual:   ${actual}\n`);
  }
}
pass += stripPass;

console.log(`\n${pass}/${cases.length + stripCases.length} passed.`);
if (fail > 0) process.exit(1);
