// test/formatting.test.mjs — 29 Oct 2026 bug: translate ke baad bold, italic,
// underline, heading ka span, link, image, <br> sab plain text ban jaate the.
// Yeh test poora pipeline (collect -> fake backend -> render -> restore) jsdom
// me chalata hai aur check karta hai ki:
//   - formatting tags ASLI objects ke roop me wapas aate hain (copy nahi)
//   - har node sach me translate hua (warna "bold bacha" test bekaar pass hota)
//   - fail / toote markers / stale text pe node bigadta nahi
//   - restore ke baad DOM aur objects bilkul original
//   node test/formatting.test.mjs

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

const HTML = `<!DOCTYPE html><html><body>
  <p id="bold">This has <b id="b1">bold words</b> and <i id="i1">italic text</i> and <u>underlined bit</u> inside.</p>
  <h2 id="head"><span id="headspan" class="headline">History of the old region</span></h2>
  <p id="nest">Read the <a id="na" href="/story"><strong id="ns">full story</strong> here</a> today please.</p>
  <p id="img"><img id="im" src="x.png"> Some words here<br id="brk">and more words after.</p>
  <p id="code">Run <code id="c1">npm install</code> to set everything up now.</p>
  <p id="failp">This block will <b id="fb">fail</b> in the backend completely.</p>
  <p id="broken"><img id="bim" src="y.png">Markers come back <b>broken</b> from the model here.</p>
  <p id="dropped">Model drops <em>every single</em> marker from this one <img id="dim" src="z.png"></p>
  <p id="stale">This text will <b>change</b> before the result arrives.</p>
  <p id="collide">Math says x <3> y and also <b id="cb">bold</b> right here.</p>
  <p id="reorder">The <b id="r0">first</b> and the <i id="r1">second</i> swap places.</p>
  <p id="dup">Duplicate <a id="dupa" href="/d">link text</a> appears twice in output.</p>
  <ul><li id="stretch"><a id="sa" href="/news">Breaking news</a> from the capital city today.</li></ul>
  <h3 id="codeonly"><code>someFunctionName()</code></h3>
  <p id="hidden" style="display:none">Hidden paragraph should never be touched by us.</p>
</body></html>`;

const dom = new JSDOM(HTML, {
  runScripts: "dangerously",
  url: "https://example.com/article",
  pretendToBeVisual: true,
});
const { window } = dom;
const { document } = window;

// jsdom layout nahi karta. Har element ko visible maano jab tak koi ancestor
// display:none na ho — taaki naya test node "id list me daalna bhool gaye"
// wajah se chup-chaap skip na ho.
Object.defineProperty(window.HTMLElement.prototype, "offsetParent", {
  get() {
    return this.closest('[style*="display:none"]') ? null : document.body;
  },
  configurable: true,
});

// Fake backend: default me har text-run ko UPPERCASE karta hai aur markers
// hubahu rakhta hai (jaise Gemini karta hai). Kuch ids ke liye alag behavior.
const sent = new Map(); // node id -> source text jo bheja gaya
const behaviors = {}; // node id -> (text) => {text, ok}
const idOf = (segId) => document.querySelector(`[data-hl-id="${segId}"]`)?.id;
const upper = (t) => t.replace(/(^|>)([^<]*)/g, (_, a, b) => a + b.toUpperCase());

