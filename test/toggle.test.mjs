// test/toggle.test.mjs — ON/OFF ke beech ka behavior (jsdom me, bina Chrome ke):
//   - OFF karte waqt queue me pade paragraph dobara ON pe translate hote hain
//   - OFF ke baad aaya hua jawab page ko nahi badalta, aur agli baar ON pe lagta hai
//   node test/toggle.test.mjs

import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentJsSource = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  if (actual === expected) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL (${name}):\n  expected: ${expected}\n  actual:   ${actual}\n`);
  }
}

const dom = new JSDOM(
  `<!DOCTYPE html><html><body>
    <p id="a">The first paragraph has plenty of words to translate.</p>
    <p id="b">The second paragraph also has plenty of words to translate.</p>
  </body></html>`,
  { runScripts: "dangerously", url: "https://example.com/article", pretendToBeVisual: true }
);
const { window } = dom;
const { document } = window;

// sendMessage ka jawab test khud chhodta hai (deferred), taaki "jawab aane se
// pehle OFF" jaisa timing bana sakein.
const pending = [];
window.chrome = {
  runtime: {
    sendMessage: (msg) =>
      new Promise((resolve) => {
        pending.push(() =>
          resolve({
            ok: true,
            mode: "gemini",
            results: msg.segments.map((s) => ({ id: s.id, text: `HL: ${s.text}`, ok: true })),
          })
        );
      }),
    onMessage: { addListener: () => {} },
  },
};
window.IntersectionObserver = class {
  constructor(cb) {
    this.cb = cb;
    this.targets = new Set();
    window.__lastIO = this;
  }
  observe(el) { this.targets.add(el); }
  unobserve(el) { this.targets.delete(el); }
  disconnect() { this.targets.clear(); }
};
for (const id of ["a", "b"]) {
  Object.defineProperty(document.getElementById(id), "offsetParent", { get: () => document.body, configurable: true });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inView = () => {
  const io = window.__lastIO;
  io.cb([...io.targets].map((target) => ({ target, isIntersecting: true })));
};
const answerAll = async () => {
  while (pending.length) pending.shift()();
  await sleep(80); // promise + requestAnimationFrame
};
const text = (id) => document.getElementById(id).textContent;

window.eval(contentJsSource); // ON

// 1) Dono paragraph queue me, par debounce (100ms) se pehle hi OFF
inView();
window.__hinglishToggle(); // OFF
await sleep(200);
check("OFF ke baad koi request nahi gayi", pending.length, 0);

window.__hinglishToggle(); // ON
inView();
await sleep(200);
check("BUG FIX: dobara ON pe queued paragraph request me gaye", pending.length, 1);
await answerAll();
check("paragraph a translate hua", text("a").startsWith("HL:"), true);
check("paragraph b translate hua", text("b").startsWith("HL:"), true);

// 2) Restore, phir ON -> request chal rahi ho tab OFF -> jawab aaye
window.__hinglishRestore();
window.__hinglishToggle(); // ON
inView();
await sleep(200);
check("request chal rahi hai", pending.length, 1);
window.__hinglishToggle(); // OFF
await answerAll();
check("BUG FIX: OFF ke baad aaya jawab page nahi badalta", text("a").startsWith("HL:"), false);

window.__hinglishToggle(); // ON
inView();
await sleep(200);
await answerAll();
check("agli baar ON pe wahi paragraph translate hota hai", text("a").startsWith("HL:"), true);

console.log(`\n${pass}/${pass + fail} passed.`);
if (fail > 0) process.exit(1);
