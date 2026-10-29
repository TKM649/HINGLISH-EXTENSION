// pdf-text.js — PDF.js se mile text items ko saaf, reflowed paragraphs me badalta
// hai. Pure string/array logic — koi PDF.js ya DOM dependency nahi, isliye Node me
// bhi test ho sakta hai.
//
// Design (plan ke mutabik): PDF ka exact original layout dobara nahi banate,
// sirf text nikalke ek saaf reading-friendly reflow dete hain.

const MAX_CHUNK_CHARS = 350;

/**
 * PDF.js textContent.items ko lines me group karta hai. PDF.js har item pe
 * `hasEOL: true` deta hai jis item ke baad visual line khatam hoti hai — usi
 * se lines banate hain (position-based guessing se zyada reliable).
 *
 * @param {{str: string, hasEOL?: boolean}[]} items
 * @returns {string[]} lines
 */
export function groupItemsIntoLines(items) {
  const lines = [];
  let current = "";

  for (const item of items) {
    const str = item.str || "";
    current += (current && !current.endsWith(" ") && str ? " " : "") + str;
    if (item.hasEOL) {
      lines.push(current.trim());
      current = "";
    }
  }
  if (current.trim()) lines.push(current.trim());

  return lines.filter((l) => l.length > 0);
}

/**
 * Lines ko ek continuous flowing text me jodta hai. Line-wrap se toote hue
 * hyphenated words ko wapas jodta hai (jaise "infor-\nmation" -> "information").
 *
 * @param {string[]} lines
 * @returns {string}
 */
export function joinLines(lines) {
  let result = "";
  for (const line of lines) {
    if (!result) {
      result = line;
      continue;
    }
    if (/\w-$/.test(result)) {
      // Hyphenated word wrap — hyphen hatao, seedha jodo
      result = result.slice(0, -1) + line;
    } else {
      result += " " + line;
    }
  }
  return result.replace(/\s+/g, " ").trim();
}

/**
 * Continuous text ko ~maxChars ke paragraphs me todta hai, sentence boundaries
 * pe (taaki beech vaakya me na kate). Yeh "asli" paragraph breaks nahi hain
 * (PDF me original paragraph info nahi milti) — sirf reading ke liye readable
 * chunks hain.
 *
 * @param {string} text
 * @param {number} [maxChars]
 * @returns {string[]}
 */
