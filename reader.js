// reader.js — PDF reading mode. Mozilla PDF.js se text nikalta hai, phir
// wahi TRANSLATE_BATCH pipeline use karta hai jo web pages ke liye hai
// (background.js — Mode A/B, hinglishify, cache — sab reuse hota hai).
//
// 29 Oct 2026: headings, bold/italic aur asli paragraph ab bachte hain
// (pdf-text.js ka naya pipeline), aur 700-page books ke liye Contents
// dropdown (PDF ke apne bookmarks) + "Go to page" box + last page yaad.
//
// SECURITY: yeh extension ka privileged page hai aur PDF ka text bahar ka
// (untrusted) hai — har node createElement/createTextNode se banta hai,
// innerHTML kabhi nahi.

import * as pdfjsLib from "./vendor/pdf.min.mjs";
import {
  isEmptyTextPage, normalizeItems, fontStyleFromName, addSizeHistogram, bodySizeFrom,
  itemsToLines, linesToBlocks, blockSource, pageTocInfo, buildToc,
} from "./pdf-text.js";
import { parseMarkers, treeTextLength, stripMarkers, isStretched, MARKER_LIKE_RE } from "./markers.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.min.mjs");

const $ = (id) => document.getElementById(id);
const bar = $("bar");
const dropZone = $("dropZone");
const fileInput = $("fileInput");
const reading = $("reading");
const pageContent = $("pageContent");
const errorNotice = $("errorNotice");
const prevBtn = $("prevBtn");
const nextBtn = $("nextBtn");
const pageInput = $("pageInput");
const pageTotal = $("pageTotal");
const restoreBtn = $("restoreBtn");
const statusBar = $("statusBar");
const tocBtn = $("tocBtn");
const toc = $("toc");
const tocFilter = $("tocFilter");
const tocList = $("tocList");
const chapterNow = $("chapterNow");
const tocGoto = $("tocGoto");
const tocSource = $("tocSource");
const themeBtn = $("themeBtn");

let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;
let bodySize = 0;
const sizeHist = new Map();
/** @type {Map<number, {scanned: boolean, blocks: any[], sources: any[], translated: (string|null)[] | null}>} */
const pageCache = new Map();
let showingOriginal = false;
// Har renderPage ko ek number milta hai. Jaldi-jaldi chapter badalne pe
// purana (slow) render baad me khatam ho ke galat page na dikha de.
let renderSeq = 0;
/** @type {{title: string, depth: number, page: number|null, button?: HTMLButtonElement}[]} */
let outline = [];
let posKey = null;
let docToken = 0; // nayi PDF khule to purani PDF ka background Contents-scan ruk jaaye

init();

function init() {
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    const file = e.dataTransfer.files?.[0];
    if (file) loadFromFile(file);
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files?.[0]) loadFromFile(fileInput.files[0]);
  });

  prevBtn.addEventListener("click", () => goToPage(currentPage - 1));
  nextBtn.addEventListener("click", () => goToPage(currentPage + 1));
  restoreBtn.addEventListener("click", toggleOriginal);

  pageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") jumpFromInput();
    if (e.key === "Escape") {
      pageInput.value = String(currentPage);
      pageInput.blur();
    }
  });
  pageInput.addEventListener("change", jumpFromInput);

  tocBtn.addEventListener("click", () => setTocOpen(toc.hidden));
  tocFilter.addEventListener("input", filterToc);
  tocFilter.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      (tocGoto.hidden ? visibleTocButtons()[0] : tocGoto)?.focus();
    }
    // Enter: page number likha ho to wahan, warna pehla milta chapter
    if (e.key === "Enter") {
      e.preventDefault();
      (tocGoto.hidden ? visibleTocButtons()[0] : tocGoto)?.click();
    }
  });
  tocList.addEventListener("keydown", onTocListKey);
  tocGoto.addEventListener("keydown", onTocListKey);
  tocGoto.addEventListener("click", () => {
    const n = Number(tocGoto.dataset.page);
    setTocOpen(false);
    tocBtn.focus();
    goToPage(n);
  });
  themeBtn.addEventListener("click", toggleTheme);
  syncThemeButton();
  document.addEventListener("mousedown", (e) => {
    if (!toc.hidden && !e.target.closest(".toc-wrap")) setTocOpen(false);
  });
  document.addEventListener("keydown", onGlobalKey);

  const src = new URLSearchParams(location.search).get("src");
  if (src) loadFromUrl(src);
}

