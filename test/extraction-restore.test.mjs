// test/extraction-restore.test.mjs — content.js ke DOM-level behavior ko
// jsdom (asli browser jaisa DOM, bina Chrome ke) me test karta hai:
//   - Sahi blocks pick hote hain, galat wale skip hote hain
//   - restore() ke baad DOM EXACTLY original jaisa ban jata hai
//
// Note: yeh test jsdom devDependency use karta hai (`npm install`) — sirf
// testing ke liye, shipped extension isse bilkul touch nahi karta.
//   node test/extraction-restore.test.mjs

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

const SAMPLE_HTML = `<!DOCTYPE html><html><body>
  <p id="good1">This is a normal paragraph with enough words to be translated.</p>
  <p id="short">Hi.</p>
  <pre><code id="codeblock">const x = 1;</code></pre>
  <div contenteditable="true"><p id="editable">This looks normal but is inside a contenteditable area.</p></div>
  <p id="hidden1" style="display:none">This paragraph is hidden and should not be picked up at all.</p>
  <div><p id="nested-good">Wikipedia is a free online encyclopedia edited by volunteers worldwide.</p></div>
  <script id="scripttag">var shouldNeverRun = 1;</script>
  <table><tbody><tr>
    <td id="gmailrow">
      <span>Sender Name</span><span>Subject line preview text here</span>
      <span>Snippet of the email body continues</span><span>Labels</span><span>5:32 PM</span>
    </td>
  </tr></tbody></table>
  <p id="truncated" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
    This single line UI text should never be touched because it will overflow.
  </p>
  <p id="withlink">Click <a id="thelink" href="https://example.com/download" class="btn">here</a> to download the file for free right now.</p>
  <!-- Wellfound jaisa layout (23 Oct 2026 bug): text seedha div/span me, <p> nahi -->
  <div id="tagwrap"><span id="tagline">Delivering the best in-cab experience for drivers</span></div>
  <div id="divpara">Through the development of a first of its kind open platform, Platform Science provides <b id="divbold">hardware and software</b> for clients.</div>
  <div id="chip"><svg id="chipicon"></svg><span id="chiptext">Internet of Things industry</span></div>
  <button id="btn"><span id="btnspan">Sign up for free now</span></button>
</body></html>`;

// pretendToBeVisual: jsdom by default requestAnimationFrame implement nahi
// karta (isse applyResults() andar hi silently fail ho jaata, aur poora
// link-rebuild code kabhi test hi nahi hota) — real Chrome me rAF hamesha
// hota hai, yeh sirf test environment ko usse match karne ke liye hai.
const dom = new JSDOM(SAMPLE_HTML, {
  runScripts: "dangerously",
  url: "https://example.com/article",
  pretendToBeVisual: true,
});
const { window } = dom;
const { document } = window;

// ---- Mocks: chrome APIs aur IntersectionObserver (jsdom in dono ko implement nahi karta) ----
let sentMessages = [];
window.chrome = {
  runtime: {
    // Realistic fake backend: agar ek segment ke text me link marker (<0>...</0>)
    // hai, translated response me bhi preserve karke bhejta hai — bilkul jaisa
    // Gemini karta hai. Isse hum poora asli pipeline (extraction -> queue ->
    // network -> DOM rebuild) test kar sakte hain, sirf function-level nahi.
    sendMessage: (msg) => {
      sentMessages.push(msg);
      const results = msg.segments.map((s) => {
        const hasLink = /<\d+>.*<\/\d+>/.test(s.text);
        const text = hasLink
          ? s.text.replace(/<(\d+)>(.*?)<\/\1>/g, (_, i, inner) => `<${i}>${inner} (translated)</${i}>`) +
            " TRANSLATED"
          : `TRANSLATED: ${s.text}`;
        return { id: s.id, text };
      });
      return Promise.resolve({ ok: true, mode: "gemini", results });
    },
    onMessage: { addListener: () => {} },
  },
};
window.IntersectionObserver = class {
  constructor(cb) {
    this.cb = cb;
    window.__lastIO = this; // test hook: manually fire "segment scrolled into view"
  }
  observe() {}
  unobserve() {}
  disconnect() {}
};

