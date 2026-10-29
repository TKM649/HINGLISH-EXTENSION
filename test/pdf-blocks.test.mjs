// test/pdf-blocks.test.mjs — PDF mode ka formatting-aware pipeline (29 Oct
// 2026): headings, bold/italic runs, asli paragraph breaks, aur markers.js
// parser. Item shapes "48 Laws of Power" ke page 24/25/30 se copy kiye hain
// (body 15pt, headings 21/30pt, indent x=87 vs margin 72).
//   node test/pdf-blocks.test.mjs

import {
  itemsToLines, linesToBlocks, blockSource, normalizeItems, fontStyleFromName,
  addSizeHistogram, bodySizeFrom, pageTocInfo, buildToc,
} from "../pdf-text.js";
import { parseMarkers, stripMarkers, isStretched, treeTextLength } from "../markers.js";

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

const it = (str, x, y, size = 15, extra = {}) => ({
  str, x, y, size, width: str.length * size * 0.4, hasEOL: false, bold: false, italic: false, ...extra,
});
const text = (b) => b.runs.map((r) => r.text).join("");

// ---- Page 24 jaisa: heading, heading, italic/regular mix, bold heading, indented paras ----
// Asli page jaisi geometry: page 612 wide, text 72..540. Centered = dono taraf barabar.
const ctr = (str, y, size, extra = {}) => {
  const width = str.length * size * 0.5;
  return it(str, (612 - width) / 2, y, size, { width, ...extra });
};
const page24 = [
  ctr("LAW 1", 689, 21, { hasEOL: true }),
  ctr("NEVER OUTSHINE THE MASTER", 617, 21, { hasEOL: true }),
  ctr("JUDGMENT", 549, 21), // EOL nahi, agla item neeche ki line pe
  it("Always", 108, 509, 15, { italic: true }),
  it(" ", 140, 509, 0, { italic: true }),
  it("make those above you feel comfortably", 155, 509),
  it("superior.", 396, 509, 15, { italic: true, hasEOL: true }),
  ctr("TRANSGRESSION OF THE LAW", 374, 21, { bold: true }),
  it("Nicolas Fouquet was a generous man who loved", 72, 324, 15, { hasEOL: true, width: 468 }),
  it("lavish parties and pretty women and infor-", 72, 307, 15, { hasEOL: true, width: 468 }),
  it("mation about the king.", 72, 290, 15, { hasEOL: true }),
  it("The most brilliant nobility of Europe came", 87, 272, 15, { hasEOL: true, width: 453 }),
  it("to the party that night.", 72, 255, 15, { hasEOL: true }),
  it("xii", 300, 40, 12, { hasEOL: true }),
];
const blocks = linesToBlocks(itemsToLines(page24), 15);
check("page24 kinds", blocks.map((b) => b.kind), ["h3", "h3", "h3", "p", "h3", "p", "p", "p"]);
check("headings centered", blocks.slice(0, 3).map((b) => b.align), ["center", "center", "center"]);
check("no-EOL heading still its own block", text(blocks[2]), "JUDGMENT");
check("zero-width space item keeps words apart", text(blocks[3]), "Always make those above you feel comfortably superior.");
check("italic runs kept", blocks[3].runs.map((r) => r.italic), [true, false, true]);
check("bold heading run", blocks[4].runs[0].bold, true);
check("dehyphenated across lines", text(blocks[5]), "Nicolas Fouquet was a generous man who loved lavish parties and pretty women and information about the king.");
check("indent starts new paragraph", text(blocks[6]), "The most brilliant nobility of Europe came to the party that night.");
check("body paragraph left aligned", blocks[5].align, "left");
check("roman numeral page number not translated", blocks[7].translate, false);

// ---- ArtOfWar jaisa: andar khiska commentary paragraph = indent, centered nahi ----
const commentary = linesToBlocks(itemsToLines([
  it("6. Standing on the defensive indicates insufficient strength.", 72, 700, 10, { hasEOL: true, width: 468 }),
  it("[Literally, hides under the ninth earth, which is a metaphor", 108, 680, 10, { hasEOL: true, width: 432 }),
  it("indicating the utmost secrecy and concealment.]", 108, 668, 10, { hasEOL: true, width: 250 }),
]), 10);
check("indented commentary block = indent", commentary.map((b) => b.align), ["left", "indent"]);

// ---- Page 25 jaisa: 30pt heading = h2 ----
const page25 = [
  it("solitary confinement.", 72, 413, 15, { hasEOL: true }),
  it("Interpretation", 214, 322, 30, { bold: true, hasEOL: true }),
  it("Louis XIV, the Sun King, was proud.", 72, 255, 15, { hasEOL: true }),
];
check("30pt heading = h2", linesToBlocks(itemsToLines(page25), 15).map((b) => b.kind), ["p", "h2", "p"]);

// ---- Geometry se space: koi space item nahi, bas gap ----
const gapLine = itemsToLines([
  { str: "echo of", x: 72, y: 482, size: 15, width: 45, hasEOL: false },
  { str: "his", x: 125, y: 482, size: 15, width: 18, italic: true, hasEOL: false },
  { str: "advice.", x: 148, y: 482, size: 15, width: 40, hasEOL: true },
]);
check("gap between items becomes space", gapLine[0].runs.map((r) => r.text).join(""), "echo of his advice.");

// ---- Chapter-title page: body size document se aata hai, page se nahi ----
const hist = new Map();
addSizeHistogram(hist, [it("a".repeat(500), 72, 700, 15), it("Title", 200, 600, 21), it(" ", 0, 0, 0)]);
check("body size from histogram (blank items ignored)", bodySizeFrom(hist), 15);
const titleOnly = linesToBlocks(itemsToLines([it("LAW 9", 274, 689, 21, { hasEOL: true })]), bodySizeFrom(hist));
check("title-only page still a heading with doc body size", titleOnly[0].kind, "h3");