// ---------------------------------------------------------------- loading

async function loadFromFile(file) {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    showError("This doesn't look like a PDF. Choose a .pdf file.");
    return;
  }
  try {
    await openPdf({ data: await file.arrayBuffer() });
  } catch (err) {
    showError(`Couldn't open this PDF: ${err.message || err}`);
  }
}

async function loadFromUrl(url) {
  setStatus("Loading PDF…");
  try {
    await openPdf({ url });
  } catch (err) {
    showError(
      `This online PDF couldn't be loaded (${err.message || err}). Many sites block loading ` +
        `their PDFs elsewhere. Download the PDF, then drop it here — that always works.`
    );
  }
}

// Book PDFs me cover/title/blank pages aksar shuru ke 1-5 pages hote hain.
const AUTO_SCAN_LIMIT = 20;
let scanCoveredFullDoc = false;

async function openPdf(source) {
  pdfDoc = await pdfjsLib.getDocument(source).promise;
  totalPages = pdfDoc.numPages;
  pageCache.clear();
  sizeHist.clear();
  dropZone.hidden = true;
  dropZone.style.display = "none";
  errorNotice.hidden = true;
  bar.hidden = false;
  reading.hidden = false;
  pageInput.max = String(totalPages);
  pageTotal.textContent = `of ${totalPages}`;

  setStatus("Reading the PDF…");
  const token = ++docToken;
  outline = [];
  tocSource.textContent = "";
  tocList.replaceChildren(tocEmpty("Loading contents…"));
  await seedBodySize();

  posKey = `hl-reader-pos:${pdfDoc.fingerprints?.[0] || ""}:${totalPages}`;
  const saved = readSavedPage();
  currentPage = saved || (await findFirstTextPage());
  // Pehle page dikhao, phir Contents — 700 pages ka heading-scan PDF.js worker
  // ko busy rakhta hai, use pehle page ke aage line me nahi lagana.
  const first = renderPage(currentPage);
  first.catch(() => {}).finally(() => {
    if (token === docToken) loadOutline(token);
  });
  await first;
}

// Body text ka size poori book se (beech ke 3 pages) — sirf ek page se lete
// to chapter-title page pe 21pt ko hi "normal text" maan lete.
async function seedBodySize() {
  const picks = [...new Set([0.25, 0.5, 0.75].map((f) => Math.max(1, Math.round(totalPages * f))))];
  for (const n of picks) {
    try {
      const tc = await (await pdfDoc.getPage(n)).getTextContent();
      addSizeHistogram(sizeHist, normalizeItems(tc.items, () => ({})));
    } catch {
      // ek page na padha jaye to baaki se kaam chal jaayega
    }
  }
  bodySize = bodySizeFrom(sizeHist);
}

async function findFirstTextPage() {
  const limit = Math.min(totalPages, AUTO_SCAN_LIMIT);
  scanCoveredFullDoc = limit === totalPages;
  for (let n = 1; n <= limit; n++) {
    setStatus(`Looking for the first page with text… (${n}/${limit})`);
    try {
      if (!(await getEntry(n)).scanned) return n;
    } catch {
      // is page me error — aage dekho
    }
  }
  return 1;
}

function readSavedPage() {
  try {
    const n = Number(localStorage.getItem(posKey));
    return Number.isInteger(n) && n >= 1 && n <= totalPages ? n : 0;
  } catch {
    return 0;
  }
}

function savePage(n) {
  try {
    localStorage.setItem(posKey, String(n));
  } catch {
    // private window / storage band — bas yaad nahi rahega
  }
}

