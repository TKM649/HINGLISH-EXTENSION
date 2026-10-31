# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Chrome MV3 extension (Manifest V3) that rewrites English web pages and PDFs into
Roman-script Gen-Z Hinglish. Loaded unpacked from this folder.

**There is no build step.** The files in this directory are exactly what Chrome
loads. `package.json` exists only to provide `jsdom` for the Node test suite —
the shipped extension has zero runtime dependencies.

## Commands

```bash
npm install
```

```bash
npm test
```

`npm test` runs `test/run-all.mjs`, which spawns each `test/*.test.mjs` file in
its own process and exits non-zero if any fail. Works on any OS/shell.

Run a single test file directly — each one is a standalone Node script with no
framework:

```bash
node test/safety.test.mjs
```

Reload after changing code: `chrome://extensions` → reload icon. Changes to
`background.js` need the service worker restarted; changes to `content.js` need
the target page's popup toggled again.

## Architecture

### Two translation modes, one fallback chain

`background.js` is the only place network calls happen (content scripts are
inside the page's CORS context and can't `fetch` these endpoints).

- **Mode B — Gemini** (primary, needs a free user-supplied API key). Only this
  path produces real Hinglish.
- **Mode A — Google Translate** (fallback, no key). Goes English → Devanagari
  Hindi → romanized, then applies `hinglishify.js` glossary rules. This is
  structurally incapable of producing Gen-Z Hinglish — it yields
  "adhikansh log" style output no matter how large the glossary grows. Treat it
  as a degraded mode, not an equal alternative.
  Mode A joins a batch into one request with a split marker. If Google eats a
  marker (it does when a sentence is split across segments, common in PDFs),
  `translateGoogleRaw()` halves the batch and retries instead of failing all of
  it; only a segment that fails on its own comes back `null`.

Gemini is the product; Basic mode is only a backup. On first install
`background.js` opens the Settings page, and the popup footer shows an
"Add free Gemini key" link when no key is saved. README and screenshots should
show Gemini output, never Basic-mode text ("adhyay"-style Hindi puts users off).

`handleTranslateBatch()` picks the mode and always returns a `warning` field
(`"no-key"` / `"gemini-failed"`) alongside results. The fallback is deliberately
**not silent** — the content script surfaces it in the status pill, because a
quiet fallback made the extension look broken.

### Gemini model selection is load-bearing

`rankModels()` / `scoreModel()` in `background.js` exist because of a real bug:
picking any model whose name contains "flash-lite" grabbed retired or preview
models whose free-tier quota is literally zero, producing a 429 on the very
first request. The ranking rules, in order: flash-lite > flash > pro, then
newer version wins, then plain names beat numbered variants
(`gemini-2.5-flash` over `gemini-2.5-flash-001`). Preview/exp/thinking/image/
audio variants are filtered out entirely.

Type beats version since Oct 2026: "newest version first" picked
`gemini-3.8-flash`, which rejects `thinkingLevel: "minimal"` and took 86s per
batch, so Gemini looked broken. `gemini-3.5-flash-lite` did the same batch in ~3s.

Dead or slow models are skipped at runtime, not by ranking: on a persistent 429,
any 404, a 503, or a 25s timeout (`GEMINI_TIMEOUT_MS`), `callNextModel()` moves
to the **next** ranked model and rewrites the cached model choice. A
`geminiModelOverride` bypasses all of this on every batch, and `diagnoseKey()`
tests the override when one is set.

### Segment pipeline

1. `content.js` collects block elements (`p, li, h1…h6, td, …`), skipping code,
   inputs, contenteditable, hidden nodes, and anything under 3 words. A second
   pass (`isLeafTextContainer`) picks `div`/`span`/etc. that hold their own text
   and only inline children. Without it, sites like Wellfound that put prose
   directly in `div`s came out half English. That pass skips anything inside a
   block element (so Gmail-style skipped rows stay skipped), inside an
   already-picked node, or inside buttons and labels.
2. Every element inside a block gets a numbered marker: `<N>…</N>` for
   formatting (a, b, i, u, span…) whose text is translated, `<N/>` for opaque
   things (img, svg, br, inline code, icons, `translate="no"`) that come back
   untouched. A block whose text sits in one wrapper (`<h2><span>…</span></h2>`)
   is descended into and sent without markers. Both Gemini and Google Translate
   keep the markers (Google live-tested 10/10, Oct 2026), so Mode A preserves
   formatting too. Rendering moves the **original** element objects back in
   (listeners/React props survive); unbalanced markers fall back to plain text
   with images/icons kept on their original side. `ok:false`, unchanged output,
   or text the site changed meanwhile → the node is not touched.
3. An IntersectionObserver with a 1200px root margin queues segments ahead of
   the viewport. Batches flush on a 100ms debounce, capped at 20 segments /
   4000 chars, with up to 3 batches in flight. Small parallel batches put the
   first paragraph on screen in seconds instead of one 30-50s mega-request.
   Turning off puts queued segments back to `pending`, and results that arrive
   after turning off are not rendered (they come back from cache next time).
   New content (lazy load, SPA routes) is picked up by a MutationObserver that
   ignores mutations inside `[data-hl-id]` nodes and the status pill, so our
   own renders don't trigger full-page rescans. Don't patch
   `history.pushState`: content scripts run in an isolated world, so the
   page's router never calls the patched copy.
4. Results are written back into the DOM; `restore()` puts the exact original
   child node objects back (only for segments actually rendered) and strips
   every attribute the extension added.

### State lives on `window`, not in script scope

`content.js` is injected fresh from the popup on every click. It guards with
`window.__hinglishLoaded` and exposes `window.__hinglishToggle` /
`__hinglishRestore`, so a re-injection toggles existing state instead of
resetting it.

