// test/google-batch.test.mjs — Basic mode (Google Translate) ki batching.
// Live bug (31 Oct 2026): PDF me aadhe sentence pe tooti lines bhejne pe Google
// split marker ko jod/hata deta tha, aur POORI batch fail hoke page English reh
// jaata tha. Ab batch aadhi-aadhi tootkar dobara jaati hai.
//   node test/google-batch.test.mjs

import { translateGoogleRaw } from "../background.js";

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass++;
  else {
    fail++;
    console.log(`FAIL (${name}):\n  expected: ${e}\n  actual:   ${a}\n`);
  }
}

// Fake Google: har text ko "R(text)" bana deta hai. "BREAK" wale text ke saath
// koi aur text ho to marker gira deta hai (asli Google jaisa), akele pe theek.
// "DEAD" wala text kabhi translate nahi hota.
let calls = 0;
globalThis.fetch = async (url) => {
  calls++;
  const q = new URL(url).searchParams.get("q");
  const pieces = q.split(" zzsplitzz ");
  let roman;
  if (pieces.some((p) => p.includes("DEAD"))) roman = "";
  else if (pieces.length > 1 && pieces.some((p) => p.includes("BREAK"))) roman = pieces.map((p) => `R(${p})`).join(" ");
  else roman = pieces.map((p) => `R(${p})`).join(" zzsplitzz ");
  return { ok: true, json: async () => [[["x", q]], [null, null, roman]] };
};

calls = 0;
check("normal batch: ek hi request", await translateGoogleRaw(["a", "b", "c"]), ["R(a)", "R(b)", "R(c)"]);
check("normal batch request count", calls, 1);

check(
  "BUG FIX: ek segment marker tode to baaki sab phir bhi translate",
  await translateGoogleRaw(["a", "b BREAK", "c", "d"]),
  ["R(a)", "R(b BREAK)", "R(c)", "R(d)"]
);

check(
  "jo segment akela bhi fail ho sirf wahi null",
  await translateGoogleRaw(["a", "DEAD", "c"]),
  ["R(a)", null, "R(c)"]
);

check("khaali list", await translateGoogleRaw([]), []);

console.log(`\n${pass}/${pass + fail} passed.`);
if (fail > 0) process.exit(1);