// ---------------------------------------------------------------- extraction

async function getEntry(n) {
  const cached = pageCache.get(n);
  if (cached) return cached;
  const page = await pdfDoc.getPage(n);
  // Operator list se fonts load hote hain (bold/italic unke naam me hai).
  // Fail ho to bas regular maan lo — kabhi error nahi.
  // Promise.resolve().then(...) — agar getOperatorList turant throw kare (purane
  // Chrome me koi naya JS method na ho) to bhi page khule, bas bold/italic plain.
  const [tc] = await Promise.all([
    page.getTextContent(),
    Promise.resolve().then(() => page.getOperatorList()).catch(() => null),
  ]);
  const styleOf = (fontName) => {
    try {
      const font = page.commonObjs.get(fontName);
      const byName = fontStyleFromName(font?.name);
      return { bold: byName.bold || !!font?.bold || !!font?.black, italic: byName.italic || !!font?.italic };
    } catch {
      return { bold: false, italic: false };
    }
  };

  let entry;
  if (isEmptyTextPage(tc.items)) {
    entry = { scanned: true, blocks: [], sources: [], translated: [] };
  } else {
    const items = normalizeItems(tc.items, styleOf);
    if (!bodySize) {
      addSizeHistogram(sizeHist, items);
      bodySize = bodySizeFrom(sizeHist);
    }
    const blocks = linesToBlocks(itemsToLines(items), bodySize);
    entry = { scanned: false, blocks, sources: blocks.map((b) => (b.translate ? blockSource(b) : null)), translated: null };
  }
  pageCache.set(n, entry);
  return entry;
}

// ---------------------------------------------------------------- navigation

function jumpFromInput() {
  const n = parseInt(pageInput.value, 10);
  if (!Number.isFinite(n)) {
    pageInput.value = String(currentPage);
    return;
  }
  goToPage(Math.min(totalPages, Math.max(1, n)));
}

async function goToPage(n) {
  if (!pdfDoc || n < 1 || n > totalPages) return;
  if (n === currentPage && pageCache.get(n)?.translated) {
    pageInput.value = String(n);
    return;
  }
  currentPage = n;
  showingOriginal = false;
  window.scrollTo(0, 0);
  try {
    await renderPage(n);
  } catch (err) {
    showError(`Couldn't open page ${n}: ${err.message || err}`);
  }
}

async function renderPage(n) {
  const seq = ++renderSeq;
  updateNav();
  savePage(n);
  restoreBtn.disabled = true;
  restoreBtn.textContent = "Show original";
  showMessage("loading", `Reading page ${n}…`);

  const entry = await getEntry(n);
  if (seq !== renderSeq) return;

  if (entry.scanned) {
    const wholeDoc = n === 1 && scanCoveredFullDoc;
    showMessage(
      "page-notice",
      wholeDoc
        ? `No text was found anywhere in this PDF (all ${totalPages} pages). It's a scanned or photo PDF, so it can't be converted.`
        : `Page ${n} has no text (likely a cover, blank or scanned page). Use the arrows or Contents to move on.`
    );
    setStatus("");
    return;
  }

  if (entry.translated === null) {
    showMessage("loading", `Converting page ${n}…`);
    setStatus("Converting…");
    // A -> B -> A jaldi karne pe A ki dusri request mat bhejo (quota double
    // lagta) — pehli wali chal rahi request ka hi wait karo.
    entry.pending ??= translateEntry(entry);
    const result = await entry.pending;
    // Doosre page pe chale gaye ho tab bhi result cache me rahe (wapas aane pe kaam aayega)
    entry.translated = result.translated;
    if (seq !== renderSeq) return;
    setStatus(result.warning || "", !!result.warning);
  } else {
    setStatus("");
  }

  showingOriginal = false;
  renderBlocks(entry, true);
  restoreBtn.disabled = false;
}

