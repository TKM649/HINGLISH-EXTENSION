// content.js — page ke andar chalta hai. Text nikalta hai, viewport me aane
// pe translate karwata hai, DOM update karta hai, aur restore handle karta hai.
//
// Yeh file har baar popup se inject hoti hai. Pehli baar poora setup hota hai
// aur window par state save hoti hai; dobara inject hone pe sirf toggle hota hai
// (state fresh script-scope me nahi, window object me rehti hai).

(function () {
  if (window.__hinglishLoaded) {
    window.__hinglishToggle?.();
    return;
  }
  window.__hinglishLoaded = true;

  // ---- Config ----
  const BLOCK_SELECTOR =
    "p, li, h1, h2, h3, h4, h5, h6, td, blockquote, figcaption, dd, dt, summary";
  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", "KBD", "SAMP",
    "TEXTAREA", "INPUT", "SELECT",
  ]);
  const MIN_WORDS = 3;
  // Batch size ka seedha asar PEHLA text dikhne me lagne wale time pe hota hai.
  // 60 segments / 12000 chars ek hi Gemini request me bhejne se generation hi
  // 30-50s le leti thi, aur tab tak page pe kuch nahi badalta tha. Chhoti
  // batches + parallel bhejne se pehla paragraph 5-8s me aa jata hai.
  // Chhoti batch id-mismatch (poori batch reject) ka risk bhi kam karti hai.
  const BATCH_DEBOUNCE_MS = 100;
  const BATCH_MAX_SEGMENTS = 20;
  const BATCH_MAX_CHARS = 4000;
  const MAX_CONCURRENT_BATCHES = 3;
  const OBSERVER_ROOT_MARGIN = "1200px";

  // ---- State ----
  let enabled = false;
  /** @type {Map<string, {node: Element, root: Element, originalText: string, sourceText: string, elements: {el: Element, opaque: boolean, leading: boolean}[], saved: [Element, Node[]][] | null, status: 'pending'|'queued'|'translating'|'done'|'error'}>} */
  const segments = new Map();
  let nextId = 0;
  let intersectionObserver = null;
  let pendingQueue = [];
  let flushTimer = null;
  let inFlightBatches = 0;
  let statusPill = null;
  let totalQueued = 0;
  let totalDone = 0;
  let currentMode = null; // "gemini" | "google"
  let currentWarning = null; // "no-key" | "gemini-failed"
  let warningDetail = null;

  // ---- Public toggle (called on re-inject) ----
  window.__hinglishToggle = toggle;
  window.__hinglishRestore = restore;

  function toggle() {
    if (enabled) {
      disable();
    } else {
      enable();
    }
  }

  function enable() {
    enabled = true;
    // Pichli baar fail hui batches ko dobara mauka do.
    for (const seg of segments.values()) if (seg.status === "error") seg.status = "pending";
    ensureStatusPill();
    setStatus("Looking for text to convert…", "Starting…", true);
    collectSegments();
    setupObserver();
    updateStatusCounts();
  }

  function disable() {
    enabled = false;
    if (intersectionObserver) {
      intersectionObserver.disconnect();
      intersectionObserver = null;
    }
    // Queue me pade segments ko wapas "pending" karo. Pehle yeh "queued" hi
    // reh jaate the (observer unhe chhod chuka tha), to dobara ON karne pe woh
    // paragraph hamesha English rehte.
    for (const id of pendingQueue) {
      const seg = segments.get(id);
      if (seg?.status === "queued") seg.status = "pending";
    }
    pendingQueue = [];
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    hideStatusPill();
  }

  function restore() {
    for (const seg of segments.values()) {
      // Sirf wahi wapas rakho jo humne badla tha, aur wahi ASLI node objects
      // (innerHTML se naye nahi banate) — taaki site ke click handlers, React
      // ka data aur images sab waise hi zinda rahein. Jo segment translate hi
      // nahi hua use chhedna hi nahi.
      if (seg.saved) {
        for (const [el, kids] of seg.saved) el.replaceChildren(...kids);
      }
      seg.node.removeAttribute("data-hl-id");
      // "Original dikhao" ke baad koi trace nahi rehna chahiye. classList.remove()
      // khaali class="" attribute chhod deta hai agar yehi ek class thi — jo
      // original HTML se exact match nahi karta agar wahan class tha hi nahi.
      seg.node.classList.remove("hinglish-done");
      if (seg.node.classList.length === 0) seg.node.removeAttribute("class");
      seg.status = "pending";
    }
    segments.clear();
    totalQueued = 0;
    totalDone = 0;
    disable();
  }

  // BUG FIX (23 Oct 2026): sirf BLOCK_SELECTOR padhne se aadha page English reh
  // jaata tha. Naye sites (Wellfound, React/Tailwind wale) paragraph ko <p> me
  // nahi, seedha <div>/<span> me rakhte hain. Ab dusra pass aise "leaf" text
  // containers bhi uthata hai: jinke andar khud ka text ho aur sirf inline tags.
  const LEAF_CANDIDATE_SELECTOR = "div, span, section, article, header, footer, aside, main";
  // Inke alawa koi bhi andar ho (svg icon, img, div…) to yeh leaf nahi —
  // textContent replace karne se icon/layout mit jaata.
  const NON_INLINE_CHILD = ":not(a, b, strong, em, i, u, s, span, small, sup, sub, mark, abbr, time, br, wbr)";

  function isLeafTextContainer(node) {
    let hasOwnText = false;
    for (const child of node.childNodes) {
      if (child.nodeType === 3 && /[a-zA-Z]/.test(child.textContent)) {
        hasOwnText = true;
        break;
      }
    }
    if (!hasOwnText) return false;
    if (node.querySelector(NON_INLINE_CHILD)) return false;
    // <p>/<li>/<td> ke andar ka text block pass ka hai. Agar block pass ne use
    // jaan-boojh ke skip kiya (Gmail jaisi dense row), to andar ke span bhi skip.
    if (node.parentElement?.closest(BLOCK_SELECTOR)) return false;
    // Already translated parent ke andar dobara mat uthao.
    if (node.parentElement?.closest("[data-hl-id]")) return false;
    if (node.closest("button, [role='button'], label, select, option")) return false;
    return true;
  }

  // ---- Segment collection ----
  function collectSegments() {
    for (const node of document.querySelectorAll(BLOCK_SELECTOR)) addSegment(node);
    // Document order me chalta hai, isliye parent pehle aata hai aur uske andar
    // ke span ko "[data-hl-id] parent" check skip kar deta hai.
    for (const node of document.querySelectorAll(LEAF_CANDIDATE_SELECTOR)) {
      if (node.dataset.hlId || !isLeafTextContainer(node)) continue;
      addSegment(node);
    }
  }

  function addSegment(node) {
    if (node.dataset.hlId) return; // already tracked
    if (isSkippable(node)) return;

    const text = node.textContent.trim();
    if (wordCount(text) < MIN_WORDS) return;
    if (!/[a-zA-Z]/.test(text)) return; // no letters worth translating

    const root = findContentRoot(node);
    if (!root) return; // poora block code/icon hai — translate karne layak kuch nahi

    const { sourceText, elements } = buildSegmentSource(root);

    const id = `hl-${nextId++}`;
    node.dataset.hlId = id;
    segments.set(id, {
      node,
      root, // jiske children badlenge (node khud, ya andar ka akela wrapper)
      originalText: text,
      sourceText,
      elements, // andar ke saare tags, marker number ke order me
      saved: null, // render ke waqt asli children yahan save hote hain (restore ke liye)
      status: "pending",
    });
  }

  // BUG FIX (29 Oct 2026): pehle sirf <a> links bachte the. Bold, italic,
  // underline, rangeen <span>, heading ke andar ka <span>, <br>, icon/img —
  // sab textContent se mit kar plain text ban jaate the. Ab block ke andar ke
  // HAR tag ko numbered marker milta hai:
  //   <N>…</N>  formatting wala tag (b, i, a, span…) — andar ka text translate hota hai
  //   <N/>      "opaque" cheez (img, svg, br, inline code, icon) — jaisi hai waisi wapas
  // Gemini aur Google Translate dono yeh markers sahi jagah rakhte hain (live
  // naapa), aur render ke waqt markers ki jagah ASLI elements wapas lagte hain.
  const OPAQUE_TAGS = new Set([
    "IMG", "SVG", "BR", "WBR", "HR", "INPUT", "BUTTON", "SELECT", "TEXTAREA", "VIDEO",
    "AUDIO", "CANVAS", "IFRAME", "PICTURE", "OBJECT", "EMBED", "MATH",
    "CODE", "KBD", "SAMP", "VAR", "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE",
  ]);
  // Page ke apne text me pehle se "<3>" jaisa kuch ho to woh marker se takra
  // jaata — aise block me markers band (formatting nahi bachegi, text sahi rahega).
  const MARKER_LIKE_RE = /<\s*\/?\s*\d+\s*\/?\s*>/;

  function isOpaque(el) {
    if (OPAQUE_TAGS.has(el.tagName.toUpperCase())) return true;
    // Site ne khud bola "isse translate mat karo" (brand naam waghera)
    if (el.getAttribute("translate") === "no" || el.classList.contains("notranslate")) return true;
    // Icon span, emoji, sirf number — translate karne layak text nahi
    if (!/[a-zA-Z]/.test(el.textContent)) return true;
    return false;
  }

  // <h2><span class="headline">Title</span></h2> jaise case me poora text ek hi
  // wrapper ke andar hota hai. Usi wrapper ke andar utar jaate hain — marker ki
  // zarurat hi nahi, aur heading ka style 100% bacha rehta hai.
  function findContentRoot(node) {
    let root = node;
    for (;;) {
      const kids = [...root.childNodes].filter(
        (n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim())
      );
      if (kids.length !== 1 || kids[0].nodeType !== 1) return root;
      if (isOpaque(kids[0])) return null;
      root = kids[0];
    }
  }

  function buildSegmentSource(root) {
    const parts = [];
    const elements = [];
    let collision = false;
    const plain = []; // sirf bheja jaane wala text (bina markers ke)
    let seenText = false;
    // Return: is subtree ka bheja jaane wala text kitna lamba hai. Opaque
    // cheezon (<style>, code) ka text nahi ginte — wahi units jo render ke
    // waqt treeTextLength() ginta hai, warna stretch-guard galat tag hata deta.
    const walk = (parent) => {
      let len = 0;
      for (const child of parent.childNodes) {
        if (child.nodeType === 3) {
          if (MARKER_LIKE_RE.test(child.textContent)) collision = true;
          if (/[a-zA-Z0-9]/.test(child.textContent)) seenText = true;
          parts.push(child.textContent);
          plain.push(child.textContent);
          len += normalizeSpace(child.textContent).length;
          continue;
        }
        if (child.nodeType !== 1) continue; // comments waghera
        const i = elements.length;
        if (isOpaque(child)) {
          // leading = text se pehle tha (icon jo line ke shuru me hota hai)
          elements.push({ el: child, opaque: true, leading: !seenText });
          parts.push(`<${i}/>`);
          if (/[a-zA-Z0-9]/.test(child.textContent)) seenText = true;
          continue;
        }
        const info = { el: child, opaque: false, leading: false, textLength: 0, cover: 0 };
        elements.push(info);
        parts.push(`<${i}>`);
        info.textLength = walk(child);
        len += info.textLength;
        parts.push(`</${i}>`);
      }
      return len;
    };
    const total = Math.max(1, walk(root));
    // Block ke text ka kitna hissa is tag ke andar hai (0..1)
    for (const info of elements) if (!info.opaque) info.cover = info.textLength / total;

    if (collision || elements.length === 0) {
      return { sourceText: normalizeSpace(plain.join("")), elements: [] };
    }
    return { sourceText: normalizeSpace(parts.join("")), elements };
  }

  function normalizeSpace(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  // Ek "prose" block me zyada se zyada itne direct child elements honi chahiye
  // (jaise ek link ya do). Isse zyada matlab yeh Gmail/Twitter/Reddit jaisi
  // dense app UI ka composite row hai (avatar, naam, subject, time — sab ek
  // hi <td>/<div> ke andar), prose nahi. Aise blocks translate karne se layout
  // tut jaata hai (Gmail me exactly yeh hua tha — poori row overlap ho gayi).
  const MAX_CHILD_ELEMENTS = 4;

  function isSkippable(node) {
    if (SKIP_TAGS.has(node.tagName)) return true;
    if (node.closest("[contenteditable], script, style, noscript, code, pre")) return true;
    if (node.closest('[aria-hidden="true"]')) return true;
    if (node.closest(".hinglish-status-pill")) return true;
    if (node.offsetParent === null && node.tagName !== "BODY") return true;
    if (node.children.length > MAX_CHILD_ELEMENTS) return true;
    if (isSingleLineTruncated(node)) return true;
    // Nested block check: skip if this node contains another block-level match
    // (we only want leaf blocks, not containers).
    if (node.querySelector(BLOCK_SELECTOR)) return true;
    return false;
  }

  // Gmail inbox jaisi UI apne subject/snippet cells ko ek fixed-width single
  // line me dikhati hai (CSS: white-space:nowrap + overflow:hidden/ellipsis).
  // Aisi jagah text replace karna layout todta hai — skip karo.
  function isSingleLineTruncated(node) {
    const style = window.getComputedStyle(node);
    const singleLine = style.whiteSpace === "nowrap";
    const clipped = style.overflow === "hidden" || style.textOverflow === "ellipsis";
    return singleLine && clipped;
  }

  function wordCount(text) {
    return text.split(/\s+/).filter(Boolean).length;
  }

  // ---- Viewport-driven queueing ----
  function setupObserver() {
    intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = entry.target.dataset.hlId;
          const seg = segments.get(id);
          if (!seg || seg.status !== "pending") continue;
          seg.status = "queued";
          pendingQueue.push(id);
          intersectionObserver.unobserve(entry.target);
        }
        scheduleFlush();
      },
      { rootMargin: OBSERVER_ROOT_MARGIN }
    );

    for (const seg of segments.values()) {
      if (seg.status === "pending") intersectionObserver.observe(seg.node);
    }
  }

  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushQueue, BATCH_DEBOUNCE_MS);
  }

  // Jitni batches ek saath bhej sakte hain utni bhejo. Pehle yeh serial tha
  // (ek batch ka response aane ke baad hi agli jaati thi), isliye lamba article
  // batch-count × latency leta tha. Ab teen parallel me chalti hain.
  function flushQueue() {
    while (pendingQueue.length && inFlightBatches < MAX_CONCURRENT_BATCHES) {
      if (!sendNextBatch()) break;
    }
  }

  function sendNextBatch() {
    // Ek batch nikaalo (char/segment cap ke andar)
    const batchIds = [];
    let chars = 0;
    while (pendingQueue.length && batchIds.length < BATCH_MAX_SEGMENTS) {
      const id = pendingQueue[0];
      const seg = segments.get(id);
      const len = seg ? seg.sourceText.length : 0;
      if (batchIds.length > 0 && chars + len > BATCH_MAX_CHARS) break;
      pendingQueue.shift();
      if (!seg) continue;
      batchIds.push(id);
      chars += len;
    }

    if (batchIds.length === 0) return false;

    for (const id of batchIds) {
      const seg = segments.get(id);
      if (seg) seg.status = "translating";
    }
    totalQueued += batchIds.length;
    updateStatusCounts();

    const payload = batchIds.map((id) => ({ id, text: segments.get(id).sourceText }));

    inFlightBatches++;
    chrome.runtime
      .sendMessage({ type: "TRANSLATE_BATCH", segments: payload })
      .then((response) => {
        if (!response?.ok) throw new Error(response?.error || "Unknown error");
        currentMode = response.mode || null;
        currentWarning = response.warning || null;
        warningDetail = response.detail || null;
        applyResults(response.results);
      })
      .catch((err) => {
        for (const id of batchIds) {
          const seg = segments.get(id);
          if (seg) seg.status = "error";
        }
        // Fail hui batch bhi "khatam" hai — warna counter kabhi poora nahi hota
        // aur pill hamesha "Converting…" dikhata.
        totalDone += batchIds.length;
        setStatus(`Error: ${err.message || err}`, "Error", false);
      })
      .finally(() => {
        inFlightBatches--;
        flushQueue();
      });

    return true;
  }

  function applyResults(results) {
    requestAnimationFrame(() => {
      for (const { id, text, ok } of results) {
        const seg = segments.get(id);
        if (!seg) continue;
        // User ne beech me OFF kar diya — ab page mat badlo. Segment wapas
        // "pending" taaki agli baar ON karne pe translate ho (cache se, free).
        if (!enabled) {
          seg.status = "pending";
          totalQueued--;
          continue;
        }
        seg.status = "done";
        totalDone++;
        // Translation fail hui (ok:false), kuch badla hi nahi, ya site ne is
        // beech text khud badal diya (purana translation ab galat hoga) — in
        // teeno me node ko CHHEDNA hi nahi. Pehle fail hone pe bhi markers
        // hata ke plain text likh dete the, jisse bina translate hue hi
        // formatting mit jaati thi.
        if (ok === false || typeof text !== "string" || !text.trim()) continue;
        if (text === seg.sourceText) continue;
        if (normalizeSpace(seg.node.textContent) !== normalizeSpace(seg.originalText)) continue;
        renderSegment(seg, text);
        seg.node.classList.add("hinglish-done");
      }
      updateStatusCounts();
    });
  }

  function renderSegment(seg, text) {
    const { root, elements } = seg;
    // Restore ke liye asli children ki list (same objects) — root ki aur har
    // formatting tag ki, kyunki unke andar ka text bhi badlega.
    seg.saved = [[root, [...root.childNodes]]];
    for (const info of elements) {
      if (!info.opaque) seg.saved.push([info.el, [...info.el.childNodes]]);
    }

    if (elements.length === 0) {
      root.textContent = text;
      return;
    }
    const tree = parseMarkers(text, elements.length);
    root.replaceChildren(tree ? buildTree(tree, elements) : buildFallback(text, elements));
  }

  // "<0>bahut <1>zaroori</1></0> news <2/>" -> tree. Spacing me dheel (< 0 >
  // bhi chalega), par nesting galat ho (</1> pehle, </0> baad me nahi) to null —
  // galat jagah bold lagane se better hai fallback.
  function parseMarkers(text, count) {
    const tokenRe = /<\s*(\/?)\s*(\d+)\s*(\/?)\s*>/g;
    const top = [];
    const stack = [{ children: top, idx: -1 }];
    let last = 0;
    let m;
    const pushText = (s) => {
      if (s) stack[stack.length - 1].children.push({ type: "text", value: s });
    };
    while ((m = tokenRe.exec(text))) {
      const [full, closing, idxStr, selfClosing] = m;
      const idx = Number(idxStr);
      pushText(text.slice(last, m.index));
      last = m.index + full.length;
      if (idx >= count) continue; // aisa number humne bheja hi nahi — tag hata do, text rakho
      const current = stack[stack.length - 1];
      if (selfClosing) {
        current.children.push({ type: "void", idx });
      } else if (closing) {
        if (current.idx !== idx) return null;
        stack.pop();
      } else {
        const node = { type: "el", idx, children: [] };
        current.children.push(node);
        stack.push(node);
      }
    }
    if (stack.length !== 1) return null; // koi tag band hi nahi hua
    pushText(text.slice(last));
    return top;
  }

  function buildTree(tree, elements) {
    const used = new Set();
    // Pehli baar ASLI element (listeners/React data/loaded image sab saath),
    // model ne wahi number dobara diya to copy.
    const take = (idx) => {
      const info = elements[idx];
      if (!used.has(idx)) {
        used.add(idx);
        return info.el;
      }
      return info.el.cloneNode(info.opaque);
    };
    const build = (nodes, parent) => {
      for (const n of nodes) {
        if (n.type === "text") {
          parent.appendChild(document.createTextNode(n.value));
          continue;
        }
        const info = elements[n.idx];
        if (info.opaque) {
          parent.appendChild(take(n.idx));
          if (n.children) build(n.children, parent); // galti se <N>..</N> diya to text bhi rakho
        } else if (n.type === "el") {
          // Live naapa: Google kabhi "<0>Breaking news</0> from the city"
          // ko "<0>aaj shahar se breaking news</0>." bana deta hai — poori
          // line link/bold. Original me tag aadhe se kam text pe tha aur ab
          // lagbhag poore pe hai, to tag hata ke sirf text rakho.
          if (info.cover <= 0.5 && treeTextLength([n]) >= 0.85 * totalLength) {
            build(n.children, parent);
            continue;
          }
          const el = take(n.idx);
          el.replaceChildren();
          build(n.children, el);
          parent.appendChild(el);
        }
        // formatting tag ka <N/> (khaali) — kuch dikhane layak nahi, chhod do
      }
    };
    const totalLength = treeTextLength(tree);
    const frag = document.createDocumentFragment();
    build(tree, frag);
    // Model ne koi image/icon gira diya — usse gayab mat hone do, apni purani
    // taraf (shuru ya end) wapas lagao. <br> gira to bas line break gaya —
    // galat jagah lagane se behtar hai.
    placeLeftovers(frag, elements.filter((info, idx) => info.opaque && !used.has(idx)));
    return frag;
  }

  // Markers toot gaye: text to sahi dikhao, aur images/icons apni taraf rakho.
  function buildFallback(text, elements) {
    const frag = document.createDocumentFragment();
    const plain = text.replace(/<\s*\/?\s*\d+\s*\/?\s*>/g, "").replace(/ {2,}/g, " ").trim();
    frag.appendChild(document.createTextNode(plain));
    placeLeftovers(frag, elements.filter((info) => info.opaque));
    return frag;
  }

  function treeTextLength(nodes) {
    let len = 0;
    for (const n of nodes) {
      if (n.type === "text") len += normalizeSpace(n.value).length;
      else if (n.children) len += treeTextLength(n.children);
    }
    return len;
  }

  function placeLeftovers(frag, infos) {
    const keep = infos.filter((info) => !isLineBreak(info.el));
    const leading = keep.filter((info) => info.leading).map((info) => info.el);
    const trailing = keep.filter((info) => !info.leading).map((info) => info.el);
    frag.prepend(...leading);
    frag.append(...trailing);
  }

  function isLineBreak(el) {
    return el.tagName === "BR" || el.tagName === "WBR";
  }

  // ---- Status pill ----
  function ensureStatusPill() {
    if (statusPill) {
      statusPill.style.display = "grid";
      return;
    }
    // Sirf icon rakha tha (jagah bachane ke liye), par usse pata hi nahi chalta
    // tha ki kaam chal raha hai ya ruk gaya. Ab short label dikhta hai aur poori
    // detail `title` tooltip me rehti hai. Click karne pe original wapas.
    statusPill = document.createElement("button");
    statusPill.type = "button";
    statusPill.className = "hinglish-status-pill";
    statusPill.textContent = "Hinglish";
    statusPill.setAttribute("aria-label", "Restore original text");
    document.documentElement.appendChild(statusPill);
    statusPill.addEventListener("click", restore);
  }

  function hideStatusPill() {
    if (statusPill) statusPill.style.display = "none";
  }

  // label = pill pe dikhne wala chhota text, detail = hover tooltip ki poori baat.
  function setStatus(detail, label, busy) {
    if (!statusPill) return;
    statusPill.title = `${detail}\nClick to restore original`;
    if (label) statusPill.textContent = label;
    statusPill.classList.toggle("hinglish-busy", !!busy);
  }

  function updateStatusCounts(final) {
    if (!statusPill) return;

    // Warning sabse pehle — agar basic mode chal raha hai to yeh saaf dikhna
    // chahiye, warna lagta hai extension hi kharab hai (pehle yeh chup-chaap
    // hota tha, aur output Devanagari-Hindi jaisa aata tha).
    const busy = totalQueued > 0 && totalDone < totalQueued;

    if (currentWarning === "no-key") {
      setStatus("Basic mode — add a Gemini key for better Hinglish", "Basic mode", busy);
      statusPill.classList.add("hinglish-warn");
      return;
    }
    if (currentWarning === "gemini-failed") {
      // Quota khatam hone ka case alag se handle karo — yeh sabse common hai
      // aur user ko pata hona chahiye ki wapas kab chalu hoga.
      const quotaExhausted = /quota|429|exceeded/i.test(warningDetail || "");
      setStatus(
        quotaExhausted
          ? `Daily Gemini limit reached — resets around ${quotaResetTime()}. Using basic mode.`
          : `Gemini unavailable (${warningDetail || "error"}) — using basic mode`,
        quotaExhausted ? "Limit reached" : "Basic mode",
        busy
      );
      statusPill.classList.add("hinglish-warn");
      return;
    }
    statusPill.classList.remove("hinglish-warn");

    if (totalQueued === 0) {
      setStatus("Looking for text to convert…", "Starting…", true);
    } else if (busy) {
      setStatus(`Converting ${totalDone} of ${totalQueued} blocks`, `Converting ${totalDone}/${totalQueued}`, true);
    } else {
      setStatus(
        currentMode === "gemini" ? "Done — converted with Gemini" : "Done — basic mode",
        "Done ✓",
        false
      );
    }
  }

  // Google ki daily limit midnight Pacific time pe reset hoti hai (Gemini docs).
  // Woh waqt user ke apne local time me dikhao — "12:30 AM" hardcode galat tha
  // (India me yeh 12:30/1:30 PM hota hai, aur baaki deshon me kuch aur).
  function quotaResetTime() {
    try {
      const now = new Date();
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles", hourCycle: "h23",
        hour: "numeric", minute: "numeric", second: "numeric",
      }).formatToParts(now);
      const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
      const sinceMidnight = ((get("hour") * 60 + get("minute")) * 60 + get("second")) * 1000;
      const reset = new Date(now.getTime() + 24 * 60 * 60 * 1000 - sinceMidnight);
      return reset.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch {
      return "midnight Pacific time";
    }
  }

  // ---- Dynamic content (naye elements jo baad me DOM me aate hain) ----
  let mutationObserver = null;
  let mutationTimer = null;

  function setupMutationObserver() {
    if (mutationObserver) return;
    mutationObserver = new MutationObserver((records) => {
      if (mutationTimer) return; // already scheduled — throttled
      // Hamare apne render (translated node ke andar) aur status pill ke badlaav
      // pe poora page dobara scan mat karo — pehle har translated batch ek full
      // rescan (har node pe getComputedStyle) trigger karta tha.
      if (records.every(isOwnMutation)) return;
      mutationTimer = setTimeout(() => {
        mutationTimer = null;
        if (!enabled) return;
        collectSegments(); // idempotent — already-tracked nodes skip ho jaate hain
        observeNewPendingSegments();
      }, 500);
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  function isOwnMutation(record) {
    const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
    return !!target?.closest("[data-hl-id], .hinglish-status-pill") || target === statusPill;
  }

  function observeNewPendingSegments() {
    if (!intersectionObserver) return;
    for (const seg of segments.values()) {
      if (seg.status === "pending") intersectionObserver.observe(seg.node);
    }
  }

  // ---- SPA navigation (pushState/replaceState wale sites) ----
  // Route change pe naya content DOM me aata hai, jise MutationObserver pakad
  // leta hai. Pehle yahan history.pushState ko patch kiya tha, par content
  // script "isolated world" me chalti hai — page ka apna router asli (bina
  // patch wala) pushState call karta hai, isliye woh hook kabhi chalta hi nahi
  // tha. Back/forward (popstate) dono worlds me aata hai, wahi rakha hai.
  function setupSpaHook() {
    window.addEventListener("popstate", () => {
      if (!enabled) return;
      setTimeout(() => {
        collectSegments();
        observeNewPendingSegments();
      }, 400);
    });
  }

  // ---- Messages from popup (status query, restore) ----
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "HINGLISH_STATUS") {
      sendResponse({ enabled, totalQueued, totalDone });
      return false;
    }
    if (message?.type === "HINGLISH_RESTORE") {
      restore();
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  // Auto-start on first inject (popup calls this only after inject succeeds,
  // so enabling immediately here mirrors "one click = on").
  // Popup ab injectImmediately se inject karta hai (page load hone ka wait
  // nahi), isliye kabhi <body> abhi bana hi nahi hota — tab DOM ready ka wait.
  const start = () => {
    setupMutationObserver();
    setupSpaHook();
    enable();
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
