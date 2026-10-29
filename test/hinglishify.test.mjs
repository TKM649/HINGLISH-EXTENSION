// test/hinglishify.test.mjs — Node se chalti hai, Chrome ki zarurat nahi:
//   node test/hinglishify.test.mjs

import { hinglishify } from "../hinglishify.js";

const cases = [
  // [input (Google ka raw romanized output), expected output]
  ["is takneek ka upyog pratidin lakhon upyogkarta karte han.", "is technology ka use roz lakhon user karte hain."],
  ["company ne ek naye feature ki ghoshana ki hai.", "company ne ek naye feature ki ghoshana ki hai."],
  ["yah sabhi device par kaam karta hai.", "yeh sabhi device par kaam karta hai."],
  ["praudyogiki aur upyogkartaon ke baare mein pehla paragraf.", "technology aur users ke baare mein pehla paragraf."],
  ["is suvidha ka upyog kiya jata hai.", "is feature ka use hota hai."],
  ["yah tatha vah dono sahi hain.", "yeh aur woh dono sahi hain."],
  ["hum yah kaam parantu savdhani se karenge.", "hum yeh kaam lekin savdhani se karenge."],
  ["kyonki bahut log nahin jaante.", "kyunki bohot log nahi jaante."],
  ["Yah ek accha din hai.", "Yeh ek accha din hai."], // capitalization preserved
  ["is anuprayog ko avashyak update mila.", "is app ko zaroori update mila."],
  // Words jo glossary me NAHI hain unhe chhoo mat — plain pass-through
  ["mausam bohot accha hai aaj.", "mausam bohot accha hai aaj."],

  // Real user-reported case: insurance article Devanagari-Hindi jaisa lag raha tha
  ["10,000 anya logon ke peeche beema anumodan kataar mein atka hua hai.", "10,000 other logon ke peeche insurance approval queue mein atka hua hai."],
  ["mike bhandaran ke liye prati din $15 ka bhugtan kar raha hai.", "mike storage ke liye roz $15 ka payment kar raha hai."],
  ["teen aur kshatigrast kaaren bahar khadi hain.", "teen aur damaged kaaren bahar khadi hain."],
  ["pratiksha mein teen saptah lagte hain.", "wait mein teen week lagte hain."],

  // Real user-reported case 2: Instagram security email + ChatGPT article
  ["kisi ne aapke instagram profile mein log in karne ka prayas kiya.", "kisi ne aapke instagram profile mein log in karne ka koshish kiya."],
  ["yadi yeh aap the, to kripya apni pehchan ki pushti karen.", "agar yeh aap the, to please apni identity ki confirm karen."],
  ["apne khate ko surakshit karne ke liye.", "apne account ko secure karne ke liye."],
  ["adhikansh log chatgpt ka use ek khoj box ki tarah karte hain.", "zyadatar log chatgpt ka use ek search box ki tarah karte hain."],
  ["ek prashn type karen. uttar payen.", "ek question type karen. answer payen."],
  ["uttar ki shaili, gahrai, swar aur sanrachna ko badal sakta hai.", "answer ki style, depth, tone aur structure ko badal sakta hai."],
];

let pass = 0;
let fail = 0;

for (const [input, expected] of cases) {
  const actual = hinglishify(input);
  if (actual === expected) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL:\n  input:    ${input}\n  expected: ${expected}\n  actual:   ${actual}\n`);
  }
}

console.log(`\n${pass}/${cases.length} passed.`);
if (fail > 0) process.exit(1);