export function chunkIntoParagraphs(text, maxChars = MAX_CHUNK_CHARS) {
  if (!text.trim()) return [];

  const sentences = text.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [text];
  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    if (current && current.length + trimmed.length + 1 > maxChars) {
      chunks.push(current.trim());
      current = trimmed;
    } else {
      current = current ? `${current} ${trimmed}` : trimmed;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

/**
 * Full pipeline: PDF.js textContent.items -> reading-ready paragraphs.
 * @param {{str: string, hasEOL?: boolean}[]} items
 * @returns {string[]}
 */
export function itemsToParagraphs(items) {
  const lines = groupItemsIntoLines(items);
  const flowing = joinLines(lines);
  return chunkIntoParagraphs(flowing);
}

/**
 * Scanned/photo PDF detection — agar page pe text items hain hi nahi ya sab
 * khaali hain, to yeh ek scanned page hai (OCR text layer nahi hai).
 * @param {{str: string}[]} items
 */
export function isEmptyTextPage(items) {
  return !items || items.every((item) => !item.str || !item.str.trim());
}

// ======================================================================
// Formatting-aware extraction (29 Oct 2026)
//
// Upar wala purana pipeline poore page ko ek line me jod ke 350-char ke
// nakli tukde banata tha — headings, bold/italic, asli paragraph sab mit
// jaate the. Neeche wala pipeline PDF.js items ki position aur font se
// asli structure nikalta hai. Input item shape (reader.js banata hai):
//   { str, x, y, width, size, bold, italic, hasEOL }
// "48 Laws of Power" PDF pe naapa: body 15pt, headings 21/30pt, naya
// paragraph = left indent (x 87 vs 72), bold/italic = font ke naam me.
// ======================================================================

const LONG_BLOCK_CHARS = 1500;
const isBlank = (it) => !it.str || !it.str.trim();

/** Font ke naam se style: "AAAAAC+LiberationSerif-Bold" -> bold. */
export function fontStyleFromName(name) {
  const n = String(name || "");
  return {
    bold: /bold|black|heavy|semibold|demi/i.test(n),
    italic: /italic|oblique/i.test(n),
  };
}

/**
 * PDF.js textContent.items -> hamara simple item shape.
 * @param {(fontName: string) => {bold: boolean, italic: boolean}} styleOf
 */
export function normalizeItems(rawItems, styleOf) {
  return rawItems.map((it) => {
    const t = it.transform || [1, 0, 0, 1, 0, 0];
    return {
      str: it.str || "",
      x: t[4],
      y: t[5],
      width: it.width,
      size: it.height || Math.hypot(t[2], t[3]) || 0,
      hasEOL: !!it.hasEOL,
      ...styleOf(it.fontName),
    };
  });
}

/**
 * Text ka size-histogram (size -> characters). Body size = sabse zyada
 * characters wala size. Poori document ke kai pages se jodte hain — ek
 * chapter-title page akele pe 21pt ko "body" maan leta.
 */
export function addSizeHistogram(hist, items) {
  for (const it of items) {
    if (isBlank(it) || !(it.size > 0)) continue;
    const key = Math.round(it.size * 2) / 2;
    hist.set(key, (hist.get(key) || 0) + it.str.trim().length);
  }
  return hist;
}

export function bodySizeFrom(hist) {
  let best = 0;
  let bestChars = -1;
  for (const [size, chars] of hist) {
    if (chars > bestChars) {
      best = size;
      bestChars = chars;
    }
  }
  return best;
}

function sameStyle(a, b) {
  return !!a.bold === !!b.bold && !!a.italic === !!b.italic;
}

function pushRun(runs, text, style) {
  if (!text) return;
  const last = runs[runs.length - 1];
  if (last && sameStyle(last, style)) last.text += text;
  else runs.push({ text, bold: !!style.bold, italic: !!style.italic });
}

/**
 * Items -> visual lines. Line ka faisla y-position se (hasEOL har jagah nahi
 * hota: "JUDGMENT" ke baad EOL nahi tha par agla word neeche wali line pe).
 * Spaces bhi geometry se: PDF me kabhi space item hota hai (size 0), kabhi
 * bas do words ke beech khaali jagah.
 */
export function itemsToLines(items) {
  const lines = [];
  let line = null;
  let pendingSpace = false;
  let prevEnd = null;

  const finish = () => {
    if (!line) return;
    const last = line.runs[line.runs.length - 1];
    if (last) last.text = last.text.replace(/\s+$/, "");
    line.runs = line.runs.filter((r) => r.text);
    if (line.runs.length) {
      lines.push({ x: line.x, y: line.y, right: line.right, size: bodySizeFrom(line.sizeChars), runs: line.runs });
    }
    line = null;
    pendingSpace = false;
    prevEnd = null;
  };

  for (const it of items) {
    if (isBlank(it)) {
      if (line) pendingSpace = true;
      if (it.hasEOL) finish();
      continue;
    }
    const size = it.size > 0 ? it.size : 1;
    if (line && Math.abs(it.y - line.y) > 0.5 * Math.max(size, line.maxSize)) finish();
    if (!line) {
      line = { x: it.x, y: it.y, maxSize: size, runs: [], sizeChars: new Map() };
    } else {
      const gap = prevEnd === null ? 0 : it.x - prevEnd;
      const lastRun = line.runs[line.runs.length - 1];
      const endsWithSpace = lastRun && /\s$/.test(lastRun.text);
      if (!endsWithSpace && !/^\s/.test(it.str) && (pendingSpace || gap > 0.2 * size)) {
        pushRun(line.runs, " ", lastRun || it);
      }
    }
    pendingSpace = false;
    pushRun(line.runs, it.str.replace(/\s+/g, " "), it);
    const key = Math.round(size * 2) / 2;
    line.sizeChars.set(key, (line.sizeChars.get(key) || 0) + it.str.trim().length);
    line.maxSize = Math.max(line.maxSize, size);
    prevEnd = typeof it.width === "number" ? it.x + it.width : null;
    // Line ka right edge — centered vs indented pehchaanne ke liye (null = pata nahi)
    line.right = prevEnd === null ? null : Math.max(line.right ?? -Infinity, prevEnd);
    if (it.hasEOL) finish();
  }
  finish();
  return lines;
}

function lineKind(size, bodySize) {
  if (!bodySize) return "p";
  if (size >= 1.6 * bodySize) return "h2";
  if (size >= 1.15 * bodySize) return "h3";
  return "p";
}

function appendLine(block, line) {
  const runs = block.runs;
  const last = runs[runs.length - 1];
  if (last && /\w-$/.test(last.text) && /^[a-z]/.test(line.runs[0].text)) {
    // line-wrap se toota word ("infor-" + "mation") — hyphen hatao, seedha jodo
    last.text = last.text.slice(0, -1);
  } else if (last) {
    pushRun(runs, " ", last);
  }
  for (const r of line.runs) pushRun(runs, r.text, r);
}

/**
 * Lines -> blocks {kind: 'h2'|'h3'|'p', align, runs, translate}.
 * Naya block tab: kind badla, lines ke beech zyada khaali jagah, upar ki taraf
 * jump (naya column), ya paragraph ka first-line indent.
 */
export function linesToBlocks(lines, bodySize) {
  if (!lines.length) return [];
  const body = bodySize || bodySizeFrom(new Map(lines.map((l) => [l.size, 1])));
  const bodyLines = lines.filter((l) => lineKind(l.size, body) === "p");
  const margin = Math.min(...(bodyLines.length ? bodyLines : lines).map((l) => l.x));
  const indentMin = margin + 0.6 * body;
  const indentMax = margin + 4 * body;

  const blocks = [];
  let block = null;
  let prev = null;
  for (const line of lines) {
    const kind = lineKind(line.size, body);
    let startNew = !block || kind !== block.kind;
    if (!startNew && prev) {
      const gap = prev.y - line.y;
      const lineSize = Math.max(line.size, prev.size);
      if (gap > 1.5 * lineSize || gap < -0.5 * lineSize) startNew = true;
      else if (kind !== "p" && Math.abs(line.size - prev.size) > 0.1 * lineSize) startNew = true;
      else if (kind === "p" && line.x > indentMin && line.x < indentMax && prev.x <= indentMin) {
        startNew = true;
      }
    }
    if (startNew) {
      block = { kind, runs: [], lines: [] };
      blocks.push(block);
    }
    appendLine(block, line);
    block.lines.push(line);
    prev = line;
  }

  // Right margin = body lines ka sabse door wala right edge
  const rights = bodyLines.map((l) => l.right).filter((r) => typeof r === "number");
  const rightMargin = rights.length ? Math.max(...rights) : null;

  const out = [];
  for (const b of blocks) {
    const text = b.runs.map((r) => r.text).join("");
    out.push(...splitLongBlock({
      kind: b.kind,
      align: blockAlign(b.lines, margin, rightMargin, body),
      runs: b.runs,
      // Sirf page number / roman numeral — translate karne layak kuch nahi
      translate: /[a-zA-Z]/.test(text) && !/^\s*[ivxlcdm]{1,6}\.?\s*$/i.test(text),
    }));
  }
  return out;
}

// Centered sirf tab jab dono taraf lagbhag barabar khaali jagah ho. Pehle
// "left me 3 lines ka gap" hi centered maan lete the — ArtOfWar ke andar
// khiske commentary paragraphs (right side poori line tak) beech me aa jaate
// the. Woh ab "indent" hain. Paragraph ki aakhri line chhoti hoti hai, use
// right-gap check me nahi ginte.
function blockAlign(lines, margin, rightMargin, body) {
  const farLeft = lines.every((l) => l.x > margin + 1.5 * body);
  if (!farLeft) return "left";
  const known = rightMargin !== null && lines.every((l) => typeof l.right === "number");
  if (!known) return lines.every((l) => l.x > margin + 3 * body) ? "center" : "indent";
  const check = lines.length > 1 ? lines.slice(0, -1) : lines;
  // Tolerance gap ka 35% (fixed 2×font tight tha: 48 Laws ka "JUDGMENT" 195 vs
  // 163 = 32 farak, PDF ka right margin thoda khiska hai). Andar khiska
  // commentary: left 36, right ~0 — kabhi barabar nahi lagega.
  const symmetric = check.every((l) => {
    const leftGap = l.x - margin;
    const rightGap = rightMargin - l.right;
    return leftGap > 3 * body && Math.abs(leftGap - rightGap) < 0.35 * Math.max(leftGap, rightGap);
  });
  return symmetric ? "center" : "indent";
}

// Kuch PDFs me indent/gap ka koi signal nahi hota — poora page ek block ban
// jaata. Aise lambe block ko sentence pe todo, par sirf jab poora block ek hi
// style ka ho (taaki marker kabhi do tukdon me na bate).
function splitLongBlock(block) {
  const text = block.runs.map((r) => r.text).join("");
  if (block.kind !== "p" || text.length <= LONG_BLOCK_CHARS) return [block];
  if (!block.runs.every((r) => sameStyle(r, block.runs[0]))) return [block];
  const style = block.runs[0];
  return chunkIntoParagraphs(text, 900).map((piece) => ({
    ...block,
    runs: [{ text: piece, bold: style.bold, italic: style.italic }],
  }));
}

// ---------------------------------------------------------------- auto Contents
//
// Jis PDF me apne bookmarks nahi (jaise ek 130-page ArtOfWar.pdf), wahan
// headings se Contents banate hain. Do raaste, naape hue:
//   1) Size: body se bade font wali headings (ArtOfWar: "Chapter 2" + "LAYING PLANS").
//   2) Pattern: kuch books me chapter line body se CHHOTE font me hoti hai
//      ("I. LAYING PLANS" 10pt, body 12pt). Size se 3 se kam mile to akeli,
//      chhoti, CAPS wali "Chapter 4" / "IV. TITLE" / "Part Two" lines.
// "part of our schemes" (ArtOfWar ka asli text) na pakde — shabd wala number sirf one..twenty
const NUMBER_WORD = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty";
const TOC_PATTERN = new RegExp(
  `^(chapter|part|book|section|lesson|law)\\s+([0-9]+|[ivxlc]+|${NUMBER_WORD})\\b|^([ivxlc]+|\\d{1,3})\\.\\s+\\S`,
  "i"
);
const MAX_TOC_TITLE = 100;

const lineText = (runs) => runs.map((r) => r.text).join("").replace(/\s+/g, " ").trim();

/** Ek page ke heading candidates. Pure — reader har page pe chalata hai, phir buildToc(). */
export function pageTocInfo(items, bodySize) {
  const lines = itemsToLines(items);
  const size = [];
  let prevWasHeading = false;
  for (const b of linesToBlocks(lines, bodySize)) {
    const title = lineText(b.runs);
    const isHeading = b.kind !== "p" && /[a-zA-Z]/.test(title);
    if (isHeading) size.push({ title, level: b.kind === "h2" ? 0 : 1, joinPrev: prevWasHeading });
    prevWasHeading = isHeading;
  }
  const pattern = [];
  for (const l of lines) {
    const t = lineText(l.runs);
    if (t.length > 70 || !TOC_PATTERN.test(t)) continue;
    const letters = t.replace(/[^a-zA-Z]/g, "");
    // "Chapter 4" chalega; "1. Buy milk from the shop" jaisi list nahi — CAPS ya chapter-shabd chahiye
    if (!/^(chapter|part|book|section|lesson|law)\b/i.test(t) && letters !== letters.toUpperCase()) continue;
    pattern.push({ title: t, level: 0, joinPrev: false });
  }
  return { size, pattern };
}

/**
 * @param {{size: any[], pattern: any[]}[]} perPage  index 0 = page 1
 * @returns {{title: string, depth: number, page: number}[]}
 */
export function buildToc(perPage) {
  const collect = (key) => {
    const out = [];
    perPage.forEach((info, i) => {
      for (const h of info?.[key] || []) {
        const prev = out[out.length - 1];
        // "Chapter 2" ke turant baad "LAYING PLANS" (same page) = ek hi entry.
        // Sirf ek baar jodo, aur sirf jab pehli line "Chapter N" jaisi ho —
        // warna "Chapter 1: INTRODUCTION: 1.1 Sun Wu…" ban jaata tha.
        if (h.joinPrev && prev && !prev.joined && prev.page === i + 1 && prev.title.length <= 25 && TOC_PATTERN.test(prev.title)) {
          prev.title = `${prev.title}: ${h.title}`;
          prev.level = Math.min(prev.level, h.level);
          prev.joined = true;
          continue;
        }
        out.push({ title: h.title, level: h.level, page: i + 1 });
      }
    });
    // Har page pe chhapa running header (book ka naam) heading nahi hai
    const pagesPerTitle = new Map();
    for (const e of out) pagesPerTitle.set(e.title, (pagesPerTitle.get(e.title) || 0) + 1);
    return out.filter((e) => pagesPerTitle.get(e.title) <= 3);
  };

  let entries = collect("size");
  if (entries.length < 3) {
    const byPattern = collect("pattern");
    if (byPattern.length > entries.length) entries = byPattern;
  }
  const hasTop = entries.some((e) => e.level === 0);
  return entries.map((e) => ({
    title: e.title.length > MAX_TOC_TITLE ? `${e.title.slice(0, MAX_TOC_TITLE - 1)}…` : e.title,
    depth: hasTop ? e.level : 0,
    page: e.page,
  }));
}

// Page ke apne text me "<3>" jaisa kuch ho to marker se takrayega (markers.js jaisa)
const MARKER_LIKE_RE = /<\s*\/?\s*\d+\s*\/?\s*>/;

/**
 * Block -> translation ke liye text. Poora block ek hi style (jaise poora
 * italic paragraph) ho to marker ki zarurat nahi — style block pe lagta hai.
 * Warna regular se alag har run ko <N>…</N>.
 * @returns {{sourceText: string, wrap: {bold:boolean, italic:boolean}, styled: {bold:boolean, italic:boolean, cover:number}[]}}
 */
export function blockSource(block) {
  const runs = block.runs;
  const plain = runs.map((r) => r.text).join("").replace(/\s+/g, " ").trim();
  const regular = { bold: false, italic: false };
  if (runs.every((r) => sameStyle(r, runs[0]))) {
    return { sourceText: plain, wrap: { bold: runs[0].bold, italic: runs[0].italic }, styled: [] };
  }
  if (runs.some((r) => MARKER_LIKE_RE.test(r.text))) {
    return { sourceText: plain, wrap: regular, styled: [] };
  }
  const total = Math.max(1, plain.length);
  const styled = [];
  let text = "";
  for (const r of runs) {
    if (sameStyle(r, regular) || !r.text.trim()) {
      text += r.text;
      continue;
    }
    // Run ke aage-peeche ke space marker ke bahar rakho
    const lead = r.text.match(/^\s*/)[0];
    const trail = r.text.match(/\s*$/)[0];
    const core = r.text.trim();
    const i = styled.length;
    styled.push({ bold: r.bold, italic: r.italic, cover: core.length / total });
    text += `${lead}<${i}>${core}</${i}>${trail}`;
  }
  return { sourceText: text.replace(/\s+/g, " ").trim(), wrap: regular, styled };
}