### Safety gate

`safety.js` holds pure predicates and is the real gate — `content.js` is **not**
auto-injected by the manifest, so `popup.js` calling `checkSafety()` before
injection is what actually enforces the rules. Banking/payment hosts are hard-
blocked. Login pages need **both** an auth-looking URL and a password field
present (either alone caused too many false positives).

The right-click "Read in Hinglish" menu runs the same `checkSafety()` in
`background.js` (`isTabAllowed()`), failing closed on the password check.

`reader.html` and `vendor/` are deliberately **not** `web_accessible_resources`:
the popup opens the reader with `chrome.tabs.create`, which doesn't need it, and
exposing it let any website iframe `reader.html?src=…` and spend the user's
Gemini quota.

### Cache

`cache.js` keeps everything in an in-memory `Map` with a debounced 3s write to
`chrome.storage.local`. Do not reintroduce per-entry read/write — that pattern
caused 60+ storage round-trips per batch and visibly hung pages. Keys are
mode-prefixed (`A:` / `B2:`) so the two modes never share entries. The number
after `B` is the prompt version: bump it whenever `SYSTEM_INSTRUCTION` changes
tone (Oct 2026: moved to "aap" form), or old cached output keeps showing.
Storage keys are a 53-bit cyrb53 hash of that string. The old 32-bit djb2
hash had a real chance of two paragraphs sharing a key, which shows the wrong
translation.

## Tone

Translations always address the reader as **"aap"** (aap/aapka, "kijiye"/
"karein"), never tu/tum/karo — including dialogue. This is the owner's explicit
requirement; it lives in the `SAMMAN` rule of `SYSTEM_INSTRUCTION`.

## Popup responsiveness

`popup.js` attaches button handlers immediately and runs every
`executeScript` with `injectImmediately: true`. Without it Chrome waits for the
tab's `document_idle`, so on a still-loading heavy page the popup looked dead.
The safety check is a promise that `onToggle` awaits, so the gate still holds.
`content.js` waits for `DOMContentLoaded` if `<body>` doesn't exist yet.

## Pure vs impure split

Everything testable is deliberately kept free of `chrome.*` and `fetch`:
`gemini.js` (prompt + response parsing), `hinglishify.js`, `safety.js`,
`pdf-text.js`, and the exported ranking/parsing helpers in `background.js`.
`background.js` guards its `chrome.runtime` listeners with a `typeof chrome`
check specifically so Node can import it during tests.

Keep new logic on that side of the line where possible — the test suite runs
entirely in Node with no browser.

## Prompt and glossary

`gemini.js` `SYSTEM_INSTRUCTION` carries the few-shot examples and the explicit
"never route through shuddh Hindi" rule, plus a banned-word list
(`dwara`, `prayas`, `pushti`, …). Quality complaints about output wording are
usually fixed here or in `glossary.js`, not in the network code.

`RESPONSE_SCHEMA` requests structured JSON output. Not every model supports
`responseSchema`, so a 400 triggers one retry without it.
`parseGeminiResponse()` rejects the whole batch on any missing or extra id —
partial trust hides bugs.

## UI conventions

`ui.css` is the shared design system for `popup.html` and `options.html`
(CSS custom properties, `.btn` / `.input` / `.card` classes, dark mode via
`prefers-color-scheme`). Style through those tokens rather than adding page-
local colors.

All user-facing strings are **English** — including status pill text in
`content.js` and diagnostic output in `options.js`. Only the translated page
content is Hinglish. Code comments throughout the repo are Hinglish; that's
intentional, leave them.

`reader.html` (PDF mode) links `ui.css` and adds a reader layer on top (serif
reading font, toolbar, Contents dropdown).

## PDF mode

`reader.html` loads Mozilla PDF.js from `vendor/` (prebuilt, unmodified — don't
edit). Only text-layer PDFs work; there is no OCR.

- **Structure:** `pdf-text.js` `itemsToLines()` → `linesToBlocks()` → `blockSource()`
  rebuild headings (font size vs document body size: ≥1.6× h2, ≥1.15× h3),
  real paragraphs (vertical gap, first-line indent), centered blocks, and
  bold/italic runs (font name via `page.commonObjs` after `getOperatorList()`).
  Body size comes from a size histogram of 3 mid-book pages, never one page —
  a chapter-title page would otherwise make its heading size "body".
  The old `itemsToParagraphs()` (350-char chunks) is kept only for its tests.
- **Markers:** styled runs are sent as `<N>…</N>`; `markers.js` parses them
  (pure, also the stretch guard). `content.js` has its own copy of the same
  logic because injected scripts can't import modules.
- **Navigation:** Contents = the PDF's own outline (`getOutline()`), destinations
  resolved in parallel; unresolvable entries are disabled. No outline →
  `pageTocInfo()`/`buildToc()` scan every page's headings once (size-based,
  falling back to "Chapter N" / "IV. TITLE" line patterns) and cache the result
  in `localStorage` under a versioned key (`hl-reader-toc-v1`). Typing a number
  in the Contents search offers "Go to page N".
- **Alignment:** a block is `center` only if left and right gaps match (35%
  tolerance); far-left-only is `indent` (commentary in ArtOfWar.pdf).
- **Theme:** `reader-theme.js` (classic script in `<head>`, inline scripts are
  blocked by extension CSP) sets `data-theme` = `dark` | `solarized` before
  paint; the toolbar button toggles and remembers it. Last page is remembered per PDF fingerprint in
  `localStorage`. `renderSeq` guards against a slow older render painting over
  a newer jump.
- **Security:** PDF text is untrusted on a privileged page — every node is built
  with `createElement`/`createTextNode`, never `innerHTML`.
- Verified on "The 48 Laws of Power" (700 pages): 48/48 `LAW N` headings found.
