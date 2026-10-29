// test/gemini-parser.test.mjs — Gemini response parser ke edge cases test karta hai
// (koi API call nahi, sirf synthetic responses).
//   node test/gemini-parser.test.mjs

import { parseGeminiResponse } from "../gemini.js";

function mkResponse(text) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

const cases = [
  {
    name: "valid response, all ids match",
    response: mkResponse(JSON.stringify([{ id: "a", text: "yeh hai" }, { id: "b", text: "woh hai" }])),
    ids: ["a", "b"],
    expectOk: true,
  },
  {
    name: "broken JSON",
    response: mkResponse("{not valid json"),
    ids: ["a"],
    expectOk: false,
  },
  {
    name: "empty text",
    response: mkResponse(""),
    ids: ["a"],
    expectOk: false,
  },
  {
    name: "missing candidates entirely",
    response: {},
    ids: ["a"],
    expectOk: false,
  },
  {
    name: "missing an id",
    response: mkResponse(JSON.stringify([{ id: "a", text: "yeh hai" }])),
    ids: ["a", "b"],
    expectOk: false,
  },
  {
    name: "extra unexpected id",
    response: mkResponse(JSON.stringify([{ id: "a", text: "yeh hai" }, { id: "z", text: "??" }])),
    ids: ["a"],
    expectOk: false,
  },
  {
    name: "not an array (single object)",
    response: mkResponse(JSON.stringify({ id: "a", text: "yeh hai" })),
    ids: ["a"],
    expectOk: false,
  },
  {
    name: "item missing text field",
    response: mkResponse(JSON.stringify([{ id: "a" }])),
    ids: ["a"],
    expectOk: false,
  },
  {
    name: "duplicate ids in response (last wins, still passes if set matches)",
    response: mkResponse(JSON.stringify([{ id: "a", text: "first" }, { id: "a", text: "second" }])),
    ids: ["a"],
    expectOk: true,
  },
];

let pass = 0;
let fail = 0;

for (const { name, response, ids, expectOk } of cases) {
  const result = parseGeminiResponse(response, ids);
  if (result.ok === expectOk) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL (${name}): expected ok=${expectOk}, got`, result);
  }
}

// Extra check: duplicate-id case should keep the LAST occurrence's text
const dupResult = parseGeminiResponse(
  mkResponse(JSON.stringify([{ id: "a", text: "first" }, { id: "a", text: "second" }])),
  ["a"]
);
if (dupResult.ok && dupResult.results[0].text === "second") {
  pass++;
} else {
  fail++;
  console.log("FAIL (duplicate id keeps last value):", dupResult);
}

console.log(`\n${pass}/${pass + fail} passed.`);
if (fail > 0) process.exit(1);