async function translateEntry(entry) {
  const segments = [];
  entry.sources.forEach((src, i) => {
    if (src && src.sourceText) segments.push({ id: `b${i}`, text: src.sourceText });
  });
  const translated = entry.sources.map(() => null);
  if (!segments.length) return { translated, warning: "" };
  try {
    const response = await chrome.runtime.sendMessage({ type: "TRANSLATE_BATCH", segments });
    if (!response?.ok) throw new Error(response?.error || "translate failed");
    for (const r of response.results || []) {
      // ok:false (translation fail) = original formatting ke saath English hi dikhao
      if (r.ok === false || typeof r.text !== "string" || !r.text.trim()) continue;
      translated[Number(r.id.slice(1))] = r.text;
    }
    let warning = "";
    if (response.warning === "no-key") warning = "Basic mode — add a Gemini key in Settings for better Hinglish";
    else if (response.warning === "gemini-failed") warning = `Gemini unavailable (${response.detail || "error"}) — using basic mode`;
    return { translated, warning };
  } catch (err) {
    return { translated, warning: `Error: ${err.message || err}` };
  }
}

// ---------------------------------------------------------------- rendering

function renderBlocks(entry, useTranslation) {
  const frag = document.createDocumentFragment();
  entry.blocks.forEach((block, i) => {
    const el = document.createElement(block.kind === "p" ? "p" : block.kind);
    if (block.align === "center") el.classList.add("center");
    if (block.align === "indent") el.classList.add("indent");
    if (!block.translate) el.classList.add("num");
    const src = entry.sources[i];
    const text = useTranslation ? entry.translated?.[i] : null;
    if (text && src) {
      appendTranslated(wrapStyle(el, src.wrap), text, src);
    } else {
      appendRuns(el, block.runs);
    }
    frag.appendChild(el);
  });
  pageContent.replaceChildren(frag);
}

// Style ke hisaab se <strong>/<em> banao. Return: jisme text jaana hai.
function styledInner(parent, style) {
  let inner = parent;
  if (style.bold) inner = inner.appendChild(document.createElement("strong"));
  if (style.italic) inner = inner.appendChild(document.createElement("em"));
  return inner;
}

function wrapStyle(el, wrap) {
  return wrap ? styledInner(el, wrap) : el;
}

function appendRuns(el, runs) {
  for (const run of runs) {
    styledInner(el, run).appendChild(document.createTextNode(run.text));
  }
}

function appendTranslated(el, text, src) {
  if (!src.styled.length) {
    // Humne marker bheja hi nahi tha — model ne galti se jod diya ho to hatao
    // (par agar original me hi "<3>" tha to waisa hi rehne do)
    el.appendChild(document.createTextNode(MARKER_LIKE_RE.test(src.sourceText) ? text : stripMarkers(text)));
    return;
  }
  const tree = parseMarkers(text, src.styled.length);
  if (!tree) {
    el.appendChild(document.createTextNode(stripMarkers(text)));
    return;
  }
  const total = treeTextLength(tree);
  const build = (nodes, parent) => {
    for (const n of nodes) {
      if (n.type === "text") {
        parent.appendChild(document.createTextNode(n.value));
      } else if (n.type === "el") {
        const style = src.styled[n.idx];
        if (isStretched(style.cover, n, total)) build(n.children, parent);
        else build(n.children, styledInner(parent, style));
      }
      // <N/> PDF mode me bhejte hi nahi — aaye to chhod do
    }
  };
  build(tree, el);
}

function toggleOriginal() {
  const entry = pageCache.get(currentPage);
  if (!entry || entry.scanned || !entry.translated) return;
  showingOriginal = !showingOriginal;
  renderBlocks(entry, !showingOriginal);
  restoreBtn.textContent = showingOriginal ? "Show Hinglish" : "Show original";
}

function showMessage(className, text) {
  const p = document.createElement("p");
  p.className = className;
  p.textContent = text;
  pageContent.replaceChildren(p);
}

// ---------------------------------------------------------------- contents

