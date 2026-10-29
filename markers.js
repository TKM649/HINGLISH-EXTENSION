// markers.js — translation ke formatting markers (<0>…</0>, <1/>) ka pure
// parser. reader.js (PDF mode) use karta hai. content.js inject hone wali
// plain script hai (module import nahi kar sakti), isliye wahan isi logic ki
// copy hai — dono ke test cases same rakhe hain (test/markers.test.mjs).

// Page ke apne text me "<3>" jaisa kuch ho to marker se takrayega
export const MARKER_LIKE_RE = /<\s*\/?\s*\d+\s*\/?\s*>/;

/**
 * "<0>bahut <1>zaroori</1></0> news <2/>" -> tree. Spacing me dheel (< 0 >
 * bhi chalega), par nesting galat ho to null — galat jagah bold lagane se
 * better hai fallback.
 * @returns {Array<{type:'text', value:string}|{type:'el', idx:number, children:any[]}|{type:'void', idx:number}> | null}
 */
export function parseMarkers(text, count) {
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
    if (idx >= count) continue; // aisa number bheja hi nahi — tag hata do, text rakho
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

export function treeTextLength(nodes) {
  let len = 0;
  for (const n of nodes) {
    if (n.type === "text") len += n.value.replace(/\s+/g, " ").trim().length;
    else if (n.children) len += treeTextLength(n.children);
  }
  return len;
}

export function stripMarkers(text) {
  return text.replace(/<\s*\/?\s*\d+\s*\/?\s*>/g, "").replace(/ {2,}/g, " ").trim();
}

/**
 * Live naapa: Google kabhi "<0>Breaking news</0> from the city" ko
 * "<0>aaj shahar se breaking news</0>." bana deta hai. Original me tag aadhe
 * se kam text pe tha aur ab lagbhag poore pe hai — to tag hata do.
 */
export function isStretched(sourceCover, node, totalLength) {
  return sourceCover <= 0.5 && treeTextLength([node]) >= 0.85 * totalLength;
}