// ---- Lamba ek-style block sentence pe tootta hai ----
const sentence = "This is one sentence that keeps going for a while. ";
const longBlocks = linesToBlocks(itemsToLines([it(sentence.repeat(40), 72, 700, 15, { hasEOL: true })]), 15);
check("long plain block split", longBlocks.length > 1 && longBlocks.every((b) => text(b).length <= 1000), true);

// ---- blockSource ----
check("mixed styles -> markers", blockSource(blocks[3]).sourceText, "<0>Always</0> make those above you feel comfortably <1>superior.</1>");
check("styled cover recorded", blockSource(blocks[3]).styled.map((s) => s.italic), [true, true]);
check("single-style block -> wrap, no markers", blockSource(blocks[4]), {
  sourceText: "TRANSGRESSION OF THE LAW", wrap: { bold: true, italic: false }, styled: [],
});
const collide = { runs: [{ text: "x <3> y and ", bold: false, italic: false }, { text: "bold", bold: true, italic: false }] };
check("literal <3> -> no markers", blockSource(collide).styled.length, 0);

// ---- Font naam se style ----
check("bold font name", fontStyleFromName("AAAAAC+LiberationSerif-Bold"), { bold: true, italic: false });
check("italic font name", fontStyleFromName("AAAAAB+LiberationSerif-Italic"), { bold: false, italic: true });
check("missing font name", fontStyleFromName(undefined), { bold: false, italic: false });
check(
  "normalizeItems maps PDF.js shape",
  normalizeItems([{ str: "Hi", transform: [15, 0, 0, 15, 72, 700], width: 10, height: 15, hasEOL: true, fontName: "f1" }], () => ({ bold: true, italic: false })),
  [{ str: "Hi", x: 72, y: 700, width: 10, size: 15, hasEOL: true, bold: true, italic: false }]
);

// ---- Auto Contents (bookmarks wali PDF nahi) ----
const big = (str, y) => ctr(str, y, 25, { hasEOL: true });
const bodyLine = (str, y) => it(str, 72, y, 10, { hasEOL: true, width: 468 });
const pg = (...items) => pageTocInfo(items, 10);
const tocA = buildToc([
  pg(big("Chapter 2", 700), big("LAYING PLANS", 660), bodyLine("Sun Tzu said: The art of war is of vital importance.", 600)),
  pg(bodyLine("part of our schemes, but the general must plan.", 700)),
  pg(big("Chapter 3", 700), big("WAGING WAR", 660)),
  pg(big("Chapter 4", 700), big("ATTACK BY STRATAGEM", 660)),
]);
check("size headings joined once per chapter", tocA.map((e) => `${e.page}:${e.title}`), [
  "1:Chapter 2: LAYING PLANS", "3:Chapter 3: WAGING WAR", "4:Chapter 4: ATTACK BY STRATAGEM",
]);
const small = (str, y) => it(str, 150, y, 10, { hasEOL: true });
const body12 = (str, y) => it(str, 72, y, 12, { hasEOL: true, width: 468 });
const tocB = buildToc([
  pageTocInfo([small("I. LAYING PLANS", 700), body12("Sun Tzu said the art of war matters a lot.", 680)], 12),
  pageTocInfo([body12("part of our schemes.", 700)], 12),
  pageTocInfo([small("II. WAGING WAR", 700)], 12),
  pageTocInfo([small("III. ATTACK BY STRATAGEM", 700)], 12),
  pageTocInfo([body12("1. Buy milk from the shop today.", 700)], 12),
]);
check("pattern fallback when chapter line is smaller than body", tocB.map((e) => `${e.page}:${e.title}`), [
  "1:I. LAYING PLANS", "3:II. WAGING WAR", "4:III. ATTACK BY STRATAGEM",
]);
const running = buildToc([1, 2, 3, 4, 5].map((n) => pg(big("THE ART OF WAR", 750), big(`Chapter ${n}`, 700))));
check("running header on every page dropped", running.some((e) => e.title === "THE ART OF WAR"), false);
check("empty book -> empty contents", buildToc([pg(bodyLine("Just some text here.", 700))]), []);

// ---- markers.js (content.js ke parser jaise hi cases) ----
check("parse nested", parseMarkers("Yeh <0>bahut <1>zaroori</1></0> hai", 2), [
  { type: "text", value: "Yeh " },
  { type: "el", idx: 0, children: [{ type: "text", value: "bahut " }, { type: "el", idx: 1, children: [{ type: "text", value: "zaroori" }] }] },
  { type: "text", value: " hai" },
]);
check("parse lenient spacing", parseMarkers("< 0 >a</ 0 >", 1)?.[0]?.idx, 0);
check("unbalanced -> null", parseMarkers("<0>a<1>b</0></1>", 2), null);
check("unclosed -> null", parseMarkers("<0>a", 1), null);
check("unknown index dropped, text kept", parseMarkers("a <7>b</7>", 1), [{ type: "text", value: "a " }, { type: "text", value: "b" }]);
check("strip markers", stripMarkers("<0>aaj</0> news <1/> hai"), "aaj news hai");
const stretched = parseMarkers("<0>aaj rajdhani shahar se breaking news</0>.", 1);
check("stretch detected (Google live output)", isStretched(0.31, stretched[0], treeTextLength(stretched)), true);
const normal = parseMarkers("<0>breaking news</0> aaj shahar se aayi.", 1);
check("normal tag not stretched", isStretched(0.31, normal[0], treeTextLength(normal)), false);

console.log(`\n${pass}/${pass + fail} passed.`);
if (fail > 0) process.exit(1);