async function loadOutline(token) {
  let raw = null;
  try {
    raw = await pdfDoc.getOutline();
  } catch {
    raw = null;
  }
  const flat = [];
  const walk = (items, depth) => {
    for (const item of items || []) {
      flat.push({ title: (item.title || "").replace(/\s+/g, " ").trim() || "Untitled", depth, dest: item.dest });
      walk(item.items, depth + 1);
    }
  };
  walk(raw, 0);

  if (!flat.length) {
    await loadAutoOutline(token);
    return;
  }

  // Har entry ka page number parallel me nikaalo. Jo resolve na ho (website
  // link, toota bookmark) wo disabled dikhega, error nahi.
  outline = await Promise.all(
    flat.map(async (item) => ({ title: item.title, depth: item.depth, page: await resolveDest(item.dest) }))
  );
  if (token !== docToken) return;
  tocSource.textContent = "";
  renderToc();
  updateCurrentChapter();
}

// PDF me bookmarks nahi — har page ki headings se Contents banao (pdf-text.js
// buildToc). Ek baar ka kaam: result is PDF ke liye localStorage me yaad.
async function loadAutoOutline(token) {
  // "v1" = buildToc ka version. Uska logic badle to badhao, warna purana save hua Contents dikhta rahega.
  const key = `hl-reader-toc-v1:${pdfDoc.fingerprints?.[0] || ""}:${totalPages}`;
  let entries = null;
  try {
    entries = JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    entries = null;
  }
  if (!Array.isArray(entries)) {
    const perPage = [];
    for (let n = 1; n <= totalPages; n++) {
      if (token !== docToken) return;
      if (n === 1 || n % 10 === 0) {
        tocList.replaceChildren(tocEmpty(`Building contents from the book's headings… page ${n} of ${totalPages}`));
      }
      try {
        const tc = await (await pdfDoc.getPage(n)).getTextContent();
        perPage.push(pageTocInfo(normalizeItems(tc.items, () => ({})), bodySize));
      } catch {
        perPage.push(null);
      }
    }
    entries = buildToc(perPage);
    try {
      localStorage.setItem(key, JSON.stringify(entries));
    } catch {
      // storage band — agli baar dobara bana lenge
    }
  }
  if (token !== docToken) return;
  outline = entries.map((e) => ({ title: e.title, depth: e.depth, page: e.page }));
  if (!outline.length) {
    tocSource.textContent = "";
    tocList.replaceChildren(
      tocEmpty("This PDF has no contents and no clear chapter headings. Type a page number above to jump.")
    );
    updateCurrentChapter();
    return;
  }
  tocSource.textContent = "Made from the book's headings";
  renderToc();
  updateCurrentChapter();
}

async function resolveDest(dest) {
  try {
    let d = dest;
    if (typeof d === "string") d = await pdfDoc.getDestination(d);
    if (!Array.isArray(d) || d[0] == null) return null;
    const idx = typeof d[0] === "number" ? d[0] : await pdfDoc.getPageIndex(d[0]);
    return idx >= 0 && idx < totalPages ? idx + 1 : null;
  } catch {
    return null;
  }
}

function tocEmpty(text) {
  const li = document.createElement("li");
  li.className = "toc-empty";
  li.textContent = text;
  return li;
}

function renderToc() {
  const frag = document.createDocumentFragment();
  for (const item of outline) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toc-item";
    btn.style.paddingLeft = `${10 + Math.min(item.depth, 4) * 16}px`;
    const title = document.createElement("span");
    title.textContent = item.title;
    const pg = document.createElement("span");
    pg.className = "pg";
    pg.textContent = item.page ? String(item.page) : "–";
    btn.append(title, pg);
    if (item.page) {
      btn.addEventListener("click", () => {
        setTocOpen(false);
        tocBtn.focus();
        goToPage(item.page);
      });
    } else {
      btn.disabled = true;
      btn.title = "This entry doesn't point to a page";
    }
    item.button = btn;
    li.appendChild(btn);
    frag.appendChild(li);
  }
  tocList.replaceChildren(frag);
}

// "45", "p45", "page 45" -> page number
function pageFromQuery(q) {
  const m = q.match(/^(?:p(?:age|g)?\.?\s*)?(\d{1,6})$/i);
  return m ? Number(m[1]) : null;
}