// ---- "Visible" simulate karo (jsdom layout nahi karta, offsetParent hamesha
// null hota hai by default — jo naturally hidden elements ke liye sahi hai,
// lekin visible elements ke liye humein manually override karna padega) ----
for (const id of ["good1", "nested-good", "editable", "gmailrow", "truncated", "withlink",
  "tagwrap", "tagline", "divpara", "chip", "chiptext", "btnspan"]) {
  Object.defineProperty(document.getElementById(id), "offsetParent", {
    get: () => document.body,
    configurable: true,
  });
}

const originalBodyHTML = document.body.innerHTML;

// ---- content.js run karo isi window context me ----
window.eval(contentJsSource);

// ---- Extraction checks ----
check("good1 (normal paragraph) picked up", !!document.getElementById("good1").dataset.hlId, true);
check("nested-good (inside div) picked up", !!document.getElementById("nested-good").dataset.hlId, true);
check("short paragraph (<3 words) skipped", !!document.getElementById("short").dataset.hlId, false);
check("code block skipped", !!document.getElementById("codeblock").dataset.hlId, false);
check("contenteditable content skipped", !!document.getElementById("editable").dataset.hlId, false);
check("hidden (display:none) paragraph skipped", !!document.getElementById("hidden1").dataset.hlId, false);
check("Gmail-style dense row (many child spans) skipped — layout-break bug fix", !!document.getElementById("gmailrow").dataset.hlId, false);
check("single-line truncated (nowrap+ellipsis) text skipped — layout-break bug fix", !!document.getElementById("truncated").dataset.hlId, false);
check("BUG FIX: div me seedha paragraph picked up (Wellfound case)", !!document.getElementById("divpara").dataset.hlId, true);
check("BUG FIX: span me tagline picked up", !!document.getElementById("tagline").dataset.hlId, true);
check("tagline ka wrapper div alag se nahi uthta (double translate nahi)", !!document.getElementById("tagwrap").dataset.hlId, false);
check("div ke andar ka <b> alag segment nahi banta", !!document.getElementById("divbold").dataset.hlId, false);
check("icon wala chip: div nahi (icon mit jaata), andar ka span hi", !!document.getElementById("chip").dataset.hlId + "/" + !!document.getElementById("chiptext").dataset.hlId, "false/true");
check("button ke andar ka text skip (UI controls nahi chhedte)", !!document.getElementById("btnspan").dataset.hlId, false);
check("Gmail row ke andar ke span bhi skip rehte hain", document.querySelectorAll("#gmailrow [data-hl-id]").length, 0);
check("paragraph with a link picked up", !!document.getElementById("withlink").dataset.hlId, true);

// ---- Link preservation: real bug tha ki translate hone ke baad <a> plain
// text ban jaata tha (blue color aur click dono chale jaate the). Poore
// pipeline se test karte hain — segment ko "viewport me aaya" simulate karo,
// debounce timer ka wait karo, phir DOM check karo. ----
await (async () => {
  window.__lastIO.cb([{ isIntersecting: true, target: document.getElementById("withlink") }]);
  await new Promise((resolve) => setTimeout(resolve, 400)); // BATCH_DEBOUNCE_MS (250) se zyada

  const rebuiltLink = document.querySelector("#withlink a");
  check("BUG FIX: link survives translation as a real <a> element", !!rebuiltLink, true);
  check(
    "BUG FIX: link keeps its original href (color/click both depend on this existing)",
    rebuiltLink?.getAttribute("href"),
    "https://example.com/download"
  );
  check("BUG FIX: link keeps its original class (styling)", rebuiltLink?.className, "btn");
  check("link label reflects translated text, not the raw marker", rebuiltLink?.textContent, "here (translated)");
  check(
    "surrounding text is translated too, marker syntax not visible to user",
    document.getElementById("withlink").textContent.includes("<0>"),
    false
  );
})();

// ---- Restore round-trip: DOM ko EXACTLY original jaisa hona chahiye ----
window.__hinglishRestore();
check("restore() → body innerHTML exactly matches original", document.body.innerHTML, originalBodyHTML);

// ---- Toggle re-inject guard: dobara eval karne pe crash nahi hona chahiye ----
let threw = false;
try {
  window.eval(contentJsSource); // re-inject jaisa popup karta hai
} catch {
  threw = true;
}
check("re-injecting content.js does not throw", threw, false);

console.log(`\n${pass}/${pass + fail} passed.`);
if (fail > 0) process.exit(1);
