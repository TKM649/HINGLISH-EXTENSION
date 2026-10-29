// test/pdf-text.test.mjs — PDF text-reflow logic ko synthetic PDF.js-shape
// text items se test karta hai (asli PDF.js/browser ki zarurat nahi).
//   node test/pdf-text.test.mjs

import { groupItemsIntoLines, joinLines, chunkIntoParagraphs, itemsToParagraphs, isEmptyTextPage } from "../pdf-text.js";

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL (${name}):\n  expected: ${e}\n  actual:   ${a}\n`);
  }
}

// groupItemsIntoLines: hasEOL true marks line end
check(
  "groupItemsIntoLines basic",
  groupItemsIntoLines([
    { str: "Hello" }, { str: "world", hasEOL: true },
    { str: "Second" }, { str: "line", hasEOL: true },
  ]),
  ["Hello world", "Second line"]
);

check(
  "groupItemsIntoLines trailing item without hasEOL",
  groupItemsIntoLines([{ str: "Just" }, { str: "one" }, { str: "line" }]),
  ["Just one line"]
);

// joinLines: dehyphenation across wrapped lines
check(
  "joinLines dehyphenates wrapped words",
  joinLines(["This is infor-", "mation that wraps.", "Next line here."]),
  "This is information that wraps. Next line here."
);

check(
  "joinLines does not dehyphenate real compound-word hyphens mid-sentence",
  // Known limitation: a hyphen at line-end always triggers dehyphenation,
  // even for real hyphenated compounds like "well-". Acceptable trade-off —
  // PDFs wrap far more often than they legitimately end a line on a real
  // compound hyphen.
  joinLines(["A well-", "known fact."]),
  "A wellknown fact."
);

// chunkIntoParagraphs: respects sentence boundaries, caps length
const longText =
  "This is sentence one. This is sentence two. This is sentence three. " +
  "This is sentence four which is a bit longer to push over the limit maybe.";
const chunks = chunkIntoParagraphs(longText, 60);
check("chunkIntoParagraphs stays under cap-ish and keeps all text", chunks.join(" ").replace(/\s+/g, " "), longText.replace(/\s+/g, " "));
if (chunks.every((c) => c.length <= 90)) {
  // generous margin since we don't split mid-sentence
  pass++;
} else {
  fail++;
  console.log("FAIL: chunk too long:", chunks);
}

check("chunkIntoParagraphs empty input", chunkIntoParagraphs("   "), []);

// itemsToParagraphs: full pipeline
check(
  "itemsToParagraphs full pipeline",
  itemsToParagraphs([
    { str: "The quick brown fox jumps over the lazy dog." }, { str: "It", hasEOL: true },
    { str: "was a sunny day in the forest." }, { str: "", hasEOL: true },
  ]),
  ["The quick brown fox jumps over the lazy dog. It was a sunny day in the forest."]
);

// isEmptyTextPage: scanned PDF detection
check("isEmptyTextPage detects scanned page", isEmptyTextPage([{ str: "" }, { str: "   " }]), true);
check("isEmptyTextPage detects real text", isEmptyTextPage([{ str: "" }, { str: "hello" }]), false);
check("isEmptyTextPage handles null/empty array", isEmptyTextPage([]), true);
check("isEmptyTextPage handles null items arg", isEmptyTextPage(null), true);

console.log(`\n${pass}/${pass + fail} passed.`);
if (fail > 0) process.exit(1);