function filterToc() {
  const q = tocFilter.value.trim().toLowerCase();
  const n = pageFromQuery(q);
  if (n !== null && pdfDoc) {
    const target = Math.min(totalPages, Math.max(1, n));
    tocGoto.dataset.page = String(target);
    tocGoto.textContent = target === n ? `Go to page ${target}` : `Go to page ${target} (last page)`;
    tocGoto.hidden = false;
  } else {
    tocGoto.hidden = true;
  }
  let shown = 0;
  for (const item of outline) {
    const match = !q || item.title.toLowerCase().includes(q);
    item.button.parentElement.hidden = !match;
    if (match) shown++;
  }
  if (!outline.length) return; // khaali-Contents wala message waisa hi rahe
  tocList.querySelector(".toc-empty")?.remove();
  if (!shown && tocGoto.hidden) tocList.appendChild(tocEmpty(`No chapter matches "${tocFilter.value.trim()}".`));
}

// Abhi wala chapter = aakhri entry jiska page <= current page
function currentChapterIndex() {
  let best = -1;
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i].page;
    if (p && p <= currentPage && (best < 0 || p >= outline[best].page)) best = i;
  }
  return best;
}

function updateCurrentChapter() {
  const idx = currentChapterIndex();
  outline.forEach((item, i) => {
    item.button?.classList.toggle("current", i === idx);
    if (item.button) item.button.setAttribute("aria-current", i === idx ? "true" : "false");
  });
  const title = idx >= 0 ? outline[idx].title : "";
  chapterNow.textContent = title;
  chapterNow.title = title;
}

function setTocOpen(open) {
  toc.hidden = !open;
  tocBtn.setAttribute("aria-expanded", String(open));
  if (!open) {
    // Agli baar kholne pe poori list dikhe, purana filter nahi
    if (tocFilter.value) {
      tocFilter.value = "";
      filterToc();
    }
    return;
  }
  tocFilter.focus();
  const idx = currentChapterIndex();
  if (idx >= 0) outline[idx].button?.scrollIntoView({ block: "center" });
}

function visibleTocButtons() {
  return [...tocList.querySelectorAll(".toc-item")].filter((b) => !b.parentElement.hidden && !b.disabled);
}

function onTocListKey(e) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const buttons = (tocGoto.hidden ? [] : [tocGoto]).concat(visibleTocButtons());
  const i = buttons.indexOf(document.activeElement);
  const next = e.key === "ArrowDown" ? buttons[i + 1] : buttons[i - 1];
  if (next) next.focus();
  else if (e.key === "ArrowUp") tocFilter.focus();
}

function onGlobalKey(e) {
  if (e.key === "Escape" && !toc.hidden) {
    setTocOpen(false);
    tocBtn.focus();
    return;
  }
  // Page/filter box me type karte waqt arrow keys cursor ke liye hain
  if (!pdfDoc || !toc.hidden || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
  if (e.key === "ArrowRight") goToPage(currentPage + 1);
  if (e.key === "ArrowLeft") goToPage(currentPage - 1);
}

// ---------------------------------------------------------------- theme

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "solarized" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("hl-reader-theme", next);
  } catch {
    // yaad nahi rahega, par abhi ke liye badal gaya
  }
  syncThemeButton();
}

function syncThemeButton() {
  const dark = document.documentElement.dataset.theme === "dark";
  const label = dark ? "Switch to light (Solarized)" : "Switch to dark";
  themeBtn.setAttribute("aria-label", label);
  themeBtn.title = label;
}

// ---------------------------------------------------------------- chrome

function updateNav() {
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
  pageInput.value = String(currentPage);
  updateCurrentChapter();
}

function setStatus(text, warn = false) {
  statusBar.textContent = text;
  statusBar.title = text;
  statusBar.classList.toggle("warn", warn);
}

function showError(text) {
  errorNotice.textContent = text;
  errorNotice.hidden = false;
  setStatus("");
}