window.chrome = {
  runtime: {
    sendMessage: (msg) => {
      const results = msg.segments.map((s) => {
        const nodeId = idOf(s.id);
        sent.set(nodeId, s.text);
        const fn = behaviors[nodeId];
        const out = fn ? fn(s.text) : { text: upper(s.text), ok: true };
        return { id: s.id, ...out };
      });
      return Promise.resolve({ ok: true, mode: "gemini", results });
    },
    onMessage: { addListener: () => {} },
  },
};
window.IntersectionObserver = class {
  constructor(cb) {
    this.cb = cb;
    window.__lastIO = this;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
};

behaviors.failp = (t) => ({ text: t.replace(/<[^>]+>/g, ""), ok: false });
behaviors.broken = () => ({ text: "<0/>MARKERS AATE HAIN <1>TOOTE</2> MODEL SE.", ok: true });
behaviors.dropped = () => ({ text: "Model ne har marker gira diya is wale me", ok: true });
behaviors.reorder = () => ({ text: "<1>DOOSRA</1> aur <0>PEHLA</0> jagah badalte hain.", ok: true });
// Exact Google output jo live mila (29 Oct 2026): link poori line pe phail gaya
behaviors.stretch = () => ({ text: "<0>aaj rajdhani shahar se breaking news</0>.", ok: true });
behaviors.dup = () => ({ text: "<0>LINK</0> do baar: <0>LINK</0> output me.", ok: true });

const originalBodyHTML = document.body.innerHTML;
const refs = {
  b1: document.getElementById("b1"),
  headspan: document.getElementById("headspan"),
  na: document.getElementById("na"),
  ns: document.getElementById("ns"),
  im: document.getElementById("im"),
  c1: document.getElementById("c1"),
  fb: document.getElementById("fb"),
  dupa: document.getElementById("dupa"),
};
let clicked = 0;
refs.na.addEventListener("click", (e) => {
  e.preventDefault();
  clicked++;
});

window.eval(contentJsSource);

const $ = (id) => document.getElementById(id);
const translated = (id) => $(id).classList.contains("hinglish-done");

// Pehle site ka "stale" text badlo (segment collect ho chuka, result baad me aayega)
const allIds = ["bold", "head", "nest", "img", "code", "failp", "broken", "dropped", "stale",
  "collide", "reorder", "dup", "stretch"];
for (const id of allIds) check(`${id} collected`, !!$(id).dataset.hlId, true);
check("code-only heading skipped (kuch translate karne layak nahi)", !!$("codeonly").dataset.hlId, false);
check("hidden paragraph skipped", !!$("hidden").dataset.hlId, false);

window.__lastIO.cb(allIds.map((id) => ({ isIntersecting: true, target: $(id) })));
$("stale").querySelector("b").textContent = "changed by the site";
// Fixed 300ms sleep flaky tha (PC pe load ho to results der se aate the).
// Ab tab tak ruko jab tak har segment bheja ja chuka ho aur render ho gaya ho.
const waitUntil = async (cond, ms = 5000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
};
await waitUntil(() => sent.size >= allIds.length && $("stretch").classList.contains("hinglish-done"));
await new Promise((r) => setTimeout(r, 100)); // aakhri requestAnimationFrame

// ---- Bold / italic / underline ----
check("bold block translated", translated("bold"), true);
check("bold: same <b> object kept (listeners/React safe)", $("bold").contains(refs.b1), true);
check("bold: <b> text translated", refs.b1.textContent, "BOLD WORDS");
check("italic kept", $("i1")?.textContent, "ITALIC TEXT");
check("underline kept", $("bold").querySelector("u")?.textContent, "UNDERLINED BIT");
check("no marker visible in bold block", /<\/?\d/.test($("bold").textContent), false);

// ---- Heading ka andar wala span: wrapper ke andar utar ke, bina marker ----
check("heading translated", translated("head"), true);
check("heading sent without markers (single wrapper)", sent.get("head"), "History of the old region");
check("heading span object + class kept", $("head").firstElementChild === refs.headspan && refs.headspan.className, "headline");
check("heading span text translated", refs.headspan.textContent, "HISTORY OF THE OLD REGION");

// ---- Link ke andar bold (nested) ----
check("nested sent with nested markers", sent.get("nest"), "Read the <0><1>full story</1> here</0> today please.");
check("nested: link same object, href kept", $("nest").contains(refs.na) && refs.na.getAttribute("href"), "/story");
check("nested: strong still inside link", refs.na.contains(refs.ns), true);
check("nested: strong text translated", refs.ns.textContent, "FULL STORY");
refs.na.click();
check("nested: site click listener still works", clicked, 1);

// ---- Image aur <br> ----
check("img block translated", translated("img"), true);
check("img: same <img> object kept", $("img").contains(refs.im), true);
check("br kept", !!$("img").querySelector("br"), true);
check("img block text", $("img").textContent.trim(), "SOME WORDS HEREAND MORE WORDS AFTER.");

// ---- Inline code: translate nahi hota, bheja bhi nahi jaata ----
check("code text never sent", sent.get("code").includes("npm install"), false);
check("code element kept unchanged", $("code").contains(refs.c1) && refs.c1.textContent, "npm install");
check("code block surrounding text translated", $("code").textContent.includes("RUN"), true);

// ---- Fail: node bilkul nahi chhedna ----
check("ok:false: node not marked translated", translated("failp"), false);
check("ok:false: <b> still there, original text", $("failp").contains(refs.fb) && refs.fb.textContent, "fail");

// ---- Toote markers: text dikhe, image bache, koi "<" na dikhe ----
check("broken markers: translated", translated("broken"), true);
check("broken markers: no marker syntax visible", /[<>]/.test($("broken").textContent), false);
check("broken markers: image kept at start", $("broken").firstChild === $("bim"), true);

// ---- Markers gira diye: text plain, image apni jagah (end) ----
check("dropped markers: text shown", $("dropped").textContent.includes("Model ne har marker gira diya"), true);
check("dropped markers: image kept at end", $("dropped").lastChild === $("dim"), true);

// ---- Stale: site ne beech me text badla — purana translation mat likho ----
check("stale: not overwritten", $("stale").textContent.includes("changed by the site"), true);
check("stale: not marked translated", translated("stale"), false);

// ---- Page me pehle se "<3>" — marker mode band, takraav nahi ----
check("collision: no markers sent", /<0>/.test(sent.get("collide")), false);
check("collision: literal <3> survives as text", $("collide").textContent.includes("<3>"), true);

// ---- Model ne word order badla ----
check("reorder: <i> first now", $("reorder").firstElementChild?.id, "r1");
check("reorder: texts follow their tags", $("r0").textContent + "|" + $("r1").textContent, "PEHLA|DOOSRA");

// ---- Duplicate number: dusri copy clone ----
check("dup: two links rendered", $("dup").querySelectorAll("a").length, 2);
check("dup: original link object is one of them", $("dup").contains(refs.dupa), true);

// ---- Google ne link ko poori line pe phaila diya — line link nahi banni chahiye ----
check("stretch: translated", translated("stretch"), true);
check("stretch: stretched link removed (text only)", $("stretch").querySelectorAll("a").length, 0);
check("stretch: text shown", $("stretch").textContent, "aaj rajdhani shahar se breaking news.");

// ---- Restore: DOM aur objects bilkul original ----
window.__hinglishRestore();
// "stale" wala badlaav site ne khud kiya tha — restore use nahi palatna chahiye.
check(
  "restore: body HTML exactly original",
  document.body.innerHTML,
  originalBodyHTML.replace("<b>change</b>", "<b>changed by the site</b>")
);
for (const [name, el] of Object.entries(refs)) {
  check(`restore: original ${name} object back in page`, document.body.contains(el), true);
}
check("restore: <strong> back inside link", refs.na.contains(refs.ns), true);

console.log(`\n${pass}/${pass + fail} passed.`);
if (fail > 0) process.exit(1);
